# Sprint Backlog - AIS Aviation System

**الهدف:** تحويل AIS من "مشروع جاهز تقنياً" إلى منتج تجاري جاهز للإطلاق  
**المدة الإجمالية:** 12 أسبوع (6 Sprints × أسبوعين)  
**التاريخ:** 26 يناير 2026

---

## 📋 نظرة عامة

| Sprint   | المدة   | التركيز                            | الحالة  |
| -------- | ------- | ---------------------------------- | ------- |
| Sprint 1 | أسبوعان | Core Correctness & State Machine   | 📝 مخطط |
| Sprint 2 | أسبوعان | Stripe Webhooks & Financial Ledger | 📝 مخطط |
| Sprint 3 | أسبوعان | Mobile Readiness & API Contract    | 📝 مخطط |
| Sprint 4 | أسبوعان | Observability & Ops Baseline       | 📝 مخطط |
| Sprint 5 | أسبوعان | Performance Layer (Redis + Queue)  | 📝 مخطط |
| Sprint 6 | أسبوعان | Hardening & Go-Live                | 📝 مخطط |

---

## 🥇 Sprint 1 — Core Correctness & State Machine

**الهدف:** لا double booking، لا double charge، لا حالات مكسورة

### Epics

1. Booking State Machine Hardening
2. Payment/Booking Idempotency
3. DB Transactions Hardening

### User Stories

#### US-1.1: تعريف حالات الحجز رسمياً

**كمستخدم نظام،** أريد أن تكون حالات الحجز محددة بوضوح حتى لا تحدث حالات غير منطقية.

**المهام:**

- [ ] مراجعة `booking-state-machine.service.ts`
- [ ] تحديث enum الحالات إذا لزم
- [ ] إضافة validations صارمة للانتقالات
- [ ] كتابة unit tests لكل انتقال

**الملفات:**

- `server/services/booking-state-machine.service.ts`
- `server/services/booking-state-machine.service.test.ts`

**Story Points:** 5  
**الأولوية:** P0 (حرجة)

---

#### US-1.2: منع الانتقال لحالة غير منطقية

**كمستخدم نظام،** أريد أن يرفض النظام أي انتقال غير منطقي للحالة.

**المهام:**

- [ ] إضافة `canTransition()` method
- [ ] رفع exception عند محاولة انتقال غير صالح
- [ ] تطبيق في جميع services التي تغير الحالة

**الملفات:**

- `server/services/booking-state-machine.service.ts`
- `server/services/bookings.service.ts`
- `server/services/refunds.service.ts`
- `server/services/booking-modification.service.ts`

**Story Points:** 8  
**الأولوية:** P0 (حرجة)

---

#### US-1.3: إضافة Idempotency Keys للحجوزات

**كمستخدم API،** أريد أن أستطيع إعادة إرسال طلب الحجز بأمان دون خطر التكرار.

**المهام:**

- [ ] إنشاء جدول `idempotency_keys` في schema
- [ ] إنشاء migration
- [ ] إضافة `idempotencyKey` parameter لـ `createBooking`
- [ ] تطبيق logic التحقق والتخزين
- [ ] إضافة TTL (24 ساعة)

**الملفات:**

- `drizzle/schema.ts`
- `drizzle/migrations/XXXX_add_idempotency_keys.sql`
- `server/services/bookings.service.ts`
- `server/routers/bookings.ts`

**Story Points:** 13  
**الأولوية:** P0 (حرجة)

---

#### US-1.4: لفّ العمليات الحرجة بـ Transactions

**كمطور،** أريد أن تكون جميع العمليات الحرجة atomic لضمان consistency.

**المهام:**

- [ ] مراجعة `bookings.service.ts` - تطبيق transactions
- [ ] مراجعة `payments.service.ts` - تطبيق transactions
- [ ] مراجعة `refunds.service.ts` - تطبيق transactions
- [ ] مراجعة `booking-modification.service.ts` - تطبيق transactions

