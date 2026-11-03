# نظام الطيران المتكامل (AIS)

[![codecov](https://codecov.io/gh/kafaat/ais-aviation-system/branch/main/graph/badge.svg)](https://codecov.io/gh/kafaat/ais-aviation-system)
[![CI/CD Pipeline](https://github.com/kafaat/ais-aviation-system/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/kafaat/ais-aviation-system/actions/workflows/ci-cd.yml)

نظام شامل لحجز تذاكر الطيران وإدارة الرحلات مبني باستخدام React، TypeScript، tRPC، وMySQL.

## 🌟 المميزات

### للمستخدمين

- **البحث عن الرحلات**: بحث متقدم عن الرحلات حسب الوجهة والتاريخ والدرجة
- **الحجز السهل**: نظام حجز بسيط وسريع مع دعم عدة ركاب
- **الدفع الآمن**: تكامل Stripe والدفع المقسم مختبران محلياً. راجع دليل قبول المزوّد E01
- **إدارة الحجوزات**: عرض وإلغاء وتعديل جميع حجوزاتك
- **تسجيل الوصول**: تسجيل وصول إلكتروني مع اختيار المقاعد
- **التذاكر الإلكترونية**: تحميل مستندات PDF بمرجع تذكرة محلي
- **برنامج الولاء**: كسب واستبدال الأميال مع مستويات (برونز، فضي، ذهبي، بلاتيني)
- **قائمة الانتظار**: الانضمام لقائمة الانتظار للرحلات الممتلئة
- **تنبيهات الأسعار**: إشعارات عند انخفاض أسعار الرحلات
- **القسائم والأرصدة**: استخدام قسائم الخصم والرصيد في الحجز
- **حجز المجموعات**: طلب حجوزات جماعية بأسعار خاصة
- **المحفظة الرقمية**: إدارة الأرصدة والمعاملات المالية
- **تقويم الأسعار**: مقارنة الأسعار عبر التواريخ المختلفة
- **الدردشة الذكية**: مساعد ذكي للحجز مدعوم بالذكاء الاصطناعي

### للإداريين

- **إدارة الرحلات**: إضافة وتعديل وحذف الرحلات مع إدارة الحالة
- **لوحة تحكم شاملة**: عرض الإحصائيات والتقارير والتحليلات
- **إدارة شركات الطيران**: إدارة بيانات شركات الطيران
- **إدارة المطارات والبوابات**: إدارة المطارات وتعيين البوابات للرحلات
- **نظام مغادرة DCS**: نظام التحكم بالمغادرة مع إدارة الركاب
- **إدارة القسائم**: إنشاء وإدارة قسائم الخصم والأرصدة
- **الحسابات المؤسسية**: إدارة حسابات الشركات ووكلاء السفر
- **إدارة الأمتعة**: تتبع وإدارة أمتعة الركاب
- **إدارة الاضطرابات**: معالجة اضطرابات الرحلات واقتراح خيارات لإعادة الحجز
- **مركز IROPS**: اقتراح خطط استعادة ومراجعتها
- **الوزن والتوازن**: محاكاة تدريبية لحساب الوزن والتوازن
- **تخطيط الحمولة**: محاكاة تدريبية لتخطيط الحمولة
- **إدارة الطاقم**: تسجيل تعيينات الطاقم؛ اعتماد قواعد الأهلية معلّق
- **APIS**: توليد بيانات الركاب محلياً؛ قبول الإرسال إلى السلطة معلّق
- **الصعود البيومتري**: محاكاة التحقق من الوجه
- **أكشاك الخدمة الذاتية**: تدفق تسجيل وصول تجريبي؛ قبول أجهزة المحطة معلّق
- **إسقاط الأمتعة الآلي**: محاكاة لأجهزة إسقاط الأمتعة
- **المحاسبة المالية**: تقارير التحصيل النقدي من الدفتر
- **تقارير BSP**: نموذج تقارير HOT؛ التسوية الخارجية معلّقة
- **تعويضات EU261/DOT**: قواعد أولية لـ EU261 وDOT؛ قواعد GACA معلّقة
- **الفنادق الطارئة**: إدارة إقامة فنادق IROPS
- **أولوية الركاب**: تسجيل الأولوية وترتيب إعادة الحجز
- **مراقبة SLA**: تتبع اتفاقيات مستوى الخدمة
- **مستودع البيانات/BI**: الذكاء التجاري والتحليلات
- **المصادقة الثنائية MFA**: المصادقة متعددة العوامل TOTP
- **التعافي من الكوارث**: محاكاة للتعافي واختبار استعادة في CI

## حالة التنفيذ ودليل القبول

يعرض الجدول حالة الكود وشروط القبول. توثّق نتائج الاختبار الخارجي في [سجل قبول المزوّدين](docs/operations/provider-acceptance.md).

<!-- capability-catalog:start -->
<!-- prettier-ignore -->
| Capability | Implementation | Acceptance requirement |
| --- | --- | --- |
| hotelFulfillment | implemented | Default disabled; Hotelbeds single adult/room, net SAR, explicit quote and hotel mapping approval; sandbox confirmation is not a real stay. Live credentials, certification, local fees/transport and property acceptance remain operator responsibilities. |
| ndcUnpaidServicing | implemented | Unpaid pending invoice, no active checkout, same airline/tenant SAR economy or business offer, canonical passengers; no EMD or external fulfillment certification |
| ndcPaidServicing | implemented | Local paid SAR itinerary exchange and catalog entitlements before check-in; same tenant/airline and cabin across up to six segments, no unresolved ancillary fulfillment. Original Stripe payer refund receipts required for a lower fare. |
| ndcCapabilityMatrix | implemented | Per carrier/seller/channel/schema-version/action rows gate shop, order create, voluntary change, ancillary change, seat move, refund and name correction; only confirmed rows authorize. Seeded: direct channel 21.3 vocabulary from repository evidence, Lufthansa Group 24.1 vs 17.2 (passenger split, involuntary change), unconfirmed Finnair 21.3 and Iberia 24.1 rows; GDS/OTA/NDC channel defaults are unsupported until the operator confirms a contracted seller. Each row also records where the partner carries the stable idempotency key versus the per-attempt trace/transaction id. |
| ndcSchemaEndpoints | blocked | Internally implemented: 21.3 message names (AirShopping, OfferPrice, OrderCreate, OrderRetrieve, OrderCancel, OrderChange, ancillary add) over tRPC/OpenAPI JSON for the direct channel. Not exposed externally: no schema-conformant 17.2, 21.3 or 24.1 XML/JSON endpoint, seller authentication, look-to-book protection or IATA ARM registration; passenger split and involuntary change are not implemented for any version. |
| ndcExternalFulfillment | blocked | Contracted ticket reissue/EMD acceptance remains separate from local reservation, collection and refund receipts |
| kioskHardware | blocked | Authenticated device heartbeat and physical printer/scanner acceptance; digital documents are separate |
| dcsDispatch | demo | Verified departure-control provider and dispatch acceptance |
| dcsCounterLifecycle | implemented | Tenant-scoped paid passenger/flight check-in, open/close/reopen, board/deplane/deny/allow/offload with transactional command receipts and actor/reason history. New travel retains document, seat and time-window rules. Deplane/offload may correct current attendance after the schedule cutoff or flight cancellation while funding, active-segment, tenant, seat and baggage guards remain required; completed/refunded cases require reconciliation. An unresolved counter bag blocks offload until signed handback. The desk supports station cases, scoped APFAX, seat blocking and remapping, eligible quoted downgrades, supervised DCS closure and observed OUT. Authority, station device and dispatch acceptance remain external. |
| staffBaggageRegistration | implemented | Scoped airline staff, exact confirmed passenger/flight/segment, current check-in, funded cumulative allowance and payload-bound transactional idempotency. Configured carrier numeric code required; ambiguous legacy baggage requires review. Counter receipts do not replace signed device custody or certified hardware acceptance. |
| crewLegality | implemented | Operator-confirmed active FTL rule set per airline (EASA ORO.FTL seed carries research-documented values plus transcribed values that must be verified against the primary text; GACAR Part 117 Tables A/B/C and FRMS values must be loaded from the official text). Illegal verdicts block every assignment path unless a documented override is recorded and allowed. The engine is the single authority for cumulative flight time and applies the stricter of the rule set and the signed operator profile's 28/365-day limits. Fatigue indicator is advisory, not a certified FRMS. |
| gdsSynchronization | demo | Contracted GDS connection and round-trip order synchronization |
| biometricIdentity | demo | Approved biometric processor, measured verification and privacy controls |
| multiRegionFailover | demo | Infrastructure adapter, replication evidence and controlled failover drill |
| apisSubmission | blocked | Authority transport, credentials, acknowledgement and rejection fixtures |
| alternatePayments | blocked | Invoice/session binding, amount/currency verification, settlement and refund acceptance for each provider |
| bagDropHardware | demo | Certified scale, printer, conveyor and device heartbeat adapter |
| bcbpBoardingPass | implemented | IATA Resolution 792 M1 string (BCBP version 6 conditional items, HMAC security data) rendered as PDF417 beside the signed QR, round-trip tested with committed sample vectors; acceptance by the airport's CUSS/CUPPS/gate readers and independently captured scanner reads remain external evidence |
| weightBalance | demo | Approved aircraft data, calculation validation and operational sign-off |
| loadPlanning | demo | Aircraft configuration, measured cargo and approved dispatch workflow |
| disasterRecovery | demo | Infrastructure adapter and observed restore/failover exercise |
| warehouseExports | implemented | Migration applied; shared database and authorized export owner |
| eventInbox | implemented | Migration applied; local transaction or authenticated receiver acknowledgement |
| scheduledTasks | implemented | Shared database lease and observed lastSuccessAt |
| slaObservations | implemented | Persisted API samples and worker dependency observations; independent external availability measurements are required for contractual SLA |

<!-- capability-catalog:end -->

## 🛠️ التقنيات المستخدمة

### Frontend

- **React 19** - مكتبة واجهة المستخدم
- **TypeScript** - للكتابة الآمنة
- **Tailwind CSS 4** - للتصميم
- **shadcn/ui** - مكونات واجهة المستخدم
- **Wouter** - للتوجيه
- **date-fns** - للتعامل مع التواريخ

### Backend

- **Express 4** - خادم الويب
- **tRPC 11** - للـ APIs type-safe
- **Drizzle ORM** - للتعامل مع قاعدة البيانات
- **MySQL/TiDB** - قاعدة البيانات

### المصادقة

- **FastAPI Auth Service** - خدمة مصادقة مستقلة (Python)
- **bcrypt** - تشفير كلمات المرور
- **SQLAlchemy** - ORM لخدمة المصادقة

### أدوات إضافية

- **BullMQ + Redis** - معالجة المهام في الخلفية
- **Sentry** - مراقبة الأخطاء
- **Pino** - التسجيل المنظم
- **Stripe** - معالجة المدفوعات

### Testing

- **Vitest** - إطار الاختبار
- **1,044 اختبار** (804 ناجح + 240 يتطلب قاعدة بيانات) - تغطية شاملة للنظام
- **Playwright** - اختبارات E2E

## 📚 الوثائق

للحصول على معلومات شاملة، راجع الوثائق التالية:

- **[دليل المطور](docs/DEVELOPER_GUIDE.md)** - دليل شامل للمطورين
- **[البنية المعمارية](docs/ARCHITECTURE.md)** - وصف تفصيلي للنظام
- **[واجهات API](docs/API_DOCUMENTATION.md)** - مرجع كامل لواجهات البرمجة
- **[الأمان](docs/SECURITY.md)** - دليل الأمان وأفضل الممارسات
- **[استكشاف الأخطاء](docs/TROUBLESHOOTING.md)** - حل المشاكل الشائعة
- **[سجل التغييرات](CHANGELOG.md)** - تاريخ الإصدارات والتحديثات

## 📦 التثبيت

### المتطلبات

- Node.js 22+
- pnpm
- MySQL/TiDB database

### الخطوات

1. **استنساخ المشروع**

```bash
git clone https://github.com/kafaat/ais-aviation-system.git
cd ais-aviation-system
```

2. **تثبيت الحزم**

```bash
pnpm install
```

3. **إعداد قاعدة البيانات**

```bash
# نسخ ملف البيئة
cp .env.example .env
# قم بتعديل ملف .env بإعدادات قاعدة البيانات الخاصة بك

# تطبيق migrations
pnpm db:push

# إضافة بيانات تجريبية
npx tsx scripts/seed-data.mjs
```

4. **تشغيل المشروع**

```bash
pnpm dev
```

المشروع سيعمل على `http://localhost:3000`

## 🧪 الاختبارات

```bash
# تشغيل جميع الاختبارات
pnpm test

# تشغيل الاختبارات في وضع المراقبة
pnpm test:watch
```

## 📊 قاعدة البيانات

### الجداول الرئيسية

- **users** - بيانات المستخدمين
- **airlines** - شركات الطيران
- **airports** - المطارات
- **flights** - الرحلات
- **bookings** - الحجوزات
- **passengers** - الركاب
- **payments** - المدفوعات

### جداول متقدمة (المرحلة 2 و 3)

- **loyalty_accounts** - برنامج الولاء والأميال
- **ancillary_services** - الخدمات الإضافية (أمتعة، وجبات)
- **inventory_locks** - قفل المخزون أثناء الحجز
- **refunds** - الاستردادات
- **user_preferences** - تفضيلات المستخدم
- **airport_gates / gate_assignments** - إدارة بوابات المطار
- **vouchers / voucher_usage** - القسائم والخصومات
- **user_credits / credit_usage** - أرصدة المستخدمين
- **waitlist** - قوائم الانتظار
- **corporate_accounts** - حسابات الشركات
- **travel_agents** - وكلاء السفر
- **split_payments** - الدفع المقسم
- **price_alerts** - تنبيهات الأسعار
- **notifications** - الإشعارات

النظام يحتوي على **100 جدول** في المخطط الكامل (`drizzle/schema.ts`)

لمزيد من التفاصيل، راجع [وثائق البنية المعمارية](docs/ARCHITECTURE.md#database-design)

## 🔐 المصادقة

النظام يدعم طريقتين للمصادقة:

1. **المصادقة بكلمة المرور** (جديد): تسجيل وتسجيل دخول عبر البريد الإلكتروني وكلمة المرور
   - خدمة مصادقة مستقلة مبنية بـ FastAPI (`auth-service/`)
   - تشفير آمن بـ bcrypt
   - تتواصل مع الخادم الرئيسي عبر HTTP
2. **OAuth**: تسجيل الدخول باستخدام حسابات OAuth الخارجية

المستخدمون يمكنهم:

- تسجيل حساب جديد بالبريد الإلكتروني وكلمة المرور
- تسجيل الدخول باستخدام OAuth أو كلمة المرور
- عرض وإدارة حجوزاتهم
- الوصول إلى لوحة التحكم الإدارية (للمسؤولين فقط)

لمزيد من التفاصيل، راجع [دليل الأمان](docs/SECURITY.md#authentication--authorization)

## 🚀 النشر

### البيئة المطلوبة

- Node.js 22+
- MySQL/TiDB database
- متغيرات البيئة المطلوبة (انظر `.env.example`)

### خطوات النشر

1. بناء المشروع: `pnpm build`
2. تشغيل الخادم: `pnpm start`
3. تشغيل العامل: `node dist/worker.js` (اختياري - للمهام الخلفية)

### النشر باستخدام Docker

```bash
# بيئة التطوير (MySQL + Redis + phpMyAdmin)
docker-compose up

# بيئة الإنتاج
docker-compose -f docker-compose.prod.yml up
```

لمزيد من التفاصيل، راجع [دليل المطور](docs/DEVELOPER_GUIDE.md)

## 🔧 استكشاف الأخطاء

في حالة مواجهة أي مشاكل:

1. تحقق من [دليل استكشاف الأخطاء](docs/TROUBLESHOOTING.md)
2. راجع سجلات النظام
3. تأكد من صحة متغيرات البيئة
4. افتح issue على GitHub

## 📈 الحالة والإحصائيات

- **الإصدار:** 1.19.1
- **الاختبارات:** 821 اختبار ناجح + 240 يتطلب قاعدة بيانات (1,061 إجمالاً) ✅
- **ملفات TypeScript:** 550+ ملف
- **الأسطر البرمجية:** 220,000+ سطر
- **واجهات API:** 83 راوتر tRPC مسجل
- **جداول قاعدة البيانات:** 102 جدول
- **هجرات قاعدة البيانات:** 10 migrations
- **مكونات React:** 83 مكون مخصص + 53 مكون أساسي (shadcn/ui)
- **صفحات:** 57 صفحة
- **خدمات الخلفية:** 111 خدمة
- **مفاتيح الترجمة:** 3,088 مفتاح لكل لغة (عربي/إنجليزي)
- **الوثائق:** شاملة ومحدثة

## 📝 الترخيص

MIT License

## 👥 المساهمة

المساهمات مرحب بها! يرجى مراجعة [دليل المساهمة](CONTRIBUTING.md) لمعرفة كيفية المساهمة في المشروع.

للاطلاع على كيفية جعل المستودع عام أو التحقق من حالته، راجع [CONTRIBUTING.md](CONTRIBUTING.md).

## 📧 التواصل

للاستفسارات والدعم، يرجى التواصل عبر:

- البريد الإلكتروني: info@ais.com
- الموقع: https://ais-aviation-system.manus.space

---

تم التطوير بواسطة Manus AI 🤖
