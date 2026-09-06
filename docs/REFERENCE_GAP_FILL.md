# مواءمة مرجع «تطبيق طيران بمستوى Lufthansa» مع AIS — استلهام وسدّ الفجوات

> **المبدأ (حسب طلبك):** استلهام لا تبنٍّ. AIS يبقى **Modular Monolith** نظيفاً؛
> لا نعيد بناءه كـ 20 microservice. نأخذ الأنماط القيّمة من المرجع ونسدّ ما ينقص
> فعلاً فوق الكود الحالي.

---

## 1. خريطة: عناصر المرجع → حالتها في AIS

| عنصر المرجع                                     | الحالة في AIS                                            | الإجراء                                              |
| ----------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| **Pricing Service** (seat+bundle−loyalty=total) | تسعير موجود لكن **لا Quote موحّد للعميل**                | ✅ **سُدّ الآن** — `price-quote.service.ts`          |
| Redis cache للتسعير + hit/miss metrics          | `redis-cache` + `metrics` موجودان                        | 🟡 موجود (يمكن ربط مقاييس hit/miss للتسعير لاحقاً)   |
| Kafka لإبطال الـ cache + Event-driven           | لا Kafka (BullMQ فقط)                                    | ⏭️ **المرحلة 1** في خطة الـ SaaS (Outbox+Kafka)      |
| Saga (Orchestration) للحجز                      | FSM يدوي (`booking-state-machine`)                       | ⏭️ **المرحلة 1** (Temporal)                          |
| IATA NDC / ONE Order (Offer/Order)              | `ndcOffers`/`ndcOrders` + راوتر `ndc` + آلة حالة + أحداث | 🟢 مُعزّز (state machine + Outbox events)            |
| GDS Abstraction (Amadeus/Sabre)                 | `gds.service` + راوتر `gds`                              | 🟢 موجود                                             |
| WebSocket/SSE تحديثات فورية                     | `websocket.service` + `ws`                               | 🟢 موجود                                             |
| Loyalty & Wallet                                | `loyalty` + `wallet` + tiers/miles                       | 🟢 موجود                                             |
| Baggage tracking                                | `baggage` + `baggageTracking`                            | 🟢 موجود                                             |
| Prometheus/Observability                        | `metrics` + APM + Sentry                                 | 🟢 موجود (ينقص OTel tracing — المرحلة 2)             |
| API Gateway (Rate limit/Quotas)                 | Nginx + rate-limit middleware                            | ⏭️ **المرحلة 1/2** (APISIX)                          |
| Zero Trust / OIDC / mTLS                        | JWT + FastAPI auth                                       | ⏭️ **المرحلة 2** (Keycloak)                          |
| Offline boarding pass (JWT/PKPass)              | eticket/boarding (QR نصّي غير موقّع)                     | ✅ **سُدّ الآن** — بطاقة صعود موقّعة + تحقّق offline |

**الخلاصة:** معظم قدرات المرجع موجودة فعلاً في AIS. الفجوة الوظيفية الحقيقية
والقابلة للسدّ فوراً كانت **Price Quote موحّد للعميل**. الفجوات الكبرى المتبقية
(Kafka/Saga/Gateway/OIDC) **مُخطَّطة سلفاً** في `AIRLINE_SAAS_GAP_ANALYSIS.md`
(المراحل 1–2) — لا حاجة لتكرارها أو لاعتماد معمارية المرجع.

---

## 2. ما سُدّ الآن: Price Quote Service

نظير **جانب العميل** لاقتصاديات المقعد (التي تحسب تكلفة/مساهمة الخطوط الجوية):