**الملفات:**

- `server/services/bookings.service.ts`
- `server/services/payments.service.ts`
- `server/services/refunds.service.ts`
- `server/services/booking-modification.service.ts`

**Story Points:** 8  
**الأولوية:** P0 (حرجة)

---

#### US-1.5: اختبارات Integration لمسارات Booking/Payment

**كمطور،** أريد اختبارات integration شاملة لضمان عمل المسارات الحرجة.

**المهام:**

- [ ] كتابة test: حجز كامل من البداية للنهاية
- [ ] كتابة test: محاولة double booking
- [ ] كتابة test: فشل الدفع وrollback
- [ ] كتابة test: إلغاء واسترجاع

**الملفات:**

- `server/tests/integration/booking-flow.test.ts` (جديد)
- `server/tests/integration/payment-flow.test.ts` (جديد)

**Story Points:** 13  
**الأولوية:** P1 (عالية)

---

### Definition of Done (Sprint 1)

- [x] جميع الـ User Stories مكتملة
- [x] جميع الاختبارات تمر
- [x] Code review مكتمل
- [x] لا double booking يمكن أن يحدث
- [x] لا double charge يمكن أن يحدث
- [x] جميع الانتقالات الحالة صحيحة

**Total Story Points:** 47

---

## 🥈 Sprint 2 — Stripe Webhooks & Financial Ledger

**الهدف:** Stripe يصبح "مصدر الحقيقة" بدون فوضى

### Epics

1. Webhook Robustness
2. Financial Ledger/Audit Trail
3. Reconciliation Foundation

### User Stories

#### US-2.1: Signature Verification لـ Webhooks

**كمطور،** أريد التأكد من أن جميع webhooks قادمة فعلاً من Stripe.

**المهام:**

- [ ] مراجعة `stripe-webhook.ts`
- [ ] التأكد من signature verification
- [ ] رفض أي webhook بدون signature صحيح
- [ ] إضافة logging للمحاولات المرفوضة

**الملفات:**

- `server/_core/stripe-webhook.ts`

**Story Points:** 3  
**الأولوية:** P0 (حرجة)

---

#### US-2.2: Event De-duplication

**كمطور،** أريد أن يعالج النظام كل webhook event مرة واحدة فقط.

**المهام:**

- [ ] إنشاء جدول `webhook_events` في schema
- [ ] إنشاء migration
- [ ] تخزين event ID قبل المعالجة
- [ ] التحقق من وجود event قبل المعالجة
- [ ] إضافة cleanup job للـ events القديمة

**الملفات:**

- `drizzle/schema.ts`
- `drizzle/migrations/XXXX_add_webhook_events.sql`
- `server/_core/stripe-webhook.ts`

**Story Points:** 8  
**الأولوية:** P0 (حرجة)

---

#### US-2.3: Mapping واضح بين Stripe Events و DB

**كمطور،** أريد mapping واضح بين كل Stripe event وما يجب أن يحدث في DB.

**المهام:**

- [ ] توثيق كل event type
- [ ] إنشاء handler منفصل لكل event
- [ ] `payment_intent.succeeded` → تحديث booking status
- [ ] `payment_intent.payment_failed` → تحديث booking status
- [ ] `charge.refunded` → تحديث refund status

**الملفات:**

- `server/_core/stripe-webhook.ts`
- `server/services/payments.service.ts`
- `docs/STRIPE_WEBHOOK_MAPPING.md` (جديد)

**Story Points:** 13  
**الأولوية:** P0 (حرجة)

---

#### US-2.4: جدول Ledger/Audit

**كمحاسب،** أريد سجل كامل لجميع المعاملات المالية.

**المهام:**

- [ ] إنشاء جدول `financial_ledger` في schema
- [ ] إنشاء migration
- [ ] تسجيل كل معاملة (payment, refund, fee)
- [ ] إضافة balance calculation

**الملفات:**

