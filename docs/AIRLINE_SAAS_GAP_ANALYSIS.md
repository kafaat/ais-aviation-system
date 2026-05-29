# تحليل الفجوات والمقترح المعماري — تحويل AIS إلى منصة Airline SaaS

> **الجمهور:** فريق الهندسة والقيادة التقنية.
> **الهدف:** تقييم الحالة الحالية مقابل متطلبات منصة طيران مؤسسية متعددة المستأجرين
> (Multi-Tenant Mission-Critical Airline SaaS)، وتحديد الفجوات، ووضع خارطة طريق
> عملية متدرّجة.
> **مبدأ التوجيه:** _تعقيد مجال الطيران أعلى من تعقيد التقنية_ — نبدأ بـ
> **Modular Monolith + Async Event Layer**، ثم نستخرج الخدمات عالية الضغط فقط.
> لا نبدأ بـ 50 microservice.

---

## 1. الملخص التنفيذي

النظام الحالي **منصة حجز وعمليات طيران ناضجة وظيفياً** (94 راوتر، 102 خدمة، 100
جدول، تكامل GDS/NDC/BSP، DCS/IROPS/Crew، تسعير ذكي). لكنه مبني كـ **Modular
Monolith أحادي المستأجر** (single-tenant). للتحوّل إلى **SaaS تبيعه لعدة شركات
طيران**، الفجوة الأكبر ليست الميزات — بل ثلاث ركائز معمارية مفقودة:

| الركيزة                                     | الحالة                    | الأثر                         |
| ------------------------------------------- | ------------------------- | ----------------------------- |
| **عزل المستأجر (Tenancy)**                  | غير موجود (لا `tenantId`) | 🔴 مانع للإطلاق كـ SaaS       |
| **طبقة أحداث غير متزامنة (Event Backbone)** | جزئي (BullMQ فقط)         | 🟠 يحدّ من الموثوقية والتكامل |
| **تنسيق العمليات الطويلة (Workflow/Saga)**  | بدائي (FSM يدوي)          | 🟠 خطر تضارب المعاملات        |

الخبر الجيد: البنية الحالية **نظيفة وطبقية** (router → service → db)، وتمتلك
بالفعل لبنات أساسية (idempotency، audit، history tables، RBAC، عزل على مستوى
المستخدم تم تعزيزه مؤخراً، k8s، S3-compatible storage). هذا يجعل التحوّل تطوّرياً
لا ثورياً.

---

## 2. لقطة الحالة الحالية (مبنية على الكود)

| الطبقة         | المستخدم حالياً                                     | ملاحظة                               |
| -------------- | --------------------------------------------------- | ------------------------------------ |
| API/Edge       | Express 4 + tRPC 11، Nginx كـ LB (3 نسخ)            | لا API Gateway مركزي (APISIX/Kong)   |
| المصادقة       | JWT مخصّص + FastAPI (bcrypt)                        | لا Identity Federation/OIDC          |
| البيانات       | MySQL/TiDB + Drizzle، Redis                         | DB واحدة مشتركة، **بلا عمود مستأجر** |
| المهام الخلفية | BullMQ + Redis                                      | طابور مهام، **ليس Event Bus**        |
| تنسيق العمليات | `booking-state-machine.service.ts`                  | FSM داخلي، لا Temporal، لا Saga صريح |
| المراقبة       | Sentry + Prometheus + APM مخصّص                     | **لا Distributed Tracing (OTel)**    |
| التخزين        | `@aws-sdk/client-s3`                                | متوافق مع MinIO مباشرةً ✅           |
| الزمن الحقيقي  | `ws` + `websocket.service.ts`                       | موجود ✅                             |
| النشر          | Docker (3 compose) + k8s (Kustomize)                | أساس جيد ✅                          |
| الموثوقية      | idempotency، history tables، audit، financialLedger | Outbox-lite ضمنياً ✅                |

**الخلاصة:** ميزات على مستوى المؤسسة فوق أساس بنيوي أحادي المستأجر.

---

## 3. مصفوفة الفجوات (Capability Gap Matrix)

