# AIS Aviation System - Architecture Documentation

**Version:** 3.0
**Last Updated:** February 2026

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Patterns](#architecture-patterns)
3. [Technology Stack](#technology-stack)
4. [Database Design](#database-design)
5. [API Architecture](#api-architecture)
6. [Frontend Architecture](#frontend-architecture)
7. [Security Architecture](#security-architecture)
8. [Payment Flow](#payment-flow)
9. [Deployment Architecture](#deployment-architecture)
10. [Scalability & Performance](#scalability--performance)

---

## System Overview

AIS (Aviation Information System) is a full-stack web application for flight booking and management. The system follows a modern three-tier architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│  React 19 + TypeScript + Tailwind CSS + shadcn/ui          │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ tRPC (Type-safe API)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Business Logic Layer                      │
│    Express + tRPC Routers + Services + Middleware           │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Persistence Layer                    │
│              MySQL/TiDB + Redis (cache + queues)            │
└─────────────────────────────────────────────────────────────┘
```

### Core Capabilities

1. **Flight Management** - Search, browse, and manage flight schedules
2. **Booking System** - Complete booking flow with inventory management
3. **Payment Processing** - Secure payment via Stripe with split payments
4. **E-Ticketing** - PDF generation for tickets and boarding passes
5. **User Management** - Authentication, profiles, and preferences
6. **Loyalty Program** - Miles earning, redemption, and family pooling
7. **Admin Dashboard** - Analytics, reports, and system management
8. **Gate Management** - Airport gate assignments and change tracking
9. **Vouchers & Credits** - Promotional codes and user credit system
10. **Background Jobs** - BullMQ worker for emails, notifications, and queue processing
11. **DCS** - Departure Control System for boarding management
12. **AI Chat** - AI-powered booking assistant
13. **Disruption Handling** - Automated flight disruption management and rebooking

---

## Architecture Patterns

### 1. Layered Architecture

```
┌──────────────────────────────────────────┐
│         Controllers (tRPC Routers)        │  ← API endpoints
├──────────────────────────────────────────┤
│         Services (Business Logic)         │  ← Core logic
├──────────────────────────────────────────┤
│         Repositories (Data Access)        │  ← Database queries
├──────────────────────────────────────────┤
│         Models (Database Schema)          │  ← Data structures
└──────────────────────────────────────────┘
```

**Benefits:**

- Clear separation of concerns
- Easy to test each layer independently
- Maintainable and scalable codebase

### 2. Domain-Driven Design (DDD)

The codebase is organized by business domains:

- **Flights Domain** - Flight search, scheduling, status, price calendar
- **Bookings Domain** - Reservations, modifications, cancellations, group bookings
- **Payments Domain** - Checkout, refunds, split payments, vouchers, credits
- **Loyalty Domain** - Miles, tiers, rewards, family pooling, wallet
- **Admin Domain** - Analytics, management, reports, DCS
- **Operations Domain** - Gate management, disruptions, rebooking, baggage
- **Commercial Domain** - Corporate accounts, travel agents, price alerts
- **Communication Domain** - Notifications, SMS, email, AI chat

### 3. Type-Safe End-to-End

```typescript
// Backend defines the schema
export const flightsRouter = router({
  search: publicProcedure
    .input(z.object({ origin: z.string(), ... }))
    .query(async ({ input }) => { ... }),
});

// Frontend gets automatic types
const { data } = trpc.flights.search.useQuery({ origin: 'RUH' });
//     ^? FlightSearchResult[] - fully typed!
```

No need for manual API documentation or type definitions!

---

## Technology Stack

### Backend Stack

| Component        | Technology     | Purpose                    |
| ---------------- | -------------- | -------------------------- |
| **Runtime**      | Node.js 22     | JavaScript runtime         |
| **Framework**    | Express 4      | Web server                 |
| **API Layer**    | tRPC 11        | Type-safe RPC framework    |
| **Database ORM** | Drizzle        | Type-safe database queries |
| **Database**     | MySQL 8 / TiDB | Relational database        |
| **Validation**   | Zod 4          | Runtime type validation    |
| **Payments**     | Stripe API     | Payment processing         |
| **Auth**         | Manus OAuth    | Authentication service     |
| **Logging**      | Pino           | Structured logging         |
| **Testing**      | Vitest         | Unit & integration tests   |

### Frontend Stack

| Component      | Technology      | Purpose                 |
| -------------- | --------------- | ----------------------- |
| **Framework**  | React 19        | UI library              |
| **Language**   | TypeScript 5.9  | Type-safe JavaScript    |
| **Build Tool** | Vite 7          | Fast build & HMR        |
| **Styling**    | Tailwind CSS 4  | Utility-first CSS       |
| **Components** | shadcn/ui       | Pre-built components    |
| **Routing**    | Wouter          | Client-side routing     |
| **State**      | React Query     | Server state management |
| **Forms**      | React Hook Form | Form management         |
| **i18n**       | react-i18next   | Internationalization    |
| **Icons**      | Lucide React    | Icon library            |

### DevOps & Tools

- **Package Manager:** pnpm
- **Code Quality:** Prettier, TypeScript ESLint
- **E2E Testing:** Playwright
- **Containerization:** Docker
- **CI/CD:** GitHub Actions (recommended)

---

## Database Design

### Entity-Relationship Diagram

```
┌──────────┐       ┌──────────┐       ┌──────────┐
│  USERS   │──────>│ BOOKINGS │<──────│ FLIGHTS  │
└──────────┘       └──────────┘       └──────────┘
     │                  │                   │
     │                  │                   │
     ▼                  ▼                   ▼
┌──────────┐       ┌──────────┐       ┌──────────┐
│ LOYALTY  │       │PASSENGERS│       │ AIRLINES │
│ ACCOUNTS │       └──────────┘       └──────────┘
└──────────┘            │
     │                  │              ┌──────────┐
     │                  │              │ AIRPORTS │
     ▼                  ▼              └──────────┘
┌──────────┐       ┌──────────┐
│  MILES   │       │ PAYMENTS │
│TRANSACT. │       └──────────┘
└──────────┘            │
                        ▼
                   ┌──────────┐
                   │ REFUNDS  │
                   └──────────┘
```

### Core Tables

#### 1. **users**

Stores user accounts and authentication data.

```sql
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  openid VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255),
  phone_number VARCHAR(20),
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 2. **flights**

Flight schedules and availability.

```sql
CREATE TABLE flights (
  id INT PRIMARY KEY AUTO_INCREMENT,
  flight_number VARCHAR(10) NOT NULL,
  airline_id INT NOT NULL,
  origin_airport_id INT NOT NULL,
  destination_airport_id INT NOT NULL,
  departure_time TIMESTAMP NOT NULL,
  arrival_time TIMESTAMP NOT NULL,
  status ENUM('scheduled', 'delayed', 'cancelled', 'completed'),
  base_price DECIMAL(10,2),
  available_seats INT,
  total_seats INT,
  cabin_class ENUM('economy', 'business', 'first'),

  INDEX idx_route_date (origin_airport_id, destination_airport_id, departure_time),
  INDEX idx_airline (airline_id),
  INDEX idx_status (status)
);
```

#### 3. **bookings**

Customer reservations and booking details.

```sql
CREATE TABLE bookings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  flight_id INT NOT NULL,
  booking_reference VARCHAR(6) UNIQUE NOT NULL,
  pnr VARCHAR(6) UNIQUE NOT NULL,
  status ENUM('pending', 'confirmed', 'cancelled', 'completed'),
  total_amount DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_user (user_id),
  INDEX idx_flight (flight_id),
  INDEX idx_reference (booking_reference)
);
```

#### 4. **passengers**

Individual passenger details for bookings.

```sql
CREATE TABLE passengers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  passport_number VARCHAR(20) NOT NULL,
  nationality VARCHAR(2),
  date_of_birth DATE,
  ticket_number VARCHAR(13),
  seat_number VARCHAR(5),

  INDEX idx_booking (booking_id)
);
```

#### 5. **payments**

Payment transactions and history.

```sql
CREATE TABLE payments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL,
  stripe_payment_intent_id VARCHAR(255),
  stripe_session_id VARCHAR(255),
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'SAR',
  status ENUM('pending', 'succeeded', 'failed', 'refunded'),
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_booking (booking_id),
  INDEX idx_stripe_session (stripe_session_id)
);
```

### Advanced Features Tables

The database contains **71 tables** total. Key additional tables:

#### Loyalty Program

- **loyalty_accounts** - User loyalty account info (tier, miles, points)
- **miles_transactions** - Miles earning/spending history
- **family_pools** - Family mile pooling groups

#### Inventory & Pricing

- **inventory_locks** - Temporary seat holds during booking
- **price_locks** - Locked prices for users
- **price_alerts** - User price drop alerts

#### Gate Management

- **airport_gates** - Airport gate definitions with terminal info
- **gate_assignments** - Flight-to-gate assignments with change tracking

#### Vouchers & Credits

- **vouchers** - Promotional/discount codes
- **voucher_usage** - Voucher redemption history
- **user_credits** - User credit balances from refunds/promos
- **credit_usage** - Credit usage tracking

#### Commercial

- **corporate_accounts** - Business travel accounts
- **travel_agents** - Travel agent profiles and commissions
- **waitlist** - Flight waitlist entries

#### Operations

- **split_payments** - Split payment shares between users
- **notifications** - User notification records
- **group_booking_requests** - Group discount requests

#### Service Management

- **ancillary_services** - Extra services catalog (meals, baggage, etc.)
- **booking_ancillaries** - Services added to bookings

#### User Preferences

- **user_preferences** - Seat preferences, meal choices, etc.
- **saved_passengers** - Stored passenger profiles for quick booking

---

## API Architecture

### tRPC Router Structure

The system has **48 registered domain routers** organized by function:

```typescript
export const appRouter = router({
  // Core APIs
  auth,
  flights,
  bookings,
  payments,
  refunds,
  eticket,

  // User Features
  loyalty,
  userPreferences,
  favorites,
  savedPassengers,
  ancillary,
  notifications,
  priceAlerts,
  reviews,

  // Phase 2: Advanced Features
  gates,
  vouchers,
  splitPayments,
  priceCalendar,
  waitlist,
  corporate,
  travelAgent,
  groupBookings,
  priceLock,
  familyPool,
  wallet,
  multiCity,
  baggage,

  // Phase 3: Operations
  dcs,
  disruptions,
  rebooking,
  travelScenarios,
  aiChat,
  inventory,
  pricing,
  softDelete,
  sms,

  // Admin & System
  admin,
  analytics,
  reports,
  reference,
  modifications,
  health,
  system,
  gdpr,
  rateLimit,
  metrics,
  cache,
  specialServices,
});
```

### Request Flow

```
1. Client → HTTP Request → Express Server
              ↓
2. Middleware Chain:
   - Request ID Generation
   - Rate Limiting
   - CORS Headers
   - Cookie Parsing
              ↓
3. tRPC Handler:
   - Input Validation (Zod)
   - Authentication Check
   - Authorization Check
              ↓
4. Router → Service Layer:
   - Business Logic
   - Database Queries
   - External API Calls
              ↓
5. Response → Client
   - Serialization (SuperJSON)
   - Error Handling
   - Logging
```

### Middleware Stack

1. **requestIdMiddleware** - Assigns unique ID to each request
2. **rateLimiter** - Prevents abuse (100 req/15min)
3. **authMiddleware** - Validates JWT tokens
4. **adminMiddleware** - Checks admin role

### Error Handling

Standardized error responses:

```typescript
{
  error: {
    code: 'NOT_FOUND',
    message: 'Flight not found',
    data: { flightId: 123 }  // Optional context
  }
}
```

---

## Frontend Architecture

### Component Hierarchy

```
App
├── Providers (Query, i18n, Theme)
├── Layout
│   ├── Header
│   │   ├── Navigation
│   │   ├── LanguageSelector
│   │   └── UserMenu
│   ├── Main Content
│   │   └── Router
│   │       ├── HomePage
│   │       ├── SearchPage
│   │       ├── BookingFlow
│   │       │   ├── FlightSelection
│   │       │   ├── PassengerInfo
│   │       │   └── Payment
│   │       ├── MyBookings
│   │       └── AdminDashboard
│   └── Footer
```

### State Management Strategy

1. **Server State** - React Query (via tRPC hooks)
   - Automatic caching
   - Background refetching
   - Optimistic updates

2. **Client State** - React Context + useState
   - Theme preference
   - Language selection
   - Currency preference

3. **Form State** - React Hook Form
   - Form validation
   - Error handling
   - Field-level state

### Data Flow

```
User Action → Event Handler → tRPC Mutation/Query
                                      ↓
                              React Query Cache
                                      ↓
                              Component Re-render
                                      ↓
                              Updated UI
```

---

## Security Architecture

### Authentication Flow

```
1. User Login → OAuth Server (Manus)
              ↓
2. OAuth Server returns tokens
              ↓
3. Backend validates tokens
              ↓
4. JWT Cookie set (httpOnly, secure)
              ↓
5. Subsequent requests include cookie
              ↓
6. Backend validates JWT for each request
```

### Security Measures

| Layer                | Protection                 | Implementation      |
| -------------------- | -------------------------- | ------------------- |
| **Transport**        | HTTPS only                 | Nginx/Load Balancer |
| **Cookies**          | httpOnly, Secure, SameSite | Cookie middleware   |
| **CSRF**             | SameSite cookies           | Express cookies     |
| **Rate Limiting**    | 100 req/15min              | express-rate-limit  |
| **Input Validation** | Zod schemas                | tRPC input          |
| **SQL Injection**    | Parameterized queries      | Drizzle ORM         |
| **XSS**              | React auto-escaping        | React rendering     |
| **Secrets**          | Environment variables      | .env file           |

### Data Privacy

- **PII Masking** in logs (emails, phone numbers, cards)
- **No sensitive data** in client-side code
- **Stripe tokenization** for payment data
- **GDPR compliance** features (data export, deletion)

---

## Payment Flow

### Booking & Payment Process

```
┌─────────────────────────────────────────────────────────┐
│ 1. User selects flight and enters passenger info        │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Frontend calls bookings.create mutation              │
│    - Creates booking in 'pending' status                │
│    - Locks inventory (inventory_locks table)            │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Backend creates Stripe Checkout Session              │
│    - Returns session URL                                │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 4. User redirected to Stripe payment page               │
│    - Enters card details (PCI-compliant)                │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 5. Stripe processes payment                             │
│    - Sends webhook to backend                           │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 6. Webhook handler:                                     │
│    - Updates booking status to 'confirmed'              │
│    - Generates e-tickets (PDF)                          │
│    - Awards loyalty miles                               │
│    - Sends confirmation email                           │
│    - Releases inventory lock                            │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ 7. User redirected to success page                      │
│    - Displays booking details                           │
│    - Provides e-ticket download                         │
└─────────────────────────────────────────────────────────┘
```

### Idempotency

All payment operations use idempotency keys to prevent duplicate charges:

```typescript
const idempotencyKey = `booking-${bookingId}-${Date.now()}`;
const existing = await db.query.payments.findFirst({
  where: eq(payments.idempotencyKey, idempotencyKey),
});

if (existing) {
  return existing; // Return existing payment
}

// Create new payment...
```

---

## Deployment Architecture

### Production Environment

```
                    ┌──────────────┐
                    │ Load Balancer│
                    │   (Nginx)    │
                    └──────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │  Node.js │   │  Node.js │   │  Node.js │
    │ Instance │   │ Instance │   │ Instance │
    └──────────┘   └──────────┘   └──────────┘
            │              │              │
            └──────────────┼──────────────┘
                           ▼
                    ┌──────────────┐
                    │MySQL Cluster │
                    │  (Primary +  │
                    │   Replicas)  │
                    └──────────────┘
                           │
                    ┌──────────────┐
                    │ Redis Cache  │
                    │  + BullMQ    │
                    └──────────────┘
                           │
                    ┌──────────────┐
                    │   Worker     │
                    │ (dist/worker │
                    │    .js)      │
                    └──────────────┘
```

### Container Deployment (Docker)

```dockerfile
# Dockerfile.prod
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
CMD ["pnpm", "start"]
```

### Environment Configuration

- **Development:** Local MySQL, hot reload, debug logging
- **Staging:** Shared database, production build, info logging
- **Production:** Clustered database, CDN, error logging only

---

## Scalability & Performance

### Current Performance Metrics

- **API Response Time:** <100ms (p50), <500ms (p99)
- **Database Queries:** Optimized with indexes
- **Frontend Bundle:** ~500KB (gzipped)
- **Concurrent Users:** Supports 1000+ (tested)

### Optimization Strategies

1. **Database:**
   - Composite indexes on frequently queried columns
   - Connection pooling
   - Read replicas for analytics queries

2. **API:**
   - Response caching (Redis)
   - Background job processing (BullMQ + Redis)
   - Pagination for large datasets
   - Lazy loading for related data

3. **Frontend:**
   - Code splitting (React.lazy)
   - Image optimization (WebP, lazy load)
   - Service Worker for offline support

4. **Caching Strategy:**
   ```
   - Flight search results: 5 minutes
   - Airline/Airport data: 1 hour
   - User profile: Session-based
   - Static assets: 1 year (CDN)
   ```

### Monitoring

Integrated tools:

- **Error Tracking:** Sentry (client + server)
- **Logging:** Pino (structured JSON logging)
- **Analytics:** Umami (optional)

Recommended additional tools:

- **Application:** New Relic, DataDog
- **Database:** Percona Monitoring
- **Logs:** ELK Stack (Elasticsearch, Logstash, Kibana)
- **Uptime:** Pingdom, UptimeRobot

---

## Future Enhancements

1. **Microservices Migration**
   - Separate payment service
   - Dedicated analytics service
   - Event-driven architecture (Kafka)

2. **Real-time Features**
   - WebSocket for live flight updates
   - Real-time seat availability
   - Chat support integration

3. **Advanced Analytics**
   - Machine learning for pricing
   - Predictive analytics for demand
   - Customer behavior analysis

4. **Global Expansion**
   - Multi-region deployment
   - CDN for static assets
   - Localized payment gateways

---

**Document Version:** 3.0
**Last Review:** February 2026
**Next Review:** August 2026