- `drizzle/schema.ts`
- `drizzle/migrations/XXXX_add_financial_ledger.sql`
- `server/services/ledger.service.ts` (جديد)

**Story Points:** 13  
**الأولوية:** P1 (عالية)

---

#### US-2.5: Reconciliation Job أولي

**كمحاسب،** أريد job يومي يقارن بين Stripe والـ DB.

**المهام:**

- [ ] إنشاء `reconciliation.job.ts`
- [ ] جلب transactions من Stripe
- [ ] مقارنة مع DB
- [ ] إنشاء تقرير بالفروقات
- [ ] إرسال alert عند وجود فروقات

**الملفات:**

- `server/jobs/reconciliation.job.ts` (جديد)
- `server/services/reconciliation.service.ts` (جديد)

**Story Points:** 13  
**الأولوية:** P2 (متوسطة)

---

### Definition of Done (Sprint 2)

- [x] جميع webhooks verified
- [x] لا duplicate processing
- [x] Ledger يسجل كل معاملة
- [x] Reconciliation job يعمل
- [x] Documentation كامل

**Total Story Points:** 50

---

## 🥉 Sprint 3 — Mobile Readiness & API Contract

**الهدف:** الموبايل يستطيع الاعتماد على الـ API بثقة

### Epics

1. Mobile Auth Strategy
2. Error Contract Standardization
3. API Documentation for Mobile

### User Stories

#### US-3.1: اختيار Mobile Auth Strategy

**كمطور موبايل،** أريد طريقة واضحة للمصادقة.

**المهام:**

- [ ] تقييم: Bearer + Refresh vs Cookie
- [ ] اتخاذ قرار
- [ ] توثيق القرار

**الملفات:**

- `docs/MOBILE_AUTH_STRATEGY.md` (جديد)

**Story Points:** 3  
**الأولوية:** P0 (حرجة)

---

#### US-3.2: تطبيق Bearer Token Support

**كمطور موبايل،** أريد استخدام Bearer tokens للمصادقة.

**المهام:**

- [ ] إضافة Bearer token parsing في `auth.ts`
- [ ] إنشاء جدول `refresh_tokens` (إذا لزم)
- [ ] إنشاء `/auth/refresh` endpoint
- [ ] تطبيق token rotation

**الملفات:**

- `server/_core/auth.ts`
- `drizzle/schema.ts`
- `server/routers/auth.ts` (جديد أو تعديل)

**Story Points:** 13  
**الأولوية:** P0 (حرجة)

---

#### US-3.3: توحيد شكل الأخطاء

**كمطور موبايل،** أريد format موحد لجميع الأخطاء.

**المهام:**

- [ ] إنشاء `errors.ts` مع error classes
- [ ] تعريف error codes
- [ ] تعديل tRPC error handler
- [ ] تطبيق في جميع services

**الملفات:**

- `server/_core/errors.ts` (جديد)
- `server/_core/trpc.ts`
- جميع services

**Story Points:** 13  
**الأولوية:** P0 (حرجة)

---

#### US-3.4: توثيق Endpoints للموبايل

**كمطور موبايل،** أريد documentation واضح لجميع endpoints.

**المهام:**

- [ ] توثيق authentication flow
- [ ] توثيق booking flow
- [ ] توثيق error codes
- [ ] إضافة examples

**الملفات:**

- `docs/MOBILE_API_DOCUMENTATION.md` (جديد)

**Story Points:** 8  
**الأولوية:** P1 (عالية)

---

#### US-3.5: اختبار من Postman/Client Mock

**كمطور موبايل،** أريد Postman collection جاهز للاختبار.

**المهام:**

- [ ] إنشاء Postman collection
- [ ] إضافة جميع endpoints الأساسية
- [ ] إضافة environment variables
- [ ] اختبار كل endpoint

**الملفات:**

- `postman/AIS-Mobile-API.postman_collection.json` (جديد)
- `postman/AIS-Mobile-API.postman_environment.json` (جديد)

