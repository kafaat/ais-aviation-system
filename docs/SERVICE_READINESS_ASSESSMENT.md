# تقييم جاهزية الخدمات - AIS Aviation System

**التاريخ:** 26 يناير 2026  
**الإصدار:** 1.0.0  
**الهدف:** تقييم دقيق لجاهزية الإطلاق مع قائمة تنفيذية واضحة

---

## 🎯 الهدف

تقييم المشروع مقابل **معايير إطلاق تجاري حقيقية** في 6 محاور رئيسية، وتحديد:
- ✅ ما هو جاهز فعلاً
- ❌ ما هو ناقص
- 🔴 ما يجب تنفيذه قبل أي إطلاق

---

## 📊 منهجية التقييم

### مستويات الأولوية

| الأولوية | الرمز | الوصف | الإجراء |
|----------|------|-------|---------|
| **P0** | 🔴 | **مانع إطلاق** | يجب تنفيذه قبل أي إطلاق |
| **P1** | 🟠 | **مهم جداً** | ينفذ خلال أول شهر بعد الإطلاق |
| **P2** | 🟡 | **تحسينات نمو** | ينفذ خلال 3-6 أشهر |

### المحاور الستة

1. 🧱 **Correctness & Data Integrity** - صحة الحجز والدفع
2. 💳 **Payments & Webhooks** - Stripe كمصدر حقيقة
3. 📱 **Mobile API Contract** - جاهزية الموبايل
4. ⚡ **Performance & Scalability** - تحمّل الضغط
5. 🛡️ **Security & Observability** - الأمان والرؤية التشغيلية
6. 🏗️ **Ops & Go-Live** - التشغيل والنسخ الاحتياطي

---

## (1) 🧱 Correctness & Data Integrity

### التقييم الحالي

#### ✅ ما هو موجود

1. **State Machine للحجوزات** ✅
   - ملف: `server/services/booking-state-machine.service.ts`
   - الحالات المحددة: 13 حالة
   ```typescript
   "initiated" | "pending" | "reserved" | "paid" | "confirmed" | 
   "checked_in" | "boarded" | "completed" | "cancelled" | 
   "refunded" | "expired" | "payment_failed" | "no_show"
   ```
   - قواعد الانتقال محددة في `VALID_TRANSITIONS`
   - تسجيل تاريخ التغييرات في `bookingStatusHistory`

2. **Idempotency للدفع** ✅ (جزئي)
   - ملف: `server/services/payments.service.ts`
   - يدعم `idempotencyKey` في `createCheckoutSession`
   - يتحقق من المفتاح قبل إنشاء session جديد
   - مخزن في جدول `payments`

#### ❌ ما هو ناقص

1. **Idempotency للحجز** ❌
   - لا يوجد `idempotencyKey` في `createBooking`
   - خطر: double booking عند إعادة إرسال الطلب

2. **Transaction Wrapping** ⚠️ (غير مؤكد)
   - يجب التحقق من أن جميع العمليات الحرجة في transactions
   - مثال: Create booking + Reserve seats + Create payment

3. **Invariants Enforcement** ⚠️
   - لا يوجد validation صريح: "لا Confirm بدون Payment صحيح"
   - يعتمد على application logic فقط

4. **Integration Tests** ❌
   - لا توجد tests شاملة للمسارات الحرجة:
     - Search → Book → Pay → Confirm
     - Cancel → Refund

### 🔴 التصنيف: **P0 – مانع إطلاق**

### ✅ المهام المطلوبة

#### Task 1.1: إضافة Idempotency للحجز
```typescript
// في server/services/bookings.service.ts

export interface CreateBookingInput {
  idempotencyKey: string; // مطلوب
  flightId: number;
  passengers: PassengerInput[];
  // ...
}

export async function createBooking(input: CreateBookingInput) {
  // 1. Check idempotency
  const existing = await getBookingByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return existing; // Return cached result
  }

  // 2. Create booking in transaction
  return await db.transaction(async (tx) => {
    // ... booking logic
  });
}
```

