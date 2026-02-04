# CLAUDE.md - AI Assistant Guidelines for AIS Aviation System

This document provides essential context and conventions for AI assistants working on the AIS Aviation System codebase.

## Project Overview

AIS (Aviation Information System) is a full-stack flight booking and management platform. It handles flight search, booking, payment processing, e-ticketing, loyalty programs, and admin operations.

- **Repository**: https://github.com/kafaat/ais-aviation-system
- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js 22+
- **Package Manager**: pnpm

## Quick Reference Commands

```bash
# Development
pnpm install          # Install dependencies
pnpm dev              # Start development server (http://localhost:3000)
pnpm build            # Build for production
pnpm start            # Start production server

# Code Quality
pnpm check            # TypeScript type checking
pnpm lint             # Run ESLint
pnpm lint:fix         # Fix ESLint issues
pnpm format           # Format with Prettier

# Testing
pnpm test             # Run all tests (Vitest)
pnpm test <file>      # Run specific test file

# Database
pnpm db:push          # Apply schema changes to database
pnpm db:generate      # Generate migrations from schema changes
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Drizzle Studio for database inspection
```

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Wouter |
| **API** | tRPC 11 (type-safe RPC) |
| **Backend** | Express 4 |
| **Database** | MySQL/TiDB with Drizzle ORM |
| **Payments** | Stripe |
| **Testing** | Vitest, Playwright |
| **Build** | Vite 7, esbuild |

### Directory Structure

```
ais-aviation-system/
├── client/                    # Frontend application
│   └── src/
│       ├── components/        # React components
│       │   └── ui/           # shadcn/ui components
│       ├── pages/            # Page components
│       ├── hooks/            # Custom React hooks
│       ├── contexts/         # React contexts
│       ├── lib/              # Utilities (includes trpc.ts client)
│       └── i18n/             # Internationalization (AR/EN)
│
├── server/                    # Backend application
│   ├── _core/                # Core server setup
│   │   ├── index.ts          # Server entry point
│   │   ├── trpc.ts           # tRPC setup with procedures
│   │   ├── context.ts        # Request context creation
│   │   └── middleware/       # Express middlewares
│   ├── routers/              # tRPC API routers (organized by domain)
│   ├── services/             # Business logic layer
│   ├── webhooks/             # Stripe webhook handlers
│   ├── jobs/                 # Background jobs
│   ├── queue/                # Job queue workers (BullMQ)
│   ├── db.ts                 # Database client and helper functions
│   ├── routers.ts            # Main router combining all domain routers
│   └── __tests__/            # Server tests
│
├── drizzle/                   # Database schema and migrations
│   ├── schema.ts             # Main database schema (source of truth)
│   └── migrations/           # Generated migration files
│
├── shared/                    # Shared code between client/server
│   ├── types.ts              # Shared type exports
│   └── const.ts              # Shared constants
│
├── scripts/                   # Utility scripts
├── docs/                      # Documentation
└── e2e/                       # End-to-end tests (Playwright)
```

## Coding Patterns & Conventions

### tRPC Router Pattern

Routers are organized by business domain in `server/routers/`. Each router uses the procedures from `server/_core/trpc.ts`:

```typescript
// server/routers/example.ts
import { z } from "zod";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";

export const exampleRouter = router({
  // Public endpoint (no auth required)
  getPublicData: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await someService.getData(input.id);
    }),

  // Protected endpoint (requires authenticated user)
  getUserData: protectedProcedure.query(async ({ ctx }) => {
    return await someService.getUserData(ctx.user.id);
  }),

  // Admin-only endpoint
  adminAction: adminProcedure
    .input(z.object({ action: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return await adminService.performAction(input.action);
    }),
});
```

Register new routers in `server/routers.ts`:

```typescript
import { exampleRouter } from "./routers/example";

export const appRouter = router({
  // ... existing routers
  example: exampleRouter,
});
```

### Service Layer Pattern

Business logic is separated into services in `server/services/`:

```typescript
// server/services/example.service.ts
import { getDb } from "../db";
import { someTable } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export async function getSomething(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.select().from(someTable).where(eq(someTable.id, id));
}
```

### Database Schema Pattern

All tables are defined in `drizzle/schema.ts` using Drizzle ORM:

```typescript
import { int, mysqlTable, varchar, timestamp, mysqlEnum, index } from "drizzle-orm/mysql-core";

export const examples = mysqlTable("examples", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  nameIdx: index("name_idx").on(table.name),
}));

export type Example = typeof examples.$inferSelect;
export type InsertExample = typeof examples.$inferInsert;
```

### Frontend tRPC Usage

```typescript
import { trpc } from "@/lib/trpc";

function MyComponent() {
  // Query
  const { data, isLoading, error } = trpc.flights.search.useQuery({
    originId: 1,
    destinationId: 2,
    departureDate: new Date(),
  });

  // Mutation
  const createBooking = trpc.bookings.create.useMutation({
    onSuccess: (data) => {
      toast.success("Booking created!");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  return (/* JSX */);
}
```

### Path Aliases

Configured in `tsconfig.json`:

```typescript
// Client imports
import { Button } from "@/components/ui/button";

// Shared imports
import { SomeType } from "@shared/types";
```

## Testing Guidelines

### Test File Location & Naming