| القدرة                              | الحالة الحالية        | الهدف (Airline SaaS)                        | الأولوية |
| ----------------------------------- | --------------------- | ------------------------------------------- | -------- |
| **Multi-Tenancy**                   | لا عزل مستأجر         | عزل بيانات + تكوين لكل شركة طيران           | **P0**   |
| **Tenant-aware AuthN/Z**            | RBAC على مستوى مستخدم | RBAC + ABAC مدرك للمستأجر                   | **P0**   |
| **Event Backbone**                  | BullMQ                | Kafka/NATS + Outbox Pattern                 | **P0**   |
| **Workflow Orchestration**          | FSM يدوي              | Temporal (Booking, Refund, IROPS, Check-in) | **P1**   |
| **Distributed Tracing**             | لا يوجد               | OpenTelemetry → SkyWalking/Tempo            | **P1**   |
| **API Gateway**                     | Nginx LB              | APISIX/Kong (multi-tenant routing, quotas)  | **P1**   |
| **Identity Federation**             | JWT مخصّص             | Keycloak (OIDC/SAML، per-tenant realm)      | **P2**   |
| **Saga / Distributed Tx**           | معاملات DB محلية      | Saga (Outbox + Compensations)               | **P1**   |
| **Per-tenant Observability**        | metrics عامة          | SLO/مقاييس مقسّمة بالمستأجر                 | **P2**   |
| **Multi-Region / DR**               | تكوين موجود جزئياً    | Active-Active أو Active-Passive موثّق       | **P2**   |
| **Tenant Onboarding**               | يدوي                  | Self-service provisioning + billing         | **P2**   |
| **Config/Feature Flags لكل مستأجر** | ثابت                  | تكوين ديناميكي لكل شركة                     | **P2**   |

---

## 4. القرار الاستراتيجي الأهم: نموذج تعدد المستأجرين

هذا القرار يسبق كل شيء آخر. الخيارات الثلاثة:

| النموذج                                   | العزل   | التكلفة/التعقيد | متى نختاره               |
| ----------------------------------------- | ------- | --------------- | ------------------------ |
| **A. Shared DB + `tenantId`** (Row-Level) | منطقي   | منخفض           | **موصى به للبداية**      |
| **B. Schema-per-tenant**                  | متوسط   | متوسط           | عند متطلبات تنظيمية أقوى |
| **C. DB-per-tenant**                      | فيزيائي | عالٍ            | لشركات كبرى/سيادة بيانات |

### المقترح: النموذج (A) أولاً، مع تصميم يسمح بالترقية إلى (C) للمستأجرين الكبار (Hybrid).

**خطوات التنفيذ في الكود الحالي (تطوّري وآمن):**

1. **إضافة جدول `tenants`** (شركة الطيران المستأجِرة) + ربط `users` بالمستأجر.
2. **إضافة `tenantId` (notNull) لكل جدول معاملاتي** (bookings, flights, payments,
   passengers, baggage, ...) مع فهرس مركّب `(tenantId, ...)`.
3. **فرض العزل في طبقة واحدة وليس في كل استعلام** — عبر:
   - تمرير `tenantId` ضمن `TrpcContext` (من الـ JWT/subdomain/header).
   - **مُغلِّف Drizzle مدرك للمستأجر** (tenant-scoped query helper) أو
     Middleware يحقن `eq(table.tenantId, ctx.tenantId)` تلقائياً.
   - توسعة `server/services/access-control.service.ts` (الموجود) بدالة
     `assertTenant(resourceTenantId, ctx.tenantId)`.
4. **Defense-in-depth:** عند الجاهزية، تفعيل **Row-Level Security** على مستوى
   قاعدة البيانات (إن انتقلتم إلى PostgreSQL) كشبكة أمان أخيرة.

> ⚠️ **تحذير:** فرض `tenantId` في كل راوتر يدوياً = خطأ بشري حتمي. اجعله
> **افتراضياً على مستوى البنية** (context + query wrapper)، والاستثناء (cross-tenant
> admin) هو ما يُصرّح به صراحةً.

هذا يمتد طبيعياً من عمل عزل المستخدم (per-user IDOR) الذي تم إنجازه مؤخراً.

---

## 5. خارطة الطريق المتدرّجة (Phased Roadmap)

### المرحلة 0 — الأساس متعدد المستأجرين (P0، 4–6 أسابيع)