**الملفات المتأثرة:**
- `drizzle/schema.ts` - إضافة `idempotencyKey` لجدول `bookings`
- `server/services/bookings.service.ts` - تطبيق الـ logic
- `server/db.ts` - إضافة `getBookingByIdempotencyKey`

**الجهد:** 4-6 ساعات

---

#### Task 1.2: لف العمليات الحرجة بـ Transactions

```typescript
// مثال: Create booking
export async function createBooking(input: CreateBookingInput) {
  return await db.transaction(async (tx) => {
    // 1. Check seat availability (with lock)
    const flight = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, input.flightId))
      .for('update'); // Row-level lock

    // 2. Create booking
    const booking = await tx.insert(bookings).values({...});

    // 3. Reserve seats
    await tx.update(flights).set({
      availableSeats: sql`${flights.availableSeats} - ${input.passengers.length}`
    });

    // 4. Create passengers
    await tx.insert(passengers).values(...);

    return booking;
  });
}
```

**العمليات التي تحتاج transactions:**
- ✅ Create booking + Reserve seats + Create passengers
- ✅ Cancel booking + Release seats + Create refund
- ✅ Modify booking + Update seats + Create payment/refund
- ✅ Process payment + Update booking status

**الملفات المتأثرة:**
- `server/services/bookings.service.ts`
- `server/services/payments.service.ts`
- `server/services/refunds.service.ts`

**الجهد:** 8-12 ساعات

---

#### Task 1.3: إضافة Integration Tests

```typescript
// server/tests/integration/booking-flow.test.ts

describe('Booking Flow', () => {
  it('should complete full booking flow', async () => {
    // 1. Search flights
    const flights = await api.flights.search.query({...});
    
    // 2. Create booking
    const booking = await api.bookings.create.mutate({
      idempotencyKey: uuidv4(),
      ...
    });
    
    // 3. Process payment
    const payment = await api.payments.create.mutate({...});
    
    // 4. Verify booking confirmed
    expect(booking.status).toBe('confirmed');
    
    // 5. Verify seats updated
    const updatedFlight = await api.flights.get.query({...});
    expect(updatedFlight.availableSeats).toBe(originalSeats - 1);
  });

  it('should prevent double booking', async () => {
    // Test idempotency
  });

  it('should handle payment failure correctly', async () => {
    // Test rollback
  });
});
```

**Test Cases المطلوبة:**
- ✅ Happy path: Search → Book → Pay → Confirm
- ✅ Idempotency: إعادة إرسال نفس الطلب
- ✅ Double booking prevention
- ✅ Payment failure handling
- ✅ Cancellation and refund
- ✅ Seat availability updates

**الملفات الجديدة:**
- `server/tests/integration/booking-flow.test.ts`
- `server/tests/integration/payment-flow.test.ts`
- `server/tests/integration/cancellation-flow.test.ts`

**الجهد:** 12-16 ساعات

---

## (2) 💳 Payments & Stripe Webhooks

### التقييم الحالي

#### ✅ ما هو موجود

1. **Stripe Integration** ✅
   - ملف: `server/services/payments.service.ts`
   - Checkout session creation
   - Payment success handling

#### ❌ ما هو ناقص

1. **Webhook Handler** ❌
   - لا يوجد endpoint لـ Stripe webhooks
   - لا signature verification
   - لا event de-duplication

2. **Event Storage** ❌
   - لا يوجد جدول `stripe_events`
   - خطر: معالجة نفس الـ event مرتين

3. **Financial Ledger** ❌
   - لا يوجد audit trail مالي واضح
   - صعوبة في reconciliation

4. **Reconciliation Job** ❌
   - لا يوجد job للتحقق من تطابق Stripe مع DB

### 🔴 التصنيف: **P0 – مانع إطلاق**

### ✅ المهام المطلوبة

#### Task 2.1: إنشاء Webhook Handler

