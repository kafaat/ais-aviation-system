import { Router, type RequestHandler } from "express";
import { TRPCError, type AnyRouter, type AnyProcedure } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { z } from "zod";
import type { OpenApiMeta } from "trpc-to-openapi";
import type { TrpcContext } from "./context";

// Keep transport conversion separate from the original tRPC validators. Some
// OpenAPI adapters mutate Zod coercion flags, weakening subsequent tRPC calls.
export function fromRestValue(
  schema: z.ZodType,
  value: unknown,
  text: boolean
): unknown {
  if (value === undefined || value === null) return value;
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault
  ) {
    return fromRestValue(schema.unwrap() as z.ZodType, value, text);
  }
  if (
    text &&
    typeof value === "string" &&
    (schema instanceof z.ZodObject ||
      schema instanceof z.ZodRecord ||
      schema instanceof z.ZodArray) &&
    /^[\[{]/.test(value)
  ) {
    try {
      value = JSON.parse(value);
    } catch {
      /* Original validator rejects malformed JSON. */
    }
  }
  if (
    schema instanceof z.ZodObject &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        schema.shape[key] ? fromRestValue(schema.shape[key], item, text) : item,
      ])
    );
  }
  if (schema instanceof z.ZodArray) {
    const items = text && !Array.isArray(value) ? [value] : value;
    return Array.isArray(items)
      ? items.map(item =>
          fromRestValue(schema.element as z.ZodType, item, text)
        )
      : value;
  }
  if (typeof value !== "string") return value;
  if (schema instanceof z.ZodDate && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    return new Date(value);
  if (
    text &&
    schema instanceof z.ZodNumber &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  if (text && schema instanceof z.ZodBoolean && /^(true|false)$/.test(value))
    return value === "true";
  if (text && schema instanceof z.ZodBigInt && /^-?\d+$/.test(value))
    return BigInt(value);
  return value;
}

export function openApiProcedures(router: AnyRouter) {
  return Object.entries(router._def.procedures as Record<string, AnyProcedure>)
    .flatMap(([name, procedure]) => {
      const meta = (procedure._def.meta as OpenApiMeta | undefined)?.openapi;
      if (!meta || meta.enabled === false) return [];
      if (procedure._def.type === "subscription")
        throw new Error(`REST subscription unsupported: ${name}`);
      return [{ name, procedure, meta }];
    })
    .sort((a, b) => {
      const aParts = a.meta.path.split("/");
      const bParts = b.meta.path.split("/");
      for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
        const difference =
          Number(aParts[i].startsWith("{")) - Number(bParts[i].startsWith("{"));
        if (difference) return difference;
      }
      return bParts.length - aParts.length;
    });
}

export function createRestMiddleware(options: {
  router: AnyRouter;
  createContext: (
    opts: Pick<TrpcContext, "req" | "res">
  ) => Promise<TrpcContext> | TrpcContext;
  onError?: (error: unknown, path: string) => void;
}): RequestHandler {
  const rest = Router();
  const seen = new Set<string>();
  for (const { name, procedure, meta } of openApiProcedures(options.router)) {
    const canonical = `${meta.method} ${meta.path
      .replace(/\{[^}]+\}/g, "{}")
      .replace(/\/$/, "")
      .toLowerCase()}`;
    if (seen.has(canonical))
      throw new Error(`Duplicate REST route: ${canonical}`);
    seen.add(canonical);
    const path = meta.path.replace(/\{([^}]+)\}/g, ":$1");
    const handler: RequestHandler = async (req, res) => {
      try {
        const useBody = !["GET", "DELETE"].includes(meta.method);
        if (useBody && !req.is("application/json")) {
          throw new TRPCError({
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Expected application/json",
          });
        }
        const source = useBody ? req.body : req.query;
        if (
          source != null &&
          (typeof source !== "object" || Array.isArray(source))
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Expected an input object",
          });
        }
        let input: unknown = procedure._def.inputs.length
          ? { ...source, ...req.params }
          : undefined;
        for (const parser of procedure._def.inputs) {
          if (!(parser instanceof z.ZodType))
            throw new Error(`REST requires Zod: ${name}`);
          input = fromRestValue(parser, input, !useBody);
          // Path parameters are strings even when the body is JSON. The path
          // always takes precedence over an identically named body field.
          const convertedPath = fromRestValue(
            parser,
            req.params,
            true
          ) as object;
          input = { ...(input as object), ...convertedPath };
        }
        const ctx = await options.createContext({ req, res });
        // Execute the original caller, including input refinements, auth,
        // tenant checks, rate limits, output validation and business logic.
        const caller = options.router.createCaller(ctx);
        // tRPC's recursive caller supports dotted procedure paths.
        const data = await (
          caller[name] as (input: unknown) => Promise<unknown>
        )(input);
        res.json(data ?? null);
      } catch (cause) {
        options.onError?.(cause, name);
        const error =
          cause instanceof TRPCError
            ? cause
            : new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause });
        res.status(getHTTPStatusCodeFromError(error)).json({
          code: error.code,
          message:
            error.code === "INTERNAL_SERVER_ERROR"
              ? "Internal server error"
              : error.message,
          ...(error.cause instanceof z.ZodError
            ? { issues: error.cause.issues }
            : {}),
        });
      }
    };
    rest[
      meta.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete"
    ](path, handler);
  }
  rest.use((_req, res) => {
    res
      .status(404)
      .json({ code: "NOT_FOUND", message: "REST endpoint not found" });
  });
  return rest;
}