- جدول `tenants` + `tenantId` عبر المخطط + هجرات Drizzle.
- حقن `tenantId` في `context.ts` (من subdomain/claim).
- Tenant-scoped query wrapper + توسعة `access-control.service`.
- اختبارات عزل آلية (مثل اختبارات IDOR الحالية) لكل جدول معاملاتي.
- **النتيجة:** أول شركتي طيران تعملان بمعزل تام على نفس النشر.

### المرحلة 1 — العمود الفقري للأحداث + التنسيق (P0/P1، 6–10 أسابيع)

- **Outbox Pattern:** جدول `outbox` يُكتب في نفس معاملة العمل، وناشر يدفع إلى
  **Kafka/NATS** (يحلّ مشكلة الاتساق dual-write). يبني على `history`/`ledger`
  الموجودة.
- **Temporal** لتنسيق العمليات الطويلة الحرجة:
  - `BookingWorkflow` (hold → pay → ticket → confirm، مع timeouts/compensation).
  - `RefundWorkflow`, `IROPSWorkflow` (rebooking + hotel + compensation EU261),
    `CheckInWorkflow`.
  - يستبدل الـ FSM اليدوي ويعطي retries/state-recovery مجاناً.
- **Saga** للمعاملات الموزّعة (الدفع ↔ المخزون ↔ الإصدار) عبر Temporal + تعويضات.

### المرحلة 2 — الملاحظة والبوابة والهوية (P1، 6–8 أسابيع)

- **OpenTelemetry** (traces + metrics + logs) → SkyWalking/Tempo/Jaeger. ربط
  `requestId` الموجود بـ `traceId`.
- **API Gateway (APISIX)** أمام الـ Edge: توجيه per-tenant، quotas/rate-limit
  لكل مستأجر، canary، تكامل الشركاء (GDS/airports/payment).
- **Keycloak** للهوية الموحّدة: realm لكل مستأجر، OIDC/SAML، SSO لموظفي شركات
  الطيران. يبقى FastAPI لمسار العملاء النهائيين إن لزم.

### المرحلة 3 — الاستخراج الانتقائي + التشغيل (P2، مستمر)

- استخراج **الخدمات عالية الضغط فقط** كـ microservices حول حدود المجال:
  `Flight Ops`, `Pricing/Revenue`, `Notification`, `Booking`. الباقي يبقى ضمن
  المونوليث المعياري.
- Multi-Region موثّق (Active-Passive كبداية) + DR runbooks (موجود `disaster-recovery`).
- Self-service tenant onboarding + per-tenant billing + feature flags.
- مقاييس SLO مقسّمة بالمستأجر.

---

## 6. مخطّط البنية المستهدفة (Target Architecture)

```
                 ┌──────────────────────────────────────────┐
   Partners ───► │  API Gateway (APISIX)                     │
   Customers ──► │  per-tenant routing · quotas · canary     │
   Airline Staff │  ▲ Identity (Keycloak: realm/tenant)      │
                 └───────────────┬──────────────────────────┘
                                 │  tenantId in context
        ┌────────────────────────┴───────────────────────────┐
        │           Modular Monolith (Express + tRPC)         │
        │   Booking · Flights · Payments · Loyalty · DCS ...  │
        │   ── tenant-scoped query layer ── access-control ── │
        └───┬───────────────┬───────────────┬────────────────┘
            │ Outbox (same tx)│               │ durable workflows
            ▼                 ▼               ▼
     ┌────────────┐   ┌──────────────┐  ┌──────────────┐
     │ Kafka/NATS │   │ MySQL/TiDB   │  │  Temporal    │
     │ event bus  │   │ +tenantId    │  │  Booking/IROPS│
     └─────┬──────┘   │ Redis · S3   │  │  Refund/Saga │
           │          └──────────────┘  └──────────────┘
   ┌───────┴─── selectively extracted, high-load only ───────┐
   │  Flight Ops Svc · Pricing/Revenue Svc · Notification Svc │
   └─────────────────────────────────────────────────────────┘
                 OpenTelemetry → SkyWalking/Grafana/Tempo
```

---

## 7. مكاسب قريبة المدى داخل الكود الحالي (Quick Wins)