**Story Points:** 8  
**الأولوية:** P1 (عالية)

---

### Definition of Done (Sprint 3)

- [x] Mobile auth يعمل بشكل كامل
- [x] Error format موحد
- [x] Documentation كامل
- [x] Postman collection جاهز
- [x] تم اختبار كل endpoint

**Total Story Points:** 45

---

## 🧱 Sprint 4 — Observability & Ops Baseline

**الهدف:** أي مشكلة يمكن تتبعها وتشخيصها

### Epics

1. Logging & Monitoring
2. Operational Readiness
3. Health Checks

### User Stories

#### US-4.1: Correlation ID في كل Request

**كمطور،** أريد تتبع كل request عبر النظام.

**المهام:**

- [ ] إضافة correlation ID middleware
- [ ] إضافة correlation ID لكل log
- [ ] إضافة correlation ID لكل error
- [ ] إرجاع correlation ID في response headers

**الملفات:**

- `server/_core/middleware.ts`
- `server/_core/logger.ts` (جديد)

**Story Points:** 8  
**الأولوية:** P0 (حرجة)

---

#### US-4.2: تكامل Sentry

**كمطور،** أريد تتبع جميع الأخطاء تلقائياً.

**المهام:**

- [ ] إضافة `@sentry/node` إلى package.json
- [ ] إعداد Sentry في `index.ts`
- [ ] إضافة user context
- [ ] إضافة custom tags
- [ ] اختبار error tracking

**الملفات:**

- `server/_core/index.ts`
- `server/_core/sentry.ts` (جديد)
- `package.json`

**Story Points:** 5  
**الأولوية:** P1 (عالية)

---

#### US-4.3: Health Endpoints

**كمهندس DevOps،** أريد endpoints لفحص صحة النظام.

**المهام:**

- [ ] `/health` - basic health check
- [ ] `/health/ready` - readiness check
- [ ] `/health/live` - liveness check
- [ ] فحص DB connection
- [ ] فحص Redis connection (Sprint 5)

**الملفات:**

- `server/routers/health.ts` (موجود - تحسين)
- `server/services/health.service.ts` (موجود - تحسين)

**Story Points:** 5  
**الأولوية:** P1 (عالية)

---

#### US-4.4: Backup + Restore Test

**كمهندس DevOps،** أريد التأكد من أن النسخ الاحتياطي يعمل.

**المهام:**

- [ ] إعداد backup script
- [ ] اختبار backup
- [ ] اختبار restore
- [ ] توثيق العملية
- [ ] جدولة backup يومي

**الملفات:**

- `scripts/backup.sh` (جديد)
- `scripts/restore.sh` (جديد)
- `docs/BACKUP_RESTORE.md` (جديد)

**Story Points:** 8  
**الأولوية:** P1 (عالية)

---

#### US-4.5: Runbook أولي

**كمهندس DevOps،** أريد runbook للعمليات الشائعة.

**المهام:**

- [ ] كيفية إعادة تشغيل النظام
- [ ] كيفية فحص الـ logs
- [ ] كيفية التعامل مع الأخطاء الشائعة
- [ ] أرقام الاتصال

**الملفات:**

- `docs/OPERATIONS_RUNBOOK.md` (جديد)

**Story Points:** 5  
**الأولوية:** P2 (متوسطة)

---

### Definition of Done (Sprint 4)

- [x] Correlation ID في كل log
- [x] Sentry يعمل
- [x] Health checks جاهزة
- [x] Backup tested
- [x] Runbook موثق

**Total Story Points:** 31

---

## ⚡ Sprint 5 — Performance Layer

**الهدف:** النظام يتحمل ضغط المستخدمين

### Epics

1. Redis Integration
2. Queue System
3. Performance Optimization

### User Stories

#### US-5.1: Redis Setup

**كمطور،** أريد Redis للـ caching والـ queue.

**المهام:**