```typescript
// server/routers/webhooks.ts

import { router, publicProcedure } from "../_core/trpc";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const webhooksRouter = router({
  stripe: publicProcedure
    .input(z.object({
      body: z.string(),
      signature: z.string(),
    }))
    .mutation(async ({ input }) => {
      // 1. Verify signature
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          input.body,
          input.signature,
          process.env.STRIPE_WEBHOOK_SECRET!
        );
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid signature",
        });
      }

      // 2. Check for duplicate
      const existing = await getStripeEventById(event.id);
      if (existing) {
        return { received: true, duplicate: true };
      }

      // 3. Store event
      await storeStripeEvent(event);

      // 4. Process event
      await processStripeEvent(event);

      return { received: true };
    }),
});
```

**الملفات الجديدة:**
- `server/routers/webhooks.ts`
- `server/services/stripe-webhook.service.ts`

**الجهد:** 6-8 ساعات

---

#### Task 2.2: إنشاء جدول Stripe Events

```typescript
// drizzle/schema.ts

export const stripeEvents = pgTable('stripe_events', {
  id: varchar('id', { length: 255 }).primaryKey(), // Stripe event ID
  type: varchar('type', { length: 100 }).notNull(),
  data: json('data').notNull(),
  processed: boolean('processed').default(false).notNull(),
  processedAt: timestamp('processed_at'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  typeIdx: index('stripe_events_type_idx').on(table.type),
  processedIdx: index('stripe_events_processed_idx').on(table.processed),
}));
```

**الملفات المتأثرة:**
- `drizzle/schema.ts`
- Migration file

**الجهد:** 2-3 ساعات

---

#### Task 2.3: إنشاء Financial Ledger

```typescript
// drizzle/schema.ts

export const financialLedger = pgTable('financial_ledger', {
  id: serial('id').primaryKey(),
  bookingId: integer('booking_id').references(() => bookings.id),
  type: varchar('type', { length: 50 }).notNull(), // 'charge', 'refund', 'fee'
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  stripeEventId: varchar('stripe_event_id', { length: 255 }),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
  description: text('description'),
  metadata: json('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  bookingIdIdx: index('financial_ledger_booking_id_idx').on(table.bookingId),
  typeIdx: index('financial_ledger_type_idx').on(table.type),
}));
```

**الملفات المتأثرة:**
- `drizzle/schema.ts`
- `server/services/ledger.service.ts` (جديد)

**الجهد:** 4-6 ساعات

---

#### Task 2.4: إنشاء Reconciliation Job

```typescript
// server/jobs/reconciliation.job.ts

export async function reconcilePayments() {
  // 1. Get all bookings with 'paid' status from last 7 days
  const bookings = await getRecentPaidBookings(7);

  for (const booking of bookings) {
    // 2. Get payment from Stripe
    const stripePayment = await stripe.paymentIntents.retrieve(
      booking.paymentIntentId
    );

    // 3. Compare with our DB
    if (stripePayment.status !== 'succeeded' && booking.status === 'confirmed') {
      // Mismatch! Alert and log
      logger.error('Payment mismatch detected', {
        bookingId: booking.id,
        ourStatus: booking.status,
        stripeStatus: stripePayment.status,
      });

      // Send alert
      await sendAlert({
        type: 'payment_mismatch',
        bookingId: booking.id,
      });
    }
  }
}

// Run daily at 2 AM
schedule.scheduleJob('0 2 * * *', reconcilePayments);
```

**الملفات الجديدة:**
- `server/jobs/reconciliation.job.ts`

**الجهد:** 4-6 ساعات

---

## (3) 📱 Mobile API Contract

### التقييم الحالي

#### ✅ ما هو موجود

1. **tRPC API** ✅
   - Type-safe APIs
   - Auto-generated types

#### ❌ ما هو ناقص

1. **Mobile Auth Strategy** ❌
   - حالياً: Cookie-based (لا يعمل جيداً مع الموبايل)
   - مطلوب: Bearer + Refresh Token

2. **Error Contract** ⚠️
   - Errors غير موحدة
   - الموبايل لا يعرف كيف يتعامل معها

3. **API Documentation** ⚠️
   - لا يوجد documentation للموبايل
   - لا Postman collection

### 🔴 التصنيف: **P0 – مانع إطلاق الموبايل**

### ✅ المهام المطلوبة

#### Task 3.1: تطبيق Bearer Token Auth