- **`server/services/price-quote.service.ts`**
  - `computePriceQuote()` (دالة نقية، قابلة للاختبار بلا قاعدة بيانات).
  - `getPriceQuote()` (تجلب سعر الرحلة + الخدمات الإضافية من الجداول الحقيقية).
  - المعادلة: `total = baseFare + ancillaries − tierDiscount − milesDiscount`.
  - مبنية على أعمدة حقيقية: `flights.economyPrice/businessPrice`,
    `ancillaryServices.price/available`, ومستويات الولاء.
  - خصومات المستوى ثوابت قابلة للضبط (`TIER_DISCOUNT_RATE`)؛ الأميال «what-if»
    (1 ميل = 1 هللة) **بلا أي خصم فعلي من الرصيد** (للقراءة فقط).
- **راوتر `priceQuote.get`** (public — لاكتشاف الأسعار/البحث).
- **7 اختبارات وحدة** (الأساس، الإضافات، خصم المستوى، الأميال، القصّ عند الصفر،
  تجاهل القيم السالبة).

> **لماذا public؟** عرض السعر جزء من اكتشاف الرحلات قبل تسجيل الدخول؛ المستوى
> والأميال مدخلات اختيارية «ماذا‑لو» بلا آثار جانبية.

### 2.1 ما سُدّ الآن: بطاقة صعود موقّعة (Signed Boarding Pass)

AIS كان يُصدر QR **نصّياً غير موقّع** (`PNR|ticket|name`) — قابل للتزوير وغير
قابل للتحقّق. أُضيف:

- **`boarding-pass.service.ts`**: `signBoardingPass` / `verifyBoardingPass`
  (JWT HS256، issuer/audience مثبّتان، صلاحية 48س) — التحقّق **نقي/يعمل offline**
  على بوابة الصعود دون قاعدة بيانات؛ و`issueBoardingPass` (مدعوم بقاعدة البيانات،
  يفرض ملكية الحجز عبر `access-control` وأن الراكب يخصّ الحجز، وأن الحجز مدفوع).
- **راوتر `boardingPass`**: `issue` (محمي) و`verify` (public لأجهزة البوابة).
- **6 اختبارات**: round-trip، رفض التلاعب بالتوقيع، رفض سرّ مختلف، رفض منتهية،
  رفض توكن لا يحمل issuer/audience البطاقة، تثبيت issuer/audience.

---

### 2.2 تحسين بنيوي: Circuit Breaker على التبعيات الخارجية

المرجع يستخدم Circuit Breaker بكثرة في محوّلات GDS. AIS كان يملك الأداة
(`withCircuitBreaker` في `production.service.ts`) لكنها **غير مستخدمة ولا
مُختبَرة**. التحسين:

- ربط `withCircuitBreaker` في `auth-service.client.ts` (تبعية HTTP خارجية):
  استجابات الخدمة (بما فيها أخطاء العمل 4xx) تمرّ ولا تفتح الدائرة؛ أعطال
  الشبكة/المهلة فقط تَعُدّ، وعند فتح الدائرة **تفشل النداءات فوراً** بدل التعليق
  5 ثوانٍ لكل نداء — مع الحفاظ على نفس السلوك المتسامح (`unavailable`).
- **4 اختبارات** جديدة للأداة (كانت بلا اختبارات): البقاء مغلقاً عند النجاح،
  الفتح بعد العتبة والفشل السريع دون استدعاء الدالة، الانتقال إلى half-open بعد
  المهلة ثم الإغلاق عند النجاح، وإعادة ضبط العدّاد خارج نافذة المراقبة.

## 3. ما لا نتبنّاه (عمداً)

- ❌ تفكيك AIS إلى 20+ microservice — التعقيد التشغيلي غير مبرَّر الآن.
- ❌ Kafka/Temporal/APISIX/Keycloak **الآن** — مُجدوَلة في المراحل 1–2 حين يبرّرها
  الحِمل الفعلي، لا التوقّع.
- ❌ تبديل PNR بالكامل بنموذج Offer/Order — NDC موجود كطبقة، والـ PNR يبقى الأساس.

هذا يحافظ على استقرار الإنتاج ويضيف قيمة عميل ملموسة (شفافية السعر) فوراً.
