# التحسينات الإضافية المطبقة (P1)

**التاريخ:** 26 يناير 2026  
**الإصدار:** 1.1.0  
**الحالة:** تم التطبيق - يحتاج اختبار

---

## 🎯 نظرة عامة

تم تطبيق **5 تحسينات إضافية (P1)** التي تحسن الأداء والموثوقية والقابلية للمراقبة. هذه التحسينات تضمن:

- ✅ Error Contract موحد مع Correlation ID
- ✅ Idempotency محسّن بجدول مخصص
- ✅ Redis Caching للبحث
- ✅ Background Queue (BullMQ)
- ✅ Observability محسّن

---

## 📦 ما تم تطبيقه

### 1. Error Contract موحد ✅

#### التغييرات

**الملفات الجديدة:**

- `server/_core/errors.ts` - Error codes and helpers
- `server/_core/correlation.ts` - Correlation ID management

**Error Codes (P0):**

```typescript
export enum ErrorCode {
  // Validation
  VALIDATION_ERROR = "VALIDATION_ERROR",

  // Auth
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",

  // Resources
  NOT_FOUND = "NOT_FOUND",

  // Rate limiting
  RATE_LIMITED = "RATE_LIMITED",

  // Idempotency
  IDEMPOTENCY_IN_PROGRESS = "IDEMPOTENCY_IN_PROGRESS",
  IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT",

  // Booking
  BOOKING_CONFLICT = "BOOKING_CONFLICT",
  SEATS_UNAVAILABLE = "SEATS_UNAVAILABLE",
  BOOKING_EXPIRED = "BOOKING_EXPIRED",
  INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION",

  // Payment
  PAYMENT_FAILED = "PAYMENT_FAILED",
  PAYMENT_REQUIRED = "PAYMENT_REQUIRED",
  PAYMENT_PROCESSING = "PAYMENT_PROCESSING",

  // Provider
  PROVIDER_ERROR = "PROVIDER_ERROR",
  PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT",

  // Generic
  INTERNAL_ERROR = "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
}
```

#### كيفية الاستخدام

**1. Server-side:**

```typescript
import { Errors, ErrorCode } from "../_core/errors";

// Throw standardized errors
if (!booking) {
  Errors.notFound("Booking");
}

if (booking.status === "confirmed") {
  Errors.bookingConflict("The booking is already confirmed.");
}

if (seatsAvailable < passengers) {
  Errors.seatsUnavailable();
}
```

**2. Client-side (Mobile):**

```typescript
try {
  const booking = await api.bookings.create.mutate({...});
} catch (error: any) {
  // Standardized error response
  const apiError = error.data?.error;

  switch (apiError.code) {
    case "BOOKING_CONFLICT":
      showAlert("Booking already exists");
      break;
    case "SEATS_UNAVAILABLE":
      showAlert("No seats available");
      break;
    case "RATE_LIMITED":
      if (apiError.retryable) {
        // Retry after delay
        setTimeout(() => retry(), 5000);
      }
      break;
    default:
      showAlert(apiError.message);
  }

  // Log correlation ID for support
  console.log("Correlation ID:", apiError.correlationId);
}
```

**3. Error Response Format:**

```json
{
  "error": {
    "code": "BOOKING_CONFLICT",
    "message": "The booking is already confirmed.",
    "correlationId": "01J...",
    "retryable": false,
    "details": {}
  }
}
```

#### الفوائد

- ✅ Machine-readable error codes
- ✅ Consistent error format
- ✅ Correlation ID for tracking
- ✅ Retryable flag for clients
- ✅ Better error handling

---

### 2. Idempotency محسّن ✅

#### التغييرات

**Schema:**

```typescript
export const idempotencyRequests = mysqlTable("idempotency_requests", {
  id: int("id").autoincrement().primaryKey(),
  scope: varchar("scope", { length: 100 }).notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
  userId: int("userId"),
  requestHash: varchar("requestHash", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["STARTED", "COMPLETED", "FAILED"]),
  responseJson: text("responseJson"),
  errorMessage: text("errorMessage"),
  expiresAt: timestamp("expiresAt").notNull(),
  // ...
});
```

**الملفات الجديدة:**

- `server/services/idempotency.service.ts` - Idempotency guard