```typescript
// server/_core/auth.ts

export async function authenticateRequest(req: Request) {
  // Support both Cookie and Bearer
  const token = 
    req.cookies.get('auth_token') || 
    req.headers.get('Authorization')?.replace('Bearer ', '');

  if (!token) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const payload = verifyJWT(token);
  return payload;
}

// New endpoint for mobile login
export async function mobileLogin(email: string, password: string) {
  const user = await authenticateUser(email, password);

  const accessToken = generateJWT(user, '15m');
  const refreshToken = generateJWT(user, '7d');

  // Store refresh token
  await storeRefreshToken(user.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    expiresIn: 900, // 15 minutes
  };
}

// Refresh token endpoint
export async function refreshAccessToken(refreshToken: string) {
  const payload = verifyJWT(refreshToken);
  
  // Verify refresh token is valid
  const isValid = await verifyRefreshToken(payload.userId, refreshToken);
  if (!isValid) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const newAccessToken = generateJWT(payload, '15m');
  
  return {
    accessToken: newAccessToken,
    expiresIn: 900,
  };
}
```

**الملفات المتأثرة:**
- `server/_core/auth.ts`
- `server/routers/auth.ts`
- `drizzle/schema.ts` - إضافة جدول `refresh_tokens`

**الجهد:** 6-8 ساعات

---

#### Task 3.2: توحيد Error Contract

```typescript
// server/_core/errors.ts

export interface APIError {
  code: string; // Machine-readable code
  message: string; // Human-readable message
  correlationId: string; // For tracking
  retryable: boolean; // Can the client retry?
  details?: any; // Additional context
}

// Error codes
export const ErrorCodes = {
  // Booking errors
  BOOKING_CONFLICT: 'BOOKING_CONFLICT',
  SEATS_UNAVAILABLE: 'SEATS_UNAVAILABLE',
  BOOKING_EXPIRED: 'BOOKING_EXPIRED',
  
  // Payment errors
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  
  // Auth errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  
  // Generic errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

// Error transformer
export function transformError(error: any, correlationId: string): APIError {
  if (error instanceof TRPCError) {
    return {
      code: mapTRPCCodeToAPICode(error.code),
      message: error.message,
      correlationId,
      retryable: isRetryable(error.code),
      details: error.cause,
    };
  }

  // Default error
  return {
    code: ErrorCodes.INTERNAL_ERROR,
    message: 'An unexpected error occurred',
    correlationId,
    retryable: false,
  };
}
```

**الملفات الجديدة:**
- `server/_core/errors.ts`

**الملفات المتأثرة:**
- `server/_core/trpc.ts` - إضافة error transformer

**الجهد:** 4-6 ساعات

---

#### Task 3.3: إنشاء Mobile API Documentation

```markdown
# AIS Mobile API Documentation

## Authentication

### Login
POST /api/auth/mobile-login

Request:
{
  "email": "user@example.com",
  "password": "password123"
}

Response:
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 900
}

### Refresh Token
POST /api/auth/refresh

Headers:
Authorization: Bearer <refreshToken>

Response:
{
  "accessToken": "eyJ...",
  "expiresIn": 900
}

## Flights

### Search Flights
POST /api/flights/search

Headers:
Authorization: Bearer <accessToken>

Request:
{
  "from": "RUH",
  "to": "JED",
  "date": "2026-02-01",
  "passengers": 1
}

Response:
{
  "flights": [
    {
      "id": 1,
      "flightNumber": "SV123",
      "from": "RUH",
      "to": "JED",
      "departureTime": "2026-02-01T10:00:00Z",
      "arrivalTime": "2026-02-01T11:30:00Z",
      "price": 500,
      "currency": "SAR",
      "availableSeats": 50
    }
  ]
}

## Error Handling

All errors follow this format:

{
  "code": "SEATS_UNAVAILABLE",
  "message": "No seats available for this flight",
  "correlationId": "abc-123",
  "retryable": false,
  "details": {}
}

Error Codes:
- BOOKING_CONFLICT: Another booking is in progress
- SEATS_UNAVAILABLE: No seats available
- PAYMENT_FAILED: Payment processing failed
- UNAUTHORIZED: Invalid or expired token
- TOKEN_EXPIRED: Access token expired, use refresh token
```

