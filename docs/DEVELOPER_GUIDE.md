# AIS Aviation System - Developer Guide

**Version:** 3.0
**Last Updated:** February 2026
**Author:** Manus AI

---

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Project Structure](#project-structure)
4. [Development Workflow](#development-workflow)
5. [Database Management](#database-management)
6. [API Development](#api-development)
7. [Frontend Development](#frontend-development)
8. [Testing](#testing)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

---

## Introduction

The AIS (Aviation Information System) is a comprehensive flight booking and management platform built with modern technologies. This guide will help developers understand the codebase and contribute effectively.

### Tech Stack Overview

**Backend:**

- Node.js 22+ with TypeScript
- Express 4 (Web Server)
- tRPC 11 (Type-safe API)
- Drizzle ORM (Database)
- MySQL/TiDB (Database)
- Stripe (Payments)

**Frontend:**

- React 19
- TypeScript 5.9
- Vite 7 (Build Tool)
- Tailwind CSS 4
- shadcn/ui Components
- Wouter (Routing)
- React Query (State Management)

**Testing:**

- Vitest (Unit & Integration Tests)
- Playwright (E2E Tests)

---

## Getting Started

### Prerequisites

Ensure you have the following installed:

```bash
# Node.js 22+ (recommended via nvm)
nvm install 22
nvm use 22

# pnpm package manager
npm install -g pnpm

# MySQL 8.0+ or TiDB
# You can use Docker:
docker run -d \
  --name ais-mysql \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=ais_aviation \
  -p 3306:3306 \
  mysql:8.0
```

### Installation Steps

1. **Clone the repository**

   ```bash
   git clone https://github.com/kafaat/ais-aviation-system.git
   cd ais-aviation-system
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Set up the database**

   ```bash
   # Generate and run migrations
   pnpm db:push

   # Seed initial data (airlines, airports, flights)
   npx tsx scripts/seed-data.mjs
   ```

5. **Start development server**

   ```bash
   pnpm dev
   ```

   The app will be available at `http://localhost:3000`

---

## Project Structure

```
ais-aviation-system/
├── client/                    # Frontend application
│   ├── public/               # Static assets
│   └── src/
│       ├── components/       # Reusable UI components
│       ├── pages/           # Page components
│       ├── contexts/        # React contexts
│       ├── hooks/           # Custom React hooks
│       ├── lib/             # Utilities and helpers
│       └── main.tsx         # App entry point
│
├── server/                   # Backend application
│   ├── _core/               # Core server functionality
│   │   ├── middleware/      # Express middlewares
│   │   ├── env.ts          # Environment validation
│   │   ├── logger.ts       # Logging service
│   │   └── index.ts        # Server entry point
│   │
│   ├── routers/             # tRPC API routers (49 files)
│   │   ├── flights.ts      # Flight operations
│   │   ├── bookings.ts     # Booking management
│   │   ├── payments.ts     # Payment processing
│   │   ├── admin.ts        # Admin operations
│   │   ├── analytics.ts    # Analytics & reports
│   │   ├── gates.ts        # Gate management
│   │   ├── vouchers.ts     # Vouchers & credits
│   │   ├── dcs.ts          # Departure Control System
│   │   ├── disruptions.ts  # Flight disruptions
│   │   └── ...             # 40+ more domain routers
│   │
│   ├── services/            # Business logic (100 files)
│   │   ├── flights.service.ts
│   │   ├── bookings.service.ts
│   │   ├── payments.service.ts
│   │   ├── loyalty.service.ts
│   │   ├── email.service.ts
│   │   ├── sentry.service.ts
│   │   └── ...             # 94+ more services
│   │
│   ├── db.ts               # Database client & queries
│   ├── stripe.ts           # Stripe configuration
│   ├── worker.ts           # Background job worker entry
│   ├── queue/              # BullMQ job queue workers
│   ├── jobs/               # Background job definitions
│   └── webhooks/           # Webhook handlers
│
├── drizzle/                 # Database schema & migrations
│   ├── schema.ts           # Database schema
│   └── migrations/         # Migration files
│
├── scripts/                 # Utility scripts
│   └── seed-data.mjs       # Database seeding
│
├── e2e/                    # End-to-end tests
├── docs/                   # Documentation
└── shared/                 # Shared types & utilities

```

### Key Directories Explained

- **`client/src/components/ui`** - shadcn/ui components (Button, Dialog, etc.)
- **`client/src/components/booking`** - Booking flow components
- **`server/routers`** - API endpoints organized by domain
- **`server/services`** - Business logic separated from API layer
- **`drizzle/schema.ts`** - Single source of truth for database structure

---

## Development Workflow

### Starting Development

```bash
# Start dev server with hot reload
pnpm dev

# Run in watch mode for backend only
pnpm dev:server

# Build for production
pnpm build

# Start production server
pnpm start
```

### Code Quality Tools

```bash
# Type checking
pnpm check

# Format code with Prettier
pnpm format

# Run linter (if configured)
pnpm lint
```

### Git Workflow

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Run tests: `pnpm test`
4. Commit with descriptive message
5. Push and create a Pull Request

---

## Database Management

### Schema Definition

All database tables are defined in `drizzle/schema.ts` using Drizzle ORM:

```typescript
import { mysqlTable, varchar, int, timestamp } from "drizzle-orm/mysql-core";

export const flights = mysqlTable("flights", {
  id: int("id").primaryKey().autoincrement(),
  flightNumber: varchar("flight_number", { length: 10 }).notNull(),
  // ... more fields
});
```

### Migrations

```bash
# Generate migration from schema changes
pnpm drizzle-kit generate

# Apply migrations to database
pnpm drizzle-kit migrate

# Or use combined command
pnpm db:push
```

### Database Queries

Use Drizzle ORM for type-safe queries:

```typescript
import { db } from "./db";
import { flights } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// Select
const flight = await db.select().from(flights).where(eq(flights.id, 1));

// Insert
await db.insert(flights).values({
  flightNumber: "AIS123",
  // ... other fields
});

// Update
await db.update(flights).set({ status: "delayed" }).where(eq(flights.id, 1));
```

### Seeding Data

Run the seed script to populate the database with test data:

```bash
npx tsx scripts/seed-data.mjs
```

This creates:

- 6 airlines (SV, MS, EK, QR, IY, WY)
- 9 airports (RUH, JED, DXB, CAI, DOH, DMM, SAH, ADE, MCT)
- 15 flights
- 7 currencies (SAR, USD, EUR, AED, EGP, YER, OMR)
- Admin user

### Background Worker

The system includes a background job worker for processing tasks asynchronously:

```bash
# Build the worker
pnpm build   # Produces dist/index.js (server) and dist/worker.js (worker)

# Start the worker (requires Redis)
node dist/worker.js
```

The worker handles:

- Email notifications (booking confirmation, cancellation)
- Cancellation and refund processing
- Push notification delivery
- Price alert checking and notification
- Inventory lock cleanup

---

## API Development

### tRPC Router Structure

All APIs are organized in `server/routers/` and exported via `routers.ts`:

```typescript
// server/routers/flights.ts
import { router, publicProcedure } from "../_core/trpc";
import { z } from "zod";

export const flightsRouter = router({
  search: publicProcedure
    .input(
      z.object({
        origin: z.string(),
        destination: z.string(),
        date: z.string(),
      })
    )
    .query(async ({ input }) => {
      // Your logic here
      return await searchFlights(input);
    }),
});
```

### Input Validation

Use Zod for runtime type checking:

```typescript
const bookingSchema = z.object({
  flightId: z.number().positive(),
  passengers: z.array(z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    passportNumber: z.string().min(6),
  })),
});

// In tRPC procedure
.input(bookingSchema)
```

### Error Handling

Use tRPC error codes:

```typescript
import { TRPCError } from "@trpc/server";

throw new TRPCError({
  code: "BAD_REQUEST",
  message: "Flight is fully booked",
});

// Available codes: BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, INTERNAL_SERVER_ERROR
```

### Middleware & Authentication

Protected procedures use middleware:

```typescript
import { protectedProcedure } from "../_core/trpc";

export const bookingsRouter = router({
  myBookings: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id; // Authenticated user
    return await getMyBookings(userId);
  }),
});
```

---

## Frontend Development

### Component Structure

Follow the atomic design pattern:

```
components/
├── ui/              # Atoms (Button, Input, etc.)
├── booking/         # Molecules (BookingCard, PassengerForm)
└── layouts/         # Organisms (Header, Footer)
```

### Using tRPC Client

```typescript
import { trpc } from '@/lib/trpc';

function FlightSearch() {
  const { data, isLoading } = trpc.flights.search.useQuery({
    origin: 'RUH',
    destination: 'JED',
    date: '2026-02-15',
  });

  if (isLoading) return <div>Loading...</div>;

  return <FlightList flights={data} />;
}
```

### Mutations

```typescript
const bookFlight = trpc.bookings.create.useMutation({
  onSuccess: (booking) => {
    toast.success('Booking created!');
    navigate(`/bookings/${booking.id}`);
  },
  onError: (error) => {
    toast.error(error.message);
  },
});

// Use in component
<button onClick={() => bookFlight.mutate(bookingData)}>
  Book Now
</button>
```

### Styling

Use Tailwind CSS with shadcn/ui conventions:

```tsx
<div className="flex flex-col gap-4 p-6 bg-white rounded-lg shadow">
  <h2 className="text-2xl font-bold">Flight Details</h2>
  <p className="text-gray-600">...</p>
</div>
```

### Internationalization (i18n)

The app supports Arabic and English:

```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();

  return <h1>{t('welcome')}</h1>;
}
```

---

## Testing

### Unit Tests (Vitest)

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test flights.test.ts

# Watch mode
pnpm test:watch
```

Example test:

```typescript
import { describe, it, expect } from "vitest";
import { calculateFlightPrice } from "./pricing.service";

describe("calculateFlightPrice", () => {
  it("should calculate correct price for economy class", () => {
    const price = calculateFlightPrice({
      basePrice: 500,
      cabinClass: "economy",
    });
    expect(price).toBe(500);
  });
});
```

### E2E Tests (Playwright)

```bash
# Run E2E tests
pnpm test:e2e

# Run in UI mode
pnpm test:e2e:ui
```

### Test Coverage

Aim for:

- **Services**: 80%+ coverage
- **Routers**: 70%+ coverage
- **Critical paths**: 100% coverage (payments, bookings)

---

## Best Practices

### Code Style

1. **TypeScript strict mode** - Always enabled
2. **No `any` types** - Use proper typing
3. **Named exports** - Easier to refactor
4. **Async/await** - Prefer over promises
5. **Error handling** - Always handle errors

### Database

1. **Use transactions** for multi-step operations
2. **Add indexes** for frequently queried fields
3. **Validate data** before database operations
4. **Soft deletes** for important data (bookings, payments)

### Security

1. **Never expose secrets** in client code
2. **Validate all inputs** with Zod
3. **Use parameterized queries** (Drizzle handles this)
4. **Rate limiting** on public endpoints
5. **HTTPS only** in production

### Performance

1. **Database indexes** on foreign keys
2. **Pagination** for large datasets
3. **Caching** for frequently accessed data
4. **Lazy loading** for images and routes
5. **Code splitting** in frontend

---

## Troubleshooting

### Common Issues

#### "Database connection failed"

```bash
# Check if MySQL is running
docker ps | grep mysql

# Test connection
mysql -h localhost -u user -p

# Verify DATABASE_URL in .env
```

#### "Module not found" errors

```bash
# Clear cache and reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

#### "Stripe webhook signature verification failed"

```bash
# Use Stripe CLI for local testing
stripe listen --forward-to localhost:3000/api/stripe/webhook

# Update STRIPE_WEBHOOK_SECRET with the secret from CLI
```

#### TypeScript errors after schema changes

```bash
# Regenerate types
pnpm drizzle-kit generate
pnpm check
```

### Debug Mode

Enable debug logging:

```bash
# In .env
LOG_LEVEL=debug
DEBUG=true
```

### Getting Help

1. Check existing documentation in `docs/`
2. Review test files for examples
3. Search GitHub issues
4. Contact the team via email

---

## Docker Development

### Development Environment

```bash
# Start MySQL + Redis + phpMyAdmin
docker-compose up

# Access phpMyAdmin at http://localhost:8080
```

### Production Environment

```bash
# Production lite
docker-compose -f docker-compose.prod.yml up

# Full production (with worker, Redis, SSL)
docker-compose -f docker-compose.production.yml up
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

**Required:**

- `DATABASE_URL` - MySQL connection string
- `JWT_SECRET` - Secret for JWT token signing

**Payment (required for booking flow):**

- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook verification secret

**Optional (with defaults):**

- `REDIS_URL` - Redis connection (default: `redis://localhost:6379`)
- `LOG_LEVEL` - Logging level (default: `info`)
- `SENTRY_DSN` / `VITE_SENTRY_DSN` - Sentry error tracking
- `DB_POOL_SIZE` - Database connection pool size

See `.env.example` for the full list of 60+ configurable variables.

---

## Additional Resources

- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [tRPC Documentation](https://trpc.io/)
- [Stripe API Reference](https://stripe.com/docs/api)
- [React 19 Docs](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/)

---

## Contributing

We welcome contributions! Please:

1. Follow the coding standards
2. Write tests for new features
3. Update documentation
4. Create descriptive commit messages
5. Submit PRs for review

---

**Happy Coding! 🚀**