- [ ] إضافة Redis إلى `docker-compose.yml`
- [ ] إنشاء `redis.ts` client
- [ ] إضافة `ioredis` إلى package.json
- [ ] اختبار الاتصال

**الملفات:**

- `docker-compose.yml`
- `server/_core/redis.ts` (جديد)
- `package.json`

**Story Points:** 5  
**الأولوية:** P0 (حرجة)

---

#### US-5.2: Redis Caching لنتائج البحث

**كمستخدم،** أريد نتائج بحث سريعة.

**المهام:**

- [ ] إنشاء `cache.service.ts`
- [ ] cache نتائج البحث (5 دقائق TTL)
- [ ] cache بيانات المطارات (1 ساعة TTL)
- [ ] cache بيانات الشركات (1 ساعة TTL)

**الملفات:**

- `server/services/cache.service.ts` (جديد)
- `server/services/flights.service.ts`

**Story Points:** 8  
**الأولوية:** P1 (عالية)

---

#### US-5.3: BullMQ للـ Queue

**كمطور،** أريد queue system للـ background jobs.

**المهام:**

- [ ] إضافة `bullmq` إلى package.json
- [ ] إنشاء `queue.service.ts`
- [ ] إنشاء email queue
- [ ] إنشاء webhook retry queue
- [ ] إنشاء reconciliation queue

**الملفات:**

- `server/services/queue.service.ts` (جديد)
- `package.json`

**Story Points:** 13  
**الأولوية:** P0 (حرجة)

---

#### US-5.4: نقل Email Sending إلى Queue

**كمستخدم،** أريد استجابة سريعة دون انتظار إرسال Email.

**المهام:**

- [ ] إنشاء `email.job.ts`
- [ ] نقل email sending من sync إلى async
- [ ] إضافة retry logic
- [ ] إضافة monitoring

**الملفات:**

- `server/jobs/email.job.ts` (جديد)
- `server/services/email.service.ts`

**Story Points:** 8  
**الأولوية:** P1 (عالية)

---

#### US-5.5: DB Indexes Review

**كمطور،** أريد التأكد من وجود indexes مناسبة.

**المهام:**

- [ ] مراجعة جميع queries
- [ ] إضافة indexes مفقودة
- [ ] اختبار الأداء
- [ ] توثيق الـ indexes

**الملفات:**

- `drizzle/schema.ts`
- `docs/DATABASE_INDEXES.md` (جديد)

**Story Points:** 5  
**الأولوية:** P2 (متوسطة)

---

### Definition of Done (Sprint 5)

- [x] Redis يعمل
- [x] Caching مطبق
- [x] Queue system يعمل
- [x] Background jobs تعمل
- [x] Indexes محسّنة

**Total Story Points:** 39

---

## 🚀 Sprint 6 — Hardening & Go-Live

**الهدف:** جاهزية إطلاق حقيقي

### Epics

1. Load Testing
2. Deployment & Rollout
3. Go-Live Preparation

### User Stories

#### US-6.1: سيناريوهات Load Testing

**كمهندس DevOps،** أريد اختبار النظام تحت الحمل.

**المهام:**

- [ ] إعداد k6 أو Artillery
- [ ] سيناريو: 100 concurrent users
- [ ] سيناريو: booking flow
- [ ] سيناريو: search flow
- [ ] تحليل النتائج

**الملفات:**

- `tests/load/booking-flow.js` (جديد)
- `tests/load/search-flow.js` (جديد)
- `tests/load/README.md` (جديد)

**Story Points:** 13  
**الأولوية:** P1 (عالية)

---

#### US-6.2: Docker Compose Production

**كمهندس DevOps،** أريد setup جاهز للإنتاج.

**المهام:**

- [ ] إنشاء `docker-compose.production.yml`
- [ ] إعداد 3 replicas للـ API
- [ ] إعداد Nginx load balancer
- [ ] إعداد Redis
- [ ] إعداد Postgres