**الملفات الجديدة:**
- `docs/MOBILE_API_DOCUMENTATION.md`
- `postman/AIS_Mobile_API.postman_collection.json`

**الجهد:** 4-6 ساعات

---

## (4) ⚡ Performance & Scalability

### التقييم الحالي

#### ✅ ما هو موجود

1. **Database Indexing** ✅
   - Indexes على الحقول الرئيسية

#### ❌ ما هو ناقص

1. **Redis Caching** ❌
   - لا caching لنتائج البحث
   - لا caching للـ rate limits

2. **Background Queue** ❌
   - Emails ترسل synchronously
   - Webhook retries تحدث في نفس الـ request

3. **Response Compression** ⚠️
   - غير متأكد إذا مفعّل

### 🟠 التصنيف: **P1 – لا يمنع الإطلاق، لكن خطر مع الضغط**

### ✅ المهام المطلوبة

#### Task 4.1: إضافة Redis

```typescript
// server/_core/redis.ts

import { createClient } from 'redis';

export const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

await redis.connect();

// Cache service
export class CacheService {
  async get<T>(key: string): Promise<T | null> {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set(key: string, value: any, ttl: number = 300) {
    await redis.setEx(key, ttl, JSON.stringify(value));
  }

  async del(key: string) {
    await redis.del(key);
  }
}

// Usage: Cache search results
export async function searchFlights(params: SearchParams) {
  const cacheKey = `flights:${JSON.stringify(params)}`;
  
  // Check cache
  const cached = await cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Query DB
  const flights = await db.searchFlights(params);

  // Store in cache (5 minutes)
  await cache.set(cacheKey, flights, 300);

  return flights;
}
```

**الملفات الجديدة:**
- `server/_core/redis.ts`
- `server/services/cache.service.ts`

**الملفات المتأثرة:**
- `server/services/flights.service.ts`
- `docker-compose.production.yml` - إضافة Redis

**الجهد:** 6-8 ساعات

---

#### Task 4.2: إضافة Background Queue (BullMQ)

```typescript
// server/services/queue.service.ts

import { Queue, Worker } from 'bullmq';

// Email queue
export const emailQueue = new Queue('emails', {
  connection: redis,
});

// Worker
const emailWorker = new Worker('emails', async (job) => {
  const { to, subject, body } = job.data;
  await sendEmail(to, subject, body);
}, {
  connection: redis,
});

// Usage
export async function sendBookingConfirmationEmail(booking: Booking) {
  await emailQueue.add('booking-confirmation', {
    to: booking.user.email,
    subject: 'Booking Confirmed',
    body: generateEmailBody(booking),
  });
}
```

**الملفات الجديدة:**
- `server/services/queue.service.ts`
- `server/jobs/email.job.ts`
- `server/jobs/webhook-retry.job.ts`

**الجهد:** 8-10 ساعات

---

## (5) 🛡️ Security & Observability

### التقييم الحالي

#### ✅ ما هو موجود

1. **Helmet** ✅
2. **Rate Limiting** ✅
3. **CSRF Protection** ✅

#### ❌ ما هو ناقص

1. **Correlation ID** ❌
   - لا correlation ID في requests
   - صعوبة في تتبع الأخطاء

2. **Error Tracking** ⚠️
   - لا Sentry أو مشابه

3. **Audit Logs** ❌
   - لا audit trail للأفعال الحساسة

### 🟠 التصنيف: **P1**

### ✅ المهام المطلوبة

#### Task 5.1: إضافة Correlation ID

```typescript
// server/_core/middleware.ts

import { v4 as uuidv4 } from 'uuid';

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const correlationId = req.headers.get('x-correlation-id') || uuidv4();
  
  // Attach to request
  req.correlationId = correlationId;
  
  // Add to response headers
  res.setHeader('x-correlation-id', correlationId);
  
  next();
}

// Logger
export function log(message: string, data?: any) {
  logger.info(message, {
    correlationId: getCurrentCorrelationId(),
    ...data,
  });
}
```