#### كيفية الاستخدام

**1. Wrap critical operations:**

```typescript
import { withIdempotency, IdempotencyScope } from "../services/idempotency.service";

export async function createBooking(input: CreateBookingInput) {
  return await withIdempotency(
    IdempotencyScope.BOOKING_CREATE,
    input.idempotencyKey,
    input, // Request payload
    async () => {
      // Your booking logic here
      const booking = await db.createBooking({...});
      return booking;
    },
    input.userId,
    86400 // TTL: 24 hours
  );
}
```

**2. Manual idempotency check:**

```typescript
import {
  checkIdempotency,
  createIdempotencyRecord,
  completeIdempotencyRecord,
} from "../services/idempotency.service";

// Check if already processed
const existing = await checkIdempotency(
  IdempotencyScope.BOOKING_CREATE,
  idempotencyKey,
  userId,
  requestPayload
);

if (existing.exists && existing.status === "COMPLETED") {
  return existing.response; // Return cached result
}

// Create record
await createIdempotencyRecord(
  IdempotencyScope.BOOKING_CREATE,
  idempotencyKey,
  requestPayload,
  userId
);

// Execute operation
const result = await doOperation();

// Mark as completed
await completeIdempotencyRecord(
  IdempotencyScope.BOOKING_CREATE,
  idempotencyKey,
  result,
  userId
);
```

**3. Scopes:**

```typescript
export enum IdempotencyScope {
  BOOKING_CREATE = "booking.create",
  BOOKING_CANCEL = "booking.cancel",
  PAYMENT_INTENT = "payment.intent",
  REFUND_REQUEST = "refund.request",
  WEBHOOK_STRIPE = "webhook.stripe",
}
```

#### الفوائد

- ✅ Dedicated idempotency table
- ✅ Request hash validation
- ✅ Response caching
- ✅ TTL-based cleanup
- ✅ Race condition handling
- ✅ Status tracking (STARTED/COMPLETED/FAILED)

---

### 3. Redis Caching ✅

#### التغييرات

**الملفات الجديدة:**

- `server/services/cache.service.ts` - Redis cache service

#### كيفية الاستخدام

**1. Cache flight search:**

```typescript
import { cacheService } from "../services/cache.service";

export async function searchFlights(params: SearchParams) {
  // Check cache first
  const cached = await cacheService.getCachedFlightSearch(params);
  if (cached) {
    logger.info("Cache hit for flight search");
    return cached;
  }

  // Query database/provider
  const flights = await db.searchFlights(params);

  // Store in cache (2 minutes TTL)
  await cacheService.cacheFlightSearch(params, flights, 120);

  return flights;
}
```

**2. Cache flight details:**

```typescript
export async function getFlightDetails(flightId: number) {
  // Check cache
  const cached = await cacheService.getCachedFlightDetails(flightId);
  if (cached) {
    return cached;
  }

  // Query database
  const flight = await db.getFlightById(flightId);

  // Store in cache (5 minutes)
  await cacheService.cacheFlightDetails(flightId, flight, 300);

  return flight;
}
```

**3. Invalidate cache:**

```typescript
// When flight is updated
await cacheService.invalidateFlightDetailsCache(flightId);

// When route availability changes
await cacheService.invalidateFlightSearchCache("RUH", "JED");
```

**4. Rate limiting:**

```typescript
const { allowed, remaining } = await cacheService.checkRateLimit(
  `user:${userId}`,
  100, // 100 requests
  3600 // per hour
);

if (!allowed) {
  Errors.rateLimited();
}
```

#### الفوائد

- ✅ Reduced database load
- ✅ Faster response times
- ✅ Lower provider API costs
- ✅ Built-in rate limiting
- ✅ Automatic reconnection

---

### 4. Background Queue (BullMQ) ✅

#### التغييرات

**الملفات الجديدة:**

- `server/services/queue.service.ts` - Background job processing

#### كيفية الاستخدام

**1. Send emails asynchronously:**

```typescript
import { queueService } from "../services/queue.service";

// Instead of:
// await sendEmail(to, subject, body); // Blocks request

// Do:
await queueService.sendBookingConfirmationEmail({
  to: user.email,
  bookingReference: booking.bookingReference,
  bookingDetails: booking,
});
```

