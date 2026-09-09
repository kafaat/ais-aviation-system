import { z } from "zod";
import {
  generateOpenApiDocument,
  type OpenApiRouter,
  type OpenAPIObject,
  type OpenApiMeta,
} from "trpc-to-openapi";
import type { AnyRouter } from "@trpc/server";
import { COOKIE_NAME } from "../shared/const";
import { openApiProcedures } from "./_core/rest";

const OPENAPI_CONFIG = {
  title: "AIS Aviation System API",
  description: `
## Overview

The AIS (Aviation Information System) API provides comprehensive endpoints for flight booking and management operations.

### Key Features

- **Flight Search & Booking**: Search for flights, create bookings, manage passengers
- **Payment Processing**: Secure payment handling via Stripe integration
- **User Authentication**: JWT-based authentication with refresh token rotation
- **Loyalty Program**: Miles tracking, tier benefits, and redemption
- **Admin Operations**: Flight management, booking oversight, analytics

### Authentication

Most endpoints require authentication. The API supports two authentication methods:

1. **JWT Bearer Token**: Include the access token in the Authorization header
   \`\`\`
   Authorization: Bearer <access_token>
   \`\`\`

2. **Session Cookie**: For web clients, authentication is handled via HTTP-only cookies

### Rate Limiting

API requests are rate-limited based on user tier:
Read X-RateLimit-* response headers for the effective quota. Sensitive procedures also enforce a separate per-procedure quota.

### Response Format

All responses follow a consistent format:
- Success: Returns the requested data directly
- Error: Returns an error object with code and message

### API Versioning

Current API version: 1.0.0
Base path: /api/rest
  `.trim(),
  version: "1.0.0",
  baseUrl: process.env.API_BASE_URL || "http://localhost:3000/api/rest",
  docsUrl: "/api/docs",
  tags: [
    "Authentication",
    "Flights",
    "Bookings",
    "Payments",
    "Refunds",
    "Loyalty",
    "User Preferences",
    "Favorites",
    "Reviews",
    "E-Tickets",
    "Ancillary Services",
    "Admin",
    "Analytics",
    "Health",
    "Reference Data",
  ],
  securitySchemes: {
    bearerAuth: {
      type: "http" as const,
      scheme: "bearer",
      bearerFormat: "JWT",
      description: "JWT access token obtained from the login endpoint",
    },
    cookieAuth: {
      type: "apiKey" as const,
      in: "cookie" as const,
      name: COOKIE_NAME,
      description: "Session cookie for web clients",
    },
  },
};

// This view exists only for documentation. Missing output validators are
// explicitly disclosed; adding .output(z.unknown()) to the real procedures
// would discard their inferred client types and falsely suggest validation.
// Clone schemas before adding JSON serialization metadata for Date values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function documentSchema(value: any): any {
  if (value instanceof z.ZodDate) {
    return value.meta({
      ...value.meta(),
      override: { type: "string", format: "date-time" },
    });
  }
  if (value instanceof z.ZodType) {
    const copy = z.clone(value, documentSchema(value.def));
    const metadata = value.meta();
    return metadata ? copy.meta(metadata) : copy;
  }
  if (Array.isArray(value)) return value.map(documentSchema);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, documentSchema(item)])
    );
  }
  return value;
}

function complexQuerySchema(schema: z.ZodType): boolean {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault
  )
    return complexQuerySchema(schema.unwrap() as z.ZodType);
  if (schema instanceof z.ZodArray)
    return complexQuerySchema(schema.element as z.ZodType);
  return schema instanceof z.ZodObject || schema instanceof z.ZodRecord;
}

function documentInput(parser: unknown, method: string): unknown {
  const copy = documentSchema(parser);
  const unwrapped = copy instanceof z.ZodOptional ? copy.unwrap() : copy;
  if (
    !["GET", "DELETE"].includes(method) ||
    !(unwrapped instanceof z.ZodObject)
  )
    return copy;
  const shape = Object.fromEntries(
    Object.entries(unwrapped.shape).map(([key, schema]) => {
      if (!complexQuerySchema(schema as z.ZodType)) return [key, schema];
      const json = z
        .string()
        .describe(`JSON-encoded ${key}; validated by the original procedure`);
      return [
        key,
        (schema as z.ZodType).safeParse(undefined).success
          ? json.optional()
          : json,
      ];
    })
  ) as z.ZodRawShape;
  const result = z.object(shape);
  return copy instanceof z.ZodOptional ? result.optional() : result;
}

export function buildOpenApiDocument(router: AnyRouter): OpenAPIObject {
  const routes = openApiProcedures(router);
  const procedures = Object.fromEntries(
    routes.map(({ name, procedure, meta }) => [
      name,
      {
        ...procedure,
        _def: {
          ...procedure._def,
          inputs: procedure._def.inputs.map(parser =>
            documentInput(parser, meta.method)
          ),
          // tRPC's runtime definition retains the explicit output parser.
          output: documentSchema(
            (procedure._def as { output?: z.ZodType }).output ?? z.unknown()
          ),
          meta: {
            ...(procedure._def.meta as OpenApiMeta),
            openapi: {
              ...meta,
              protect:
                (procedure._def.meta as OpenApiMeta)?.restPublic !== true,
            },
          },
        },
      },
    ])
  );
  const view = {
    ...router,
    _def: { ...router._def, procedures },
  } as unknown as OpenApiRouter;
  const doc = generateOpenApiDocument(view, OPENAPI_CONFIG);
  for (const { procedure, meta } of routes) {
    const path = meta.path.replace(/\/$/, "") || "/";
    const operation = doc.paths?.[path]?.[meta.method.toLowerCase() as "get"];
    if (operation && !(procedure._def as { output?: unknown }).output) {
      operation["x-response-schema-unavailable"] = true;
    }
  }
  if (!Object.keys(doc.paths ?? {}).length)
    throw new Error("OpenAPI document has no endpoints");
  return doc;
}

let cachedDoc: OpenAPIObject | undefined;
export async function getOpenApiDocument(): Promise<OpenAPIObject> {
  if (!cachedDoc) {
    const { appRouter } = await import("./routers");
    // Cache only a successfully generated document. Failures reach HTTP/CLI.
    cachedDoc = buildOpenApiDocument(appRouter);
  }
  return cachedDoc;
}

export async function getOpenApiSpec(): Promise<string> {
  return JSON.stringify(await getOpenApiDocument(), null, 2);
}

export { OPENAPI_CONFIG };