**الملفات الجديدة:**
- `server/_core/correlation.ts`

**الملفات المتأثرة:**
- `server/_core/middleware.ts`
- `server/_core/logger.ts`

**الجهد:** 3-4 ساعات

---

#### Task 5.2: إضافة Sentry

```typescript
// server/_core/sentry.ts

import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});

// Error handler
export function captureError(error: Error, context?: any) {
  Sentry.captureException(error, {
    extra: context,
  });
}
```

**الملفات الجديدة:**
- `server/_core/sentry.ts`

**الجهد:** 2-3 ساعات

---

#### Task 5.3: إضافة Audit Logs

```typescript
// drizzle/schema.ts

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }).notNull(),
  resourceId: varchar('resource_id', { length: 255 }).notNull(),
  changes: json('changes'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  correlationId: varchar('correlation_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('audit_logs_user_id_idx').on(table.userId),
  actionIdx: index('audit_logs_action_idx').on(table.action),
}));

// Usage
export async function logAudit(data: AuditLogData) {
  await db.insert(auditLogs).values({
    userId: data.userId,
    action: data.action, // 'refund', 'cancel', 'admin_override'
    resourceType: data.resourceType, // 'booking', 'payment'
    resourceId: data.resourceId,
    changes: data.changes,
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    correlationId: data.correlationId,
  });
}
```

**الملفات المتأثرة:**
- `drizzle/schema.ts`
- `server/services/audit.service.ts` (جديد)

**الجهد:** 4-6 ساعات

---

## (6) 🏗️ Ops & Go-Live

### التقييم الحالي

#### ✅ ما هو موجود

1. **Docker Setup** ✅
2. **Environment Variables** ✅

#### ❌ ما هو ناقص

1. **Backup/Restore Testing** ❌
   - لم يتم اختبار restore من backup

2. **Load Testing** ❌
   - لم يتم اختبار النظام تحت الضغط

3. **Runbook** ⚠️
   - لا runbook للحوادث

4. **Production Topology** ✅
   - موجود في `docker-compose.production.yml`

### 🟠/🟡 التصنيف: **P1/P2**

### ✅ المهام المطلوبة

#### Task 6.1: اختبار Backup/Restore

```bash
# 1. Create backup
./scripts/backup.sh

# 2. Test restore
./scripts/restore.sh backups/ais_db_20260126.sql.gz

# 3. Verify data integrity
psql $DATABASE_URL -c "SELECT COUNT(*) FROM bookings;"
```

**الملفات المطلوبة:**
- `scripts/backup.sh` ✅ (موجود)
- `scripts/restore.sh` (جديد)
- `scripts/verify-backup.sh` (جديد)

**الجهد:** 2-3 ساعات

---

#### Task 6.2: Load Testing

```javascript
// tests/load/booking-flow.js

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 50 }, // Ramp up to 50 users
    { duration: '5m', target: 50 }, // Stay at 50 users
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.01'], // Error rate must be below 1%
  },
};

export default function () {
  // 1. Search flights
  const searchRes = http.post('https://api.ais.example.com/flights/search', {
    from: 'RUH',
    to: 'JED',
    date: '2026-02-01',
  });

  check(searchRes, {
    'search status is 200': (r) => r.status === 200,
    'search response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);

  // 2. Create booking
  const bookingRes = http.post('https://api.ais.example.com/bookings', {
    idempotencyKey: `test-${Date.now()}`,
    flightId: 1,
    passengers: [{ firstName: 'Test', lastName: 'User' }],
  });

  check(bookingRes, {
    'booking status is 200': (r) => r.status === 200,
  });

  sleep(2);
}
```

**الملفات الجديدة:**
- `tests/load/booking-flow.js`
- `tests/load/search-only.js`

**الجهد:** 4-6 ساعات

---

#### Task 6.3: إنشاء Incident Runbook