**2. Schedule webhook retry:**

```typescript
// In webhook handler
try {
  await processStripeEvent(event);
} catch (error) {
  // Schedule retry
  await queueService.scheduleWebhookRetry({
    eventId: event.id,
    eventType: event.type,
    payload: event,
  });
}
```

**3. Schedule reconciliation:**

```typescript
// Daily cron job
await queueService.scheduleDailyReconciliation();
```

**4. Schedule cleanup:**

```typescript
// Clean up expired idempotency records
await queueService.scheduleCleanup("idempotency");

// Clean up expired refresh tokens
await queueService.scheduleCleanup("refresh_tokens");
```

#### Queue Names

| Queue            | Purpose                                    |
| ---------------- | ------------------------------------------ |
| `emails`         | Send booking confirmations, receipts, etc. |
| `webhook-retry`  | Retry failed webhook processing            |
| `reconciliation` | Daily payment reconciliation               |
| `cleanup`        | Clean up expired records                   |
| `notifications`  | Push notifications                         |

#### الفوائد

- ✅ Non-blocking email sending
- ✅ Automatic retry with exponential backoff
- ✅ Job persistence
- ✅ Concurrency control
- ✅ Job monitoring

---

### 5. Correlation ID ✅

#### التغييرات

**الملفات الجديدة:**

- `server/_core/correlation.ts` - Correlation ID management

#### كيفية الاستخدام

**1. Automatic injection:**

```typescript
// In TRPC context
export async function createContext(opts: any) {
  const correlationContext = createCorrelationContext(opts);

  return {
    ...correlationContext,
    // other context
  };
}
```

**2. Get correlation ID:**

```typescript
import { getCorrelationId } from "../_core/correlation";

logger.info("Processing booking", {
  correlationId: getCorrelationId(),
  bookingId: booking.id,
});
```

**3. Client-side:**

```typescript
// Send correlation ID in request
const response = await fetch(url, {
  headers: {
    "x-correlation-id": generateUUID(),
  },
});

// Get correlation ID from response
const correlationId = response.headers.get("x-correlation-id");
```

**4. Error tracking:**

```typescript
try {
  // ...
} catch (error) {
  const apiError = transformError(error, getCorrelationId());

  // Send to Sentry with correlation ID
  Sentry.captureException(error, {
    tags: {
      correlationId: apiError.correlationId,
    },
  });

  throw apiError;
}
```

#### الفوائد

- ✅ End-to-end request tracking
- ✅ Easier debugging
- ✅ Better error tracking
- ✅ Cross-service tracing

---

## 📊 ملخص التحسينات

| التحسين           | الحالة | الملفات الجديدة           | الملفات المعدلة      |
| ----------------- | ------ | ------------------------- | -------------------- |
| Error Contract    | ✅     | errors.ts, correlation.ts | -                    |
| Idempotency محسّن | ✅     | idempotency.service.ts    | schema.ts, migration |
| Redis Caching     | ✅     | cache.service.ts          | -                    |
| Background Queue  | ✅     | queue.service.ts          | -                    |
| Correlation ID    | ✅     | correlation.ts            | -                    |

**المجموع:**

- **6 ملفات جديدة**
- **2 ملفات معدلة**
- **1 migration**

---

## ✅ الخطوات التالية

### 1. تشغيل Migration

```bash
npm run db:migrate
```

### 2. إعداد Redis

```bash
# في docker-compose.production.yml
redis:
  image: redis:7-alpine
  ports:
    - "6379:6379"
  volumes:
    - redis_data:/data
  command: redis-server --appendonly yes
```

```bash
# في .env
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. اختبار Redis

```bash
# Test connection
redis-cli ping
# Should return: PONG

# Test cache
node -e "
const { cacheService } = require('./server/services/cache.service');
cacheService.connect().then(() => {
  cacheService.set('test', 'value', 60).then(() => {
    cacheService.get('test').then(console.log);
  });
});
"
```

### 4. اختبار Queue

```bash
# Monitor queues
npm install -g bull-board

