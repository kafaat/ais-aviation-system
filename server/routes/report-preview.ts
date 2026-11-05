import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import express, { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { TrpcContext } from "../_core/context";
import { standardReportRequestSchema } from "../contracts/standard-reports";
import {
  REPORT_PREVIEW_REPORT_ID,
  type ReportPreviewInput,
} from "../../shared/report-preview";
import type { StandardReportResult } from "../../shared/standard-reports";

const previewInputSchema = standardReportRequestSchema.extend({
  reportId: z.literal(REPORT_PREVIEW_REPORT_ID),
});
const allowedMethods = "QUERY, POST, OPTIONS";

type ReportPreviewOptions = {
  createContext: (
    options: Pick<TrpcContext, "req" | "res">
  ) => Promise<TrpcContext> | TrpcContext;
  /** Invoke the original protected procedure, including its authorization. */
  runReport: (
    input: ReportPreviewInput,
    context: TrpcContext
  ) => Promise<StandardReportResult>;
  rateLimit?: RequestHandler;
  onError?: (error: unknown) => void;
};

/**
 * Mounted at /api/rest before the general body parser and REST dispatcher.
 * This is an explicit read-only allowlist, not an alias for arbitrary tRPC
 * queries or mutations. POST and QUERY share the same validation and caller.
 */
export function createReportPreviewRouter(options: ReportPreviewOptions) {
  const router = Router({ caseSensitive: true, strict: true });
  const parseJson = express.json({ limit: "1mb" });

  const prepare: RequestHandler = (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Accept-Query", "application/json");
    res.setHeader("Allow", allowedMethods);

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };

  const handler: RequestHandler = (req, res) => {
    if (req.method !== "QUERY" && req.method !== "POST") {
      res.status(405).json({
        code: "METHOD_NOT_SUPPORTED",
        message: "Use QUERY or POST for this report preview",
      });
      return;
    }
    // All selection comes from the validated body. Do not silently ignore
    // query-string inputs or combine them with independently validated fields.
    if (req.originalUrl.includes("?")) {
      res.status(400).json({
        code: "BAD_REQUEST",
        message: "Report preview parameters must be in the JSON body",
      });
      return;
    }
    if (!req.headers["content-type"]) {
      res.status(400).json({
        code: "BAD_REQUEST",
        message: "Content-Type is required",
      });
      return;
    }
    if (!req.is("application/json")) {
      res.status(415).json({
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Expected application/json",
      });
      return;
    }
    if (!req.accepts("application/json")) {
      res.status(406).json({
        code: "NOT_ACCEPTABLE",
        message: "Report previews are returned as application/json",
      });
      return;
    }

    parseJson(req, res, (parseError?: unknown) => {
      if (res.headersSent || res.destroyed) return;
      if (parseError) {
        const error = parseError as { status?: number };
        const status =
          error.status === 413 ? 413 : error.status === 415 ? 415 : 400;
        res.status(status).json({
          code:
            status === 413
              ? "PAYLOAD_TOO_LARGE"
              : status === 415
                ? "UNSUPPORTED_MEDIA_TYPE"
                : "BAD_REQUEST",
          message:
            status === 413
              ? "Report preview request exceeds 1 MiB"
              : status === 415
                ? "Unsupported JSON encoding"
                : "Invalid JSON body",
        });
        return;
      }

      void (async () => {
        try {
          const parsed = previewInputSchema.safeParse(req.body);
          if (!parsed.success) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Invalid load-factor preview. Use reportId 44 with supported filters and columns",
            });
          }
          const context = await options.createContext({ req, res });
          const result = await options.runReport(parsed.data, context);
          // The enclosing API timeout can have completed the response while a
          // database query was still finishing. Do not write a second response.
          if (!res.headersSent && !res.destroyed) res.json(result);
        } catch (cause) {
          if (res.headersSent || res.destroyed) return;
          const error =
            cause instanceof TRPCError
              ? cause
              : new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause });
          if (error.code === "INTERNAL_SERVER_ERROR") options.onError?.(cause);
          res.status(getHTTPStatusCodeFromError(error)).json({
            code: error.code,
            message:
              error.code === "INTERNAL_SERVER_ERROR"
                ? "Internal server error"
                : error.message,
          });
        }
      })();
    });
  };
  router.all(
    "/reports/preview",
    prepare,
    ...(options.rateLimit ? [options.rateLimit] : []),
    handler
  );
  return router;
}