```markdown
# Incident Runbook

## Stripe Down

### Symptoms
- Payment creation fails
- Webhooks not received

### Actions
1. Check Stripe status: https://status.stripe.com
2. Enable "maintenance mode" in app
3. Queue payment requests for retry
4. Notify users via email/SMS

## Database Slow

### Symptoms
- Response times > 2s
- High CPU on DB server

### Actions
1. Check slow query log
2. Check connection pool usage
3. Consider adding indexes
4. Scale DB vertically if needed

## High Error Rate

### Symptoms
- Error rate > 5%
- Sentry alerts

### Actions
1. Check Sentry for error details
2. Check correlation IDs in logs
3. Rollback if recent deployment
4. Scale horizontally if load issue
```

**الملفات الجديدة:**
- `docs/INCIDENT_RUNBOOK.md`

**الجهد:** 2-3 ساعات

---

## 📊 ملخص التقييم

### الحالة الحالية

| المحور | الحالة | الدرجة | الأولوية |
|--------|--------|--------|----------|
| Correctness & Data Integrity | ⚠️ جزئي | 70% | 🔴 P0 |
| Payments & Webhooks | ❌ ناقص | 40% | 🔴 P0 |
| Mobile API Contract | ❌ ناقص | 30% | 🔴 P0 |
| Performance & Scalability | ❌ ناقص | 50% | 🟠 P1 |
| Security & Observability | ⚠️ جزئي | 60% | 🟠 P1 |
| Ops & Go-Live | ⚠️ جزئي | 65% | 🟡 P2 |

**Overall Readiness:** **52%** 🟠

---

## 🚨 القرار الصريح

### ❌ لا تطلق قبل تنفيذ (P0):

1. ✅ Idempotency للحجز
2. ✅ Transaction wrapping للعمليات الحرجة
3. ✅ Integration tests
4. ✅ Stripe webhook handler
5. ✅ Event de-duplication
6. ✅ Financial ledger
7. ✅ Mobile auth (Bearer + Refresh)
8. ✅ Error contract موحد

**الجهد الإجمالي:** **60-80 ساعة** (1.5-2 أسبوع بدوام كامل)

### 🟠 نفّذ خلال أول شهر (P1):

1. Redis caching
2. Background queue (BullMQ)
3. Correlation ID
4. Sentry
5. Audit logs
6. Reconciliation job

**الجهد الإجمالي:** **30-40 ساعة** (1 أسبوع)

### 🟡 نفّذ خلال 3-6 أشهر (P2):

1. Backup/restore testing
2. Load testing
3. Incident runbook

**الجهد الإجمالي:** **10-15 ساعة**

---

## 📋 خطة تنفيذ مختصرة (4 أسابيع)

### الأسبوع 1-2: Core Correctness (P0)
- [ ] Idempotency للحجز (6h)
- [ ] Transaction wrapping (12h)
- [ ] Integration tests (16h)
- [ ] Stripe webhook handler (8h)
- [ ] Event de-duplication (3h)
- [ ] Financial ledger (6h)

**المجموع:** 51 ساعة

### الأسبوع 3: Mobile & Observability (P0 + P1)
- [ ] Mobile auth (8h)
- [ ] Error contract (6h)
- [ ] API documentation (6h)
- [ ] Correlation ID (4h)
- [ ] Sentry (3h)

**المجموع:** 27 ساعة

### الأسبوع 4: Performance & Ops (P1)
- [ ] Redis setup (8h)
- [ ] Background queue (10h)
- [ ] Audit logs (6h)
- [ ] Reconciliation job (6h)
- [ ] Backup/restore test (3h)

**المجموع:** 33 ساعة

---

## ✅ Acceptance Criteria

### للإطلاق Beta

- [x] جميع مهام P0 مكتملة
- [x] Integration tests تمر بنجاح
- [x] Stripe webhooks تعمل بشكل صحيح
- [x] Mobile app يمكنه الاتصال بالـ API
- [x] لا double booking يمكن أن يحدث
- [x] لا double charge يمكن أن يحدث

### للإطلاق الكامل

- [x] جميع مهام P0 + P1 مكتملة
- [x] Redis caching يعمل
- [x] Background jobs تعمل
- [x] Observability كاملة
- [x] Load test يمر بنجاح

---

**آخر تحديث:** 26 يناير 2026
