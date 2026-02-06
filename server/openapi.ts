/**
 * OpenAPI Configuration for AIS Aviation System
 *
 * OpenAPI document generation is deferred to avoid crashing the server
 * at startup when trpc-openapi encounters unsupported procedure types.
 */

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
- Anonymous users: 100 requests/minute
- Authenticated users: 200 requests/minute
- Loyalty members: Higher limits based on tier

### Response Format

All responses follow a consistent format:
- Success: Returns the requested data directly
- Error: Returns an error object with code and message

### API Versioning

Current API version: 1.0.0
Base path: /api
  `.trim(),
  version: "1.0.0",
  baseUrl: process.env.API_BASE_URL || "http://localhost:3000/api",
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
      name: "ais_session",
      description: "Session cookie for web clients",
    },
  },
};

const FALLBACK_DOC = {
  openapi: "3.0.0",
  info: {
    title: OPENAPI_CONFIG.title,
    version: OPENAPI_CONFIG.version,
    description: "OpenAPI documentation temporarily unavailable.",
  },
  paths: {},
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedDoc: any = null;

/**
 * Lazily generate and return the OpenAPI document.
 * Uses dynamic import() to avoid loading trpc-openapi at module level.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getOpenApiDocument(): Promise<any> {
  if (cachedDoc) return cachedDoc;

  try {
    const { generateOpenApiDocument } = await import("trpc-openapi");
    const { appRouter } = await import("./routers");

    cachedDoc = generateOpenApiDocument(appRouter, OPENAPI_CONFIG);
  } catch (error) {
    console.warn(
      "[OpenAPI] Failed to generate OpenAPI document:",
      error instanceof Error ? error.message : error
    );
    cachedDoc = FALLBACK_DOC;
  }

  return cachedDoc;
}

/**
 * OpenAPI specification as JSON string
 */
export async function getOpenApiSpec(): Promise<string> {
  const doc = await getOpenApiDocument();
  return JSON.stringify(doc, null, 2);
}

export { OPENAPI_CONFIG, FALLBACK_DOC };