- Unit tests: colocated with source files (`*.test.ts` or `*.spec.ts`)
- Integration tests: `server/__tests__/integration/`
- Feature tests: `server/__tests__/new-features/`

### Test Structure

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

describe("Feature Name", () => {
  beforeAll(async () => {
    // Setup
  });

  afterAll(async () => {
    // Cleanup
  });

  it("should do something specific", async () => {
    // Arrange
    const input = { /* test data */ };

    // Act
    const result = await someFunction(input);

    // Assert
    expect(result).toBeDefined();
    expect(result.status).toBe("success");
  });
});
```

### Running Tests

```bash
pnpm test                           # Run all tests
pnpm test server/services/          # Run tests in directory
pnpm test booking.test.ts           # Run specific test file
```

## Key Domain Concepts

### Core Entities

| Entity | Description |
|--------|-------------|
| `users` | User accounts with roles (user, admin, super_admin, etc.) |
| `flights` | Flight schedules with pricing and availability |
| `bookings` | Reservations linking users to flights |
| `passengers` | Individual passenger details per booking |
| `payments` | Payment transactions (Stripe integration) |
| `loyaltyAccounts` | User loyalty/miles program |
| `ancillaryServices` | Add-on services (baggage, meals, etc.) |

### Booking Flow

1. User searches flights (`flights.search`)
2. Creates booking with passenger info (`bookings.create`) - status: `pending`
3. Redirected to Stripe Checkout
4. Stripe webhook confirms payment
5. Booking confirmed, e-ticket generated

### Important Status Enums

**Booking Status**: `pending` → `confirmed` → `completed` (or `cancelled`)
**Payment Status**: `pending` → `paid` (or `failed`, `refunded`)
**Flight Status**: `scheduled`, `delayed`, `cancelled`, `completed`

## API Routes Structure

All tRPC routes are under `/api/trpc/*`. Main routers:

| Router | Purpose |
|--------|---------|
| `auth` | Authentication (me, logout) |
| `flights` | Flight search and details |
| `bookings` | Booking CRUD operations |
| `payments` | Payment processing |
| `refunds` | Refund handling |
| `loyalty` | Loyalty program |
| `admin` | Admin operations |
| `analytics` | Reports and statistics |
| `health` | Health check endpoints |

## Environment Variables

Copy `.env.example` to `.env`. Critical variables:

```bash
DATABASE_URL=mysql://user:pass@host:3306/database
JWT_SECRET=<strong-secret>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Security Considerations

1. **Never commit** `.env` files or secrets
2. **Input validation**: Always use Zod schemas for tRPC inputs
3. **Protected routes**: Use `protectedProcedure` for authenticated endpoints
4. **Admin routes**: Use `adminProcedure` for admin-only operations
5. **Stripe webhooks**: Verify signatures in webhook handler
6. **SQL injection**: Drizzle ORM handles parameterization

## Code Style Rules

1. **TypeScript strict mode** - no `any` types unless absolutely necessary
2. **Prefer `const`** over `let`
3. **Use `async/await`** over raw promises
4. **Prefix unused variables** with `_` (e.g., `_unused`)
5. **Named exports** preferred over default exports
6. **Error handling**: Always catch and handle errors appropriately

## ESLint Rules (Key Points)

- `@typescript-eslint/no-explicit-any`: warn
- `@typescript-eslint/no-unused-vars`: warn (with `_` prefix ignore)
- `no-console`: warn (allow `warn`, `error`, `info`)
- `prefer-const`: error
- `eqeqeq`: error (use `===` except for null)

## Internationalization

The app supports Arabic (AR) and English (EN). Translation files are in `client/src/i18n/locales/`.

```typescript
import { useTranslation } from "react-i18next";

const { t } = useTranslation();
<span>{t("booking.confirm")}</span>
```

## Common Tasks

### Adding a New API Endpoint

1. Create/update service in `server/services/`
2. Add procedure to appropriate router in `server/routers/`
3. If new router, register in `server/routers.ts`
4. Frontend automatically gets types via tRPC

### Adding a New Database Table

1. Define table in `drizzle/schema.ts`
2. Run `pnpm db:push` to apply changes
3. Create helper functions in `server/db.ts` if needed

### Adding a New Page

1. Create component in `client/src/pages/`
2. Add route in `client/src/App.tsx` (uses Wouter)

## Troubleshooting

### Type Errors After Schema Changes

```bash
pnpm db:generate  # Generate types from schema
pnpm check        # Verify types
```

### Database Connection Issues

- Check `DATABASE_URL` in `.env`
- Ensure MySQL/TiDB is running
- Verify network access to database

### Stripe Webhook Issues

- Use Stripe CLI for local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
- Update `STRIPE_WEBHOOK_SECRET` with the secret from CLI

## Additional Resources

- [Developer Guide](docs/DEVELOPER_GUIDE.md)
- [Architecture Documentation](docs/ARCHITECTURE.md)
- [API Documentation](docs/API_DOCUMENTATION.md)
- [Security Guide](docs/SECURITY.md)
- [Troubleshooting Guide](docs/TROUBLESHOOTING.md)

---

**Note for AI Assistants**: When making changes, always run `pnpm check` to verify TypeScript types and `pnpm test` for affected areas. Follow the existing patterns in the codebase for consistency.
