# تحليل الفجوات المرتبط بالكود - AIS Aviation System

**التاريخ:** 26 يناير 2026  
**الهدف:** ربط الفجوات المحددة بالكود الفعلي وتحديد ملفات التعديل المطلوبة

---

## ✅ الموجود فعلياً (Verified)

### 1. API منظم + Type-safe (tRPC)

**الملفات:**
- `server/routers/*.ts` - 15 موجه منظم
- `server/services/*.service.ts` - 24 خدمة
- `server/_core/trpc.ts` - إعداد tRPC

**التقييم:** ✅ ممتاز - Type safety كامل

---

### 2. Stripe مدمج

**الملفات:**
- `server/services/payments.service.ts`
- `server/routers/payments.ts`
- `server/_core/stripe-webhook.ts`

**التقييم:** ✅ موجود - لكن يحتاج تحسينات (انظر الفجوات)

---

### 3. Auth + Security Middleware

**الملفات:**
- `server/services/security.service.ts`
- `server/_core/auth.ts`
- `server/_core/rateLimiter.ts`

**التقييم:** ✅ موجود - لكن يحتاج تعديلات للموبايل

---

### 4. Schema منظم (Drizzle)

**الملفات:**
- `drizzle/schema.ts` - 20 جدول
- `drizzle/migrations/` - 13 migration

**التقييم:** ✅ ممتاز

---

### 5. Documentation قوية

**الملفات:**
- `docs/*.md` - 29 ملف توثيق

**التقييم:** ✅ ممتاز

---

## ⚠️ موجود جزئياً - يحتاج تثبيت قبل الإطلاق

### 1. ❗ Idempotency للحجز والدفع

**الحالة الحالية:**
- `server/services/payments.service.ts` - يستخدم `idempotencyKey` لـ Stripe
- `server/services/bookings.service.ts` - لا يوجد idempotency واضح

**المطلوب:**
```typescript
// في bookings.service.ts
interface CreateBookingInput {
  idempotencyKey: string; // إضافة
  // ... باقي الحقول
}

// جدول جديد في schema.ts
export const idempotencyKeys = pgTable('idempotency_keys', {
  key: varchar('key', { length: 255 }).primaryKey(),
  response: json('response'),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at'), // 24 ساعة
});
```

**الملفات المطلوب تعديلها:**
1. `drizzle/schema.ts` - إضافة جدول `idempotency_keys`
2. `server/services/bookings.service.ts` - إضافة logic
3. `server/routers/bookings.ts` - تمرير idempotency key
4. `client/src/hooks/useBooking.ts` - توليد key

**الأولوية:** 🔴 حرجة (Sprint 1)

---

### 2. ❗ Webhook Handling Robust

**الحالة الحالية:**
- `server/_core/stripe-webhook.ts` - موجود
- لا يوجد event deduplication واضح
- لا يوجد retry mechanism

**المطلوب:**
```typescript
// جدول جديد في schema.ts
export const webhookEvents = pgTable('webhook_events', {
  id: varchar('id', { length: 255 }).primaryKey(), // Stripe event ID
  type: varchar('type', { length: 100 }),
  processed: boolean('processed').default(false),
  processedAt: timestamp('processed_at'),
  payload: json('payload'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

**الملفات المطلوب تعديلها:**
1. `drizzle/schema.ts` - إضافة جدول `webhook_events`
2. `server/_core/stripe-webhook.ts` - إضافة deduplication
3. `server/services/payments.service.ts` - تحسين معالجة الأحداث

**الأولوية:** 🔴 حرجة (Sprint 2)

---

### 3. ❗ State Machine صريح للحجز

**الحالة الحالية:**
- `server/services/booking-state-machine.service.ts` - **موجود!**
- لكن قد لا يكون مطبق بشكل صارم في كل مكان

**المطلوب:**
- مراجعة وتثبيت استخدامه في جميع العمليات
- إضافة validations صارمة
- منع الانتقالات غير المنطقية

**الملفات المطلوب مراجعتها:**
1. `server/services/booking-state-machine.service.ts` - مراجعة
2. `server/services/bookings.service.ts` - التأكد من استخدامه
3. `server/services/refunds.service.ts` - التأكد من استخدامه
4. `server/services/booking-modification.service.ts` - التأكد من استخدامه

**الأولوية:** 🔴 حرجة (Sprint 1)

---

### 4. ❗ Error Contract موحّد للموبايل

**الحالة الحالية:**
- tRPC يوفر error handling أساسي
- لكن لا يوجد contract موحد للأخطاء

**المطلوب:**
```typescript
// server/_core/errors.ts (جديد)
export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
  }
}

export const ErrorCodes = {
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  SEAT_UNAVAILABLE: 'SEAT_UNAVAILABLE',
  // ... إلخ
} as const;

// Response format
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}
```

**الملفات المطلوب إنشاؤها/تعديلها:**
1. `server/_core/errors.ts` - **إنشاء جديد**
2. `server/_core/trpc.ts` - تعديل error handling
3. جميع الـ services - استخدام الأخطاء الموحدة

**الأولوية:** 🟡 عالية (Sprint 3)

---

### 5. ❗ Auth مناسب للموبايل

**الحالة الحالية:**
- يستخدم Manus OAuth
- Cookies قد لا تكون مثالية للموبايل

**المطلوب:**
- خيار Bearer Token + Refresh Token
- أو ضبط Cookies بشكل دقيق للموبايل

**الملفات المطلوب تعديلها:**
1. `server/_core/auth.ts` - إضافة Bearer token support
2. `server/services/security.service.ts` - Refresh token logic
3. `drizzle/schema.ts` - جدول `refresh_tokens` (إذا لزم)

**الأولوية:** 🟡 عالية (Sprint 3)

---

### 6. ⚠️ Observability عملي

**الحالة الحالية:**
- Logging أساسي موجود
- لا يوجد correlation ID
- لا يوجد Sentry أو مشابه

**المطلوب:**
```typescript
// server/_core/middleware.ts
export const correlationIdMiddleware = (req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || uuidv4();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
};

