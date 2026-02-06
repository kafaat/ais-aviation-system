/**
 * OpenAPI Configuration for AIS Aviation System
 *
 * This module configures the OpenAPI (Swagger) documentation
 * for the tRPC API endpoints.
 */

import { generateOpenApiDocument } from "trpc-openapi";
import { appRouter } from "./routers";

/**
 * OpenAPI Document Configuration
 * Wrapped in try/catch to prevent server crash if any procedure type
 * is not supported by trpc-openapi (e.g., procedures without OpenAPI meta)
 */
let openApiDoc: ReturnType<typeof generateOpenApiDocument>;

try {
  openApiDoc = generateOpenApiDocument(appRouter, {
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
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT access token obtained from the login endpoint",
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "ais_session",
        description: "Session cookie for web clients",
      },
    },
  });
} catch (error) {
  console.warn(
    "[OpenAPI] Failed to generate OpenAPI document:",
    error instanceof Error ? error.message : error
  );
  // Provide a minimal fallback document so the server can still start
  openApiDoc = {
    openapi: "3.0.0",
    info: {
      title: "AIS Aviation System API",
      version: "1.0.0",
      description: "OpenAPI documentation temporarily unavailable.",
    },
    paths: {},
  } as ReturnType<typeof generateOpenApiDocument>;
}

export const openApiDocument = openApiDoc;

/**
 * OpenAPI specification as JSON string
 */
export function getOpenApiSpec(): string {
  return JSON.stringify(openApiDocument, null, 2);
}

/**
 * OpenAPI specification object
 */
export function getOpenApiDocument() {
  return openApiDocument;
}