# Or use Redis Commander
docker run -d -p 8081:8081 rediscommander/redis-commander
```

### 5. تحديث Services

**في bookings.service.ts:**

```typescript
import { withIdempotency, IdempotencyScope } from "./idempotency.service";
import { cacheService } from "./cache.service";
import { queueService } from "./queue.service";
import { Errors } from "../_core/errors";

export async function createBooking(input: CreateBookingInput) {
  return await withIdempotency(
    IdempotencyScope.BOOKING_CREATE,
    input.idempotencyKey,
    input,
    async () => {
      // Check seats availability
      const flight = await getFlightDetails(input.flightId);
      if (flight.availableSeats < input.passengers.length) {
        Errors.seatsUnavailable();
      }

      // Create booking
      const booking = await db.createBooking({...});

      // Send confirmation email (async)
      await queueService.sendBookingConfirmationEmail({
        to: input.userEmail,
        bookingReference: booking.bookingReference,
        bookingDetails: booking,
      });

      // Invalidate cache
      await cacheService.invalidateFlightDetailsCache(input.flightId);

      return booking;
    },
    input.userId
  );
}
```

**في flights.service.ts:**

```typescript
export async function searchFlights(params: SearchParams) {
  // Check cache
  const cached = await cacheService.getCachedFlightSearch(params);
  if (cached) {
    return cached;
  }

  // Query database
  const flights = await db.searchFlights(params);

  // Cache results (2 minutes)
  await cacheService.cacheFlightSearch(params, flights, 120);

  return flights;
}
```

---

## 📊 التأثير المتوقع

### الأداء

| المقياس                  | قبل   | بعد   | التحسن  |
| ------------------------ | ----- | ----- | ------- |
| Search response time     | 500ms | 50ms  | **90%** |
| Booking creation time    | 2s    | 500ms | **75%** |
| Email sending (blocking) | 1s    | 10ms  | **99%** |
| Database load            | 100%  | 30%   | **70%** |

### الموثوقية

- ✅ **No duplicate bookings** - Idempotency guard
- ✅ **No lost emails** - Queue persistence
- ✅ **Better error tracking** - Correlation ID
- ✅ **Automatic retry** - Queue retry mechanism

### القابلية للتوسع

- ✅ **Horizontal scaling** - Redis + Queue
- ✅ **Reduced DB load** - Caching
- ✅ **Async processing** - Background jobs
- ✅ **Rate limiting** - Redis-based

---

## 🎯 معايير القبول

### للإطلاق Beta

- [x] Error Contract مطبق
- [x] Idempotency Service مطبق
- [x] Redis Cache Service مطبق
- [x] Background Queue مطبق
- [x] Correlation ID مطبق
- [ ] Migration تم تشغيله
- [ ] Redis تم إعداده
- [ ] Queue تم اختباره
- [ ] Services تم تحديثها

### للإطلاق الكامل

- [ ] جميع معايير Beta ✅
- [ ] Load testing مع Redis
- [ ] Queue monitoring
- [ ] Error tracking (Sentry)
- [ ] Performance metrics

---

## 📝 ملاحظات مهمة

### Redis

1. **Persistence:**
   - استخدم AOF (Append Only File) للـ persistence
   - Backup Redis data دورياً

2. **Memory:**
   - راقب استخدام الذاكرة
   - استخدم eviction policy (allkeys-lru)

3. **Monitoring:**
   - راقب hit rate
   - راقب memory usage
   - راقب connection count

### Queue

1. **Retry Strategy:**
   - Exponential backoff
   - Max 3 attempts
   - Dead letter queue للفشل النهائي

2. **Monitoring:**
   - راقب queue length
   - راقب processing time
   - راقب failed jobs

3. **Cleanup:**
   - نظف completed jobs بعد 24 ساعة
   - احتفظ بـ failed jobs لمدة 7 أيام

---

## 🚀 الخلاصة

تم تطبيق **جميع التحسينات الإضافية (P1)** بنجاح. النظام الآن:

✅ **لديه Error Contract موحد**  
✅ **Idempotency محسّن بجدول مخصص**  
✅ **Redis Caching للأداء**  
✅ **Background Queue للموثوقية**  
✅ **Correlation ID للتتبع**

**الخطوة التالية:** إعداد Redis وQueue واختبار شامل.

---

**آخر تحديث:** 26 يناير 2026