// في كل log
logger.info('Booking created', {
  correlationId: req.correlationId,
  bookingId,
  userId,
});
```

**الملفات المطلوب إنشاؤها/تعديلها:**
1. `server/_core/middleware.ts` - إضافة correlation ID
2. `server/_core/logger.ts` - **إنشاء جديد** أو تحسين
3. `server/_core/index.ts` - تفعيل Sentry
4. `package.json` - إضافة `@sentry/node`

**الأولوية:** 🟡 عالية (Sprint 4)

---

### 7. ⚠️ Redis (غير موجود)

**الحالة الحالية:**
- لا يوجد Redis في المشروع حالياً

**المطلوب:**
- Redis للـ caching
- Redis للـ rate limiting
- Redis للـ queue (BullMQ)

**الملفات المطلوب إنشاؤها:**
1. `server/_core/redis.ts` - **إنشاء جديد**
2. `server/services/cache.service.ts` - **إنشاء جديد**
3. `server/services/queue.service.ts` - **إنشاء جديد**
4. `docker-compose.yml` - إضافة Redis
5. `package.json` - إضافة `ioredis`, `bullmq`

**الأولوية:** 🟠 متوسطة (Sprint 5)

---

### 8. ⚠️ Background Jobs

**الحالة الحالية:**
- Email يُرسل synchronously
- لا يوجد queue system

**المطلوب:**
- نقل Email sending إلى queue
- نقل Webhook retries إلى queue
- Reconciliation jobs

**الملفات المطلوب إنشاؤها/تعديلها:**
1. `server/jobs/email.job.ts` - **إنشاء جديد**
2. `server/jobs/webhook-retry.job.ts` - **إنشاء جديد**
3. `server/jobs/reconciliation.job.ts` - **إنشاء جديد**
4. `server/services/queue.service.ts` - **إنشاء جديد**

**الأولوية:** 🟠 متوسطة (Sprint 5)

---

## ❌ غير موجود - طبقة إنتاج

### 1. Load Testing

**المطلوب:**
- سيناريوهات load testing
- أدوات: k6, Artillery, أو JMeter

**الملفات المطلوب إنشاؤها:**
1. `tests/load/booking-flow.js` - **إنشاء جديد**
2. `tests/load/search-flow.js` - **إنشاء جديد**
3. `tests/load/README.md` - دليل التشغيل

**الأولوية:** 🟢 منخفضة (Sprint 6)

---

### 2. Deployment Topology واضح

**المطلوب:**
- `docker-compose.production.yml`
- Nginx config
- Replicas setup

**الملفات المطلوب إنشاؤها:**
1. `docker-compose.production.yml` - **إنشاء جديد**
2. `nginx.conf` - **إنشاء جديد**
3. `deployment/README.md` - دليل النشر

**الأولوية:** 🔴 حرجة (Sprint 6)

---

### 3. Go-Live Runbook حقيقي

**المطلوب:**
- خطوات الإطلاق التفصيلية
- Rollback plan
- Monitoring checklist

**الملفات المطلوب إنشاؤها:**
1. `docs/GO_LIVE_RUNBOOK.md` - **إنشاء جديد**
2. `docs/ROLLBACK_PLAN.md` - **إنشاء جديد**
3. `docs/MONITORING_CHECKLIST.md` - **إنشاء جديد**

**الأولوية:** 🔴 حرجة (Sprint 6)

---

## 📊 ملخص الفجوات حسب الملفات

### ملفات موجودة تحتاج تعديل

| الملف | التعديل المطلوب | Sprint |
|------|-----------------|--------|
| `drizzle/schema.ts` | إضافة جداول: idempotency_keys, webhook_events, refresh_tokens | 1, 2, 3 |
| `server/services/bookings.service.ts` | إضافة idempotency + تثبيت state machine | 1 |
| `server/services/payments.service.ts` | تحسين webhook handling | 2 |
| `server/_core/stripe-webhook.ts` | إضافة deduplication | 2 |
| `server/_core/auth.ts` | إضافة Bearer token support | 3 |
| `server/_core/trpc.ts` | توحيد error handling | 3 |

### ملفات جديدة مطلوبة

| الملف | الوصف | Sprint |
|------|-------|--------|
| `server/_core/errors.ts` | Error contract موحد | 3 |
| `server/_core/logger.ts` | Logger محسّن مع correlation ID | 4 |
| `server/_core/redis.ts` | Redis client | 5 |
| `server/services/cache.service.ts` | Caching service | 5 |
| `server/services/queue.service.ts` | Queue service | 5 |
| `server/jobs/*.job.ts` | Background jobs | 5 |
| `docker-compose.production.yml` | Production setup | 6 |
| `nginx.conf` | Nginx config | 6 |
| `tests/load/*.js` | Load tests | 6 |
| `docs/GO_LIVE_RUNBOOK.md` | Go-live guide | 6 |

---

## 🎯 الخطوات التالية

1. **Sprint 1** - البدء بـ Core Correctness (الملفات الموجودة)
2. **Sprint 2-3** - إضافة الملفات الجديدة الحرجة
3. **Sprint 4-5** - طبقة الأداء والمراقبة
4. **Sprint 6** - الإطلاق والنشر

---

**ملاحظة:** هذا التحليل مبني على الكود الفعلي الموجود في المستودع.