أشياء قابلة للتنفيذ الآن دون انتظار التحوّل الكامل:

1. **Outbox-lite الآن:** أضف جدول `outbox` واكتب الأحداث ضمن معاملات العمل
   الحرجة (booking confirmed, payment paid, refund issued). حتى قبل Kafka، هذا
   يجعل التحوّل لاحقاً مجرّد "تبديل ناشر".
2. **OpenTelemetry SDK** خلف الـ APM الحالي (instrumentation تلقائي لـ Express +
   MySQL) — ربح كبير بجهد منخفض، ويستفيد من `requestId` الموجود.
3. **تجهيز `tenantId` في `context.ts`** كحقل اختياري الآن (من header)، ثم جعله
   إلزامياً تدريجياً — يقلّل حجم الهجرة الكبرى لاحقاً.
4. **توحيد محرك الحالة:** تجميع منطق دورة حياة الحجز (13 حالة) في خدمة واحدة
   تمهيداً لاستبدالها بـ Temporal Workflow بحدود واضحة.
5. **عقود الأحداث (Event Contracts):** توثيق أحداث المجال (BookingConfirmed،
   PaymentCaptured، FlightDisrupted...) كـ schemas (Zod/Avro) — أساس أي event bus.

---

## 8. مخاطر ومضادّات الأنماط (Anti-Patterns)

- ❌ **البدء بـ 50 microservice:** التعقيد التشغيلي يسحق الفريق. ابدأ معيارياً.
- ❌ **فرض `tenantId` يدوياً في كل استعلام:** اجعله افتراضياً على مستوى البنية.
- ❌ **Dual-write بلا Outbox:** يسبّب فقدان أحداث وتضارب — استخدم Outbox من اليوم.
- ❌ **استبدال المونوليث دفعة واحدة:** استخرج حول الضغط الفعلي والقياسات، لا التوقّع.
- ❌ **خلط هوية الموظفين بهوية العملاء:** افصل realms/مسارات المصادقة.
- ⚠️ **اعتبار الطيران تطبيق CRUD:** هو نظام أحداث + آلات حالة موزّعة + زمن حقيقي.

---

## 9. مواءمة المكدّس المفتوح المصدر المقترح مع AIS

| الطبقة              | المقترح                  | الملاءمة مع AIS                                    |
| ------------------- | ------------------------ | -------------------------------------------------- |
| API Gateway         | **APISIX/Kong**          | يحل توجيه/حصص المستأجرين وتكامل الشركاء/GDS        |
| Workflow            | **Temporal**             | يستبدل FSM؛ مثالي لـ Booking/Refund/IROPS/Check-in |
| Messaging           | **NATS/Kafka**           | العمود الفقري للأحداث + Outbox                     |
| Saga/Event Sourcing | **Eventuate Tram** (نمط) | اتساق المعاملات الموزّعة الحرجة                    |
| Observability       | **SkyWalking + OTel**    | tracing موزّع مفقود حالياً                         |
| Identity            | **Keycloak**             | federation + realm لكل مستأجر                      |
| Object Storage      | **MinIO**                | متوافق مع عميل S3 الموجود (تبديل endpoint)         |
| Platform            | **Kubernetes**           | موجود (Kustomize) — جاهز للتوسعة                   |

> **توصية اللغة/المكدّس:** البقاء على **TypeScript/NestJS-style + Kafka/NATS +
> Temporal** هو المسار الأقل احتكاكاً نظراً لقاعدة كود TS الحالية (550 ملف)، بدل
> إعادة الكتابة بـ Go/Java.

---

## 10. الخلاصة

AIS لا يحتاج إعادة بناء — يحتاج **ترقية معمارية متدرّجة** حول ثلاث ركائز بالترتيب:
**(1) عزل المستأجر → (2) عمود الأحداث + Outbox → (3) تنسيق Temporal**، ثم
الملاحظة/البوابة/الهوية، وأخيراً الاستخراج الانتقائي. كل خطوة تسلّم قيمة مستقلة
وتحافظ على استقرار الإنتاج. ابدأ بـ Modular Monolith + Async Event Layer — تماماً
كما يفرض مجال الطيران نفسه.