**الملفات:**

- `docker-compose.production.yml` (جديد)
- `nginx.conf` (جديد)
- `deployment/README.md` (جديد)

**Story Points:** 13  
**الأولوية:** P0 (حرجة)

---

#### US-6.3: Soft Launch Checklist

**كمدير منتج،** أريد checklist للإطلاق التجريبي.

**المهام:**

- [ ] قائمة التحقق الفنية
- [ ] قائمة التحقق التشغيلية
- [ ] قائمة التحقق الأمنية
- [ ] قائمة التحقق القانونية

**الملفات:**

- `docs/SOFT_LAUNCH_CHECKLIST.md` (جديد)

**Story Points:** 5  
**الأولوية:** P0 (حرجة)

---

#### US-6.4: Rollback Plan

**كمهندس DevOps،** أريد خطة واضحة للعودة إلى نسخة سابقة.

**المهام:**

- [ ] توثيق خطوات الـ rollback
- [ ] اختبار الـ rollback
- [ ] إعداد scripts
- [ ] توثيق الـ data migration rollback

**الملفات:**

- `docs/ROLLBACK_PLAN.md` (جديد)
- `scripts/rollback.sh` (جديد)

**Story Points:** 8  
**الأولوية:** P0 (حرجة)

---

#### US-6.5: Go-Live Runbook

**كمهندس DevOps،** أريد runbook مفصل للإطلاق.

**المهام:**

- [ ] خطوات ما قبل الإطلاق
- [ ] خطوات الإطلاق
- [ ] خطوات ما بعد الإطلاق
- [ ] Monitoring checklist
- [ ] أرقام الاتصال

**الملفات:**

- `docs/GO_LIVE_RUNBOOK.md` (جديد)

**Story Points:** 8  
**الأولوية:** P0 (حرجة)

---

### Definition of Done (Sprint 6)

- [x] Load testing مكتمل
- [x] Production setup جاهز
- [x] Checklists موثقة
- [x] Rollback plan جاهز
- [x] Go-live runbook جاهز
- [x] **النظام جاهز للإطلاق!**

**Total Story Points:** 47

---

## 📊 ملخص Story Points

| Sprint      | Story Points | المدة        |
| ----------- | ------------ | ------------ |
| Sprint 1    | 47           | أسبوعان      |
| Sprint 2    | 50           | أسبوعان      |
| Sprint 3    | 45           | أسبوعان      |
| Sprint 4    | 31           | أسبوعان      |
| Sprint 5    | 39           | أسبوعان      |
| Sprint 6    | 47           | أسبوعان      |
| **المجموع** | **259**      | **12 أسبوع** |

---

## 🎯 الأولويات

### P0 (حرجة) - يجب إنجازها

- Sprint 1: جميع المهام
- Sprint 2: US-2.1, US-2.2, US-2.3
- Sprint 3: US-3.1, US-3.2, US-3.3
- Sprint 4: US-4.1
- Sprint 5: US-5.1, US-5.3
- Sprint 6: US-6.2, US-6.3, US-6.4, US-6.5

### P1 (عالية) - يُفضل إنجازها

- Sprint 2: US-2.4
- Sprint 3: US-3.4, US-3.5
- Sprint 4: US-4.2, US-4.3, US-4.4
- Sprint 5: US-5.2, US-5.4
- Sprint 6: US-6.1

### P2 (متوسطة) - يمكن تأجيلها

- Sprint 2: US-2.5
- Sprint 4: US-4.5
- Sprint 5: US-5.5

---

## 📝 ملاحظات

- كل Sprint يتضمن code review و testing
- Definition of Done يجب أن يتحقق قبل الانتقال للـ Sprint التالي
- يمكن تعديل الـ backlog بناءً على التقدم الفعلي
- الأولويات قابلة للتغيير بناءً على احتياجات العمل

---

**آخر تحديث:** 26 يناير 2026  
**الحالة:** جاهز للتنفيذ
