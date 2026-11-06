# قبول الرسائل التشغيلية وبيانات الركاب

تاريخ المراجعة: 3 نوفمبر 2026. هذه الطبقة تنشئ مسودات وتحتفظ بحالة النقل والإقرار، ولا تثبت اتصالاً بالمركز الوطني لأمن الركاب أو SITA أو ARINC أو مناول أرضي.

## ما أصبح قابلاً للاختبار

- ينتج `apis-pnrgov.ts` غلاف PADIS EDIFACT بإصدار PNRGOV `21:1` بدلاً من التقرير النصي السابق. يتضمن رأس الرسالة ووظيفتها `22`، والرحلة، وعدد سجلات PNR، ومجموعات `SRC/RCI/TIF/TVL/RPI` وبيانات `DOCS` المتاحة. يرفض النص غير القابل للتمثيل بدل تغيير اسم المسافر بصمت.
- لا يُشتق عنوان السلطة من رمز الدولة. يلزم تعيين عنوان الصيغة المطلوبة في `AIS_PAXLST_DRAFT_RECIPIENT` أو `AIS_PNRGOV_DRAFT_RECIPIENT` المعتمد من المشغّل حتى لإنشاء المسودة.
- يفسر محلل الإقرار `ACKRES` للحالات 2 و3 و7 و8، و`ERC`، ويُميّز إقرار الاستلام عن نجاح المعالجة. كما يفسر الحد الأدنى من `CONTRL` حتى لا يُعامل نجاح طبقة النقل كقبول وظيفي.
- تنشئ طبقة الرسائل التشغيلية مسودات حتمية من الأنواع PNL وADL وLDM وMVT وBSM وBPM، بعناوين Type B من سبعة محارف وبأولوية `QU`. الصيغة موسومة `operator-template-v1` لأن تفاصيل كل رسالة تحتاج ملف المشغّل أو المناول المتعاقَد.
- يحفظ نموذج البيانات عنوان المحطة المعتمد، وبصمة SHA-256 للنص، ومفتاح منع التكرار، والمحاولات والإيجار وحالات الاستلام والقبول والرفض. لا تحفظ الاستجابة الخام، بل بصمتها ورمزها ورسالة خطأ محدودة.
- تبقى عمليات النقل والإقرار في الإنتاج محجوبة لعدم وجود محوّل نقل أو مستقبل إقرارات موثوق. لا يكفي مسار محطة مفعّل أو قبول مؤرخ أو `AIS_TYPE_B_TRANSPORT_ENABLED=true` لفتحها. تتطلب المحاكاة خارج الإنتاج أيضاً `AIS_ENABLE_DEMOS=true` وحدود مزوّد مفتوحة، ولا تتصل المحاكاة بأي مزوّد.
- يبقى قرار وثائق السفر في مسار `travel_clearance` الموقّع الموجود: يربط الحكم ببصمة الوثائق وبصمة الناقل والوجهات والقطاعات، ويعيد التحقق عند تسجيل الوصول وإصدار بطاقة الصعود. الحكم الدولي الافتراضي مغلق، ولا تستنتج المنصة أهلية تأشيرة من الجنسية وحدها.

## ربط الإقرار بالإرسال

تقتصر مسودة الركاب على رحلة وحجوزات ضمن مستأجر المسؤول. يحصل كل إصدار للمسودة على مرجع مستقل. يعيد نظام النقل استخدام نص الإرسال المحفوظ عند المحاولة مجدداً. قبل تغيير الحالة، تُطابق الخدمة طرفي التبادل ومرجع الرسالة الأصلية. يستخدم ACKRES المرجع المشترك، ويستخدم CONTRL مرجع التبادل ومرجع الرسالة عند وجود UCM، ويستخدم CUSRES مرجع المعاملة `RFF+TN` مع رقم المراجعة عند وروده. إعادة الإقرار المطابق تحفظ توقيت التسجيل الأول.

يقتصر دعم CUSRES على الرد العام ذي `BGM+962` و`ERP+1`. يُثبت `ERC+ACK` الاستلام فقط، ويعني `ERC+X` خطأ في الرسالة. تتطلب قرارات الراكب الفردية مواصفة ثنائية وقبولاً مستقلاً. [دليل IATA/WCO/ICAO، المثال 5.7](https://www.iata.org/contentassets/18a5fdb2dc144d619a8c10dc1472ae80/api-guidelines-2013-appendix-ii-b-cusres-message-implementation-guide_english-only.pdf)

يتحقق عقد عامل المحاكاة عند سحب الرسالة من المستأجر ونوع الرسالة وعنوانَي المحطة وهوية معتمد المسار وتاريخ الاعتماد وبصمة النص. لا يوجد عامل نقل إنتاجي في المستودع. يرفض العامل المعزول تسليم نص الرسالة، ولا يقبل طابور Type B رسائل APIS. يبقى النقل الحكومي محجوباً حتى تثبيت محوّل مقبول ومستقبل إقرارات موثوق.

## بوابة القبول الخارجي

يبقى النقل معطلاً حتى يسلّم المشغّل لكل محطة:

1. عنوانَي المرسل والمستقبل وملف الرسالة المتفق عليه مع SITA أو ARINC أو بوابة IP.
2. عينات ذهبية من المناول لكل نوع مستخدم ونتيجة قبولها في الطرف المقابل.
3. مواصفة المركز الوطني لأمن الركاب، وعنوان السلطة، وإصدار PNRGOV، ونموذج الدفع، ومواعيد الإرسال، وآلية ACKRES أو CONTRL وإعادة المحاولة.
4. أسرار النقل في مخزن أسرار وهوية جهة الإرسال، مع تمرين رفض وإعادة إرسال وتوقف آمن.
5. قرار احتفاظ ووصول للرسائل التي تحتوي بيانات ركاب ووثائق سفر.

نجاح اختبارات المستودع يثبت التوليد الحتمي والتحقق والانتقالات فقط. لا يرفع حالة `apisSubmission` من `blocked` ولا يثبت مطابقة RP 1745 أو أي ملف خاص بالناقل.

## المراجع الحاكمة

- IATA، [API-PNR Toolkit](https://www.iata.org/en/publications/api-pnr-toolkit/)، يتضمن PAXLST 05B ودليل PNRGOV EDIFACT.
- IATA/WCO/ICAO، [PNRGOV EDIFACT MIG 21.1](https://www.iata.org/contentassets/18a5fdb2dc144d619a8c10dc1472ae80/pnrgov-edifact-implementation-guide_21_1.pdf). يعرّف `MSG` 22 للدفع، و`ACKRES` 23، وحالات الإقرار 2 و3 و7 و8، ويجعل تفاصيل النقل والإصدار خاضعة للاتفاق الثنائي.
- IATA، [Type B Messaging Whitepaper v2.5](https://www.iata.org/contentassets/badbfd2d36a74f12b021c9dd899ecbad/type-b-messaging-whitepaper-v2.5.pdf)، 7 مايو 2025. يصف الاستخدام المخزّن والممرّر وتعدد شبكات النقل والحاجة إلى انتقال تدريجي.
- IATA، [Baggage Information Exchange](https://www.iata.org/en/programs/ops-infra/baggage/baggage-information-exchange-bix/). يصف RP 1755 وBIX القائم على AIDM كمسار حديث بجانب الرسائل القديمة.
- ICAO، [API Guidelines and PNR Reporting Standards](https://www.icao.int/facilitation-programmes/api-guidelines-and-pnr-reporting-standards).

يجب إعادة التحقق من هذه المراجع ومن الاتفاقات الثنائية وقت القبول، لأن الصيغة الفعلية والعناوين ومواعيد الدفع ليست قراراً برمجياً عاماً.

## مراجعة حقل الإصدار في بطاقة الصعود

اختبرنا على عينات AIS طول القسم الشرطي الإجمالي في الحقل 6، وطولَي القسم الفريد في الحقل 10 والقسم المتكرر في الحقل 17. يرفض القارئ طولاً غير سداسي عشري أو يتجاوز القسم، وزيادة محارف خارج قسم التوقيع. بقي مسار التحقق من بطاقات الإصدار 6 القائمة كما هو للبطاقات الصحيحة.

يضع مشفّر AIS الرقم 6 في الحقل 9، ويمثّل البالغ والطفل والرضيع في الحقل 15. لا يستمد وصف الجنس من اللقب، ولا يُصدر سلسلة بطاقات الأمتعة الاختيارية في الحقول 23 و31 و32. تغيّر معنى عدّ الحقائب في الإصدار 7، وأضاف الإصدار 8 دلالة غير محدد وغير مفصح عنه. لذلك يجب أن تشمل عينات القبول المورّدة من المشغّل قيمة الإصدار السلكية، والحقول الشرطية التي يعتمدها المشغل، وقيم عدّ الحقائب عند استخدامها. مثال IATA الموجود للاختبار يستخدم الحقول الإلزامية فقط ولا يحتوي رقم إصدار. لم نجد عينة مستقلة موثقة بترميز سلكي 8 تطابق ملف AIS. ما زال قبول الإصدار 8 يتطلب مرجع المشغّل، وقراءة PDF417 على قارئ المحطة المستهدفة. [تغييرات IATA للإصدارين 7 و8](https://www.iata.org/en/programs/passenger/common-use/) · [دليل تنفيذ BCBP المنشور](https://www.iata.org/contentassets/1dccc9ed041b4f3bbdcf8ee8682e75c4/2021_03_02-bcbp-implementation-guide-version-7-.pdf)

## قبول محطة تجريبية واحدة

يشغّل اختبار MySQL المعزول `HANDLER-STATION-01` حجزين وقسيمتين ورسالتي PNL وADL من قالب AIS المحلي. يحمل السطر الاختياري `.SEAT/1B` المقعد الجديد للراكب السابق له. تُرفض إضافة مقعد إلى سجل حذف. يتلقى المناول التجريبي الرسالتين من عامل النقل ويعيد مرجعًا اصطناعيًا لكل منهما.

## Execution boundary and recovery contract — 5 November 2026

`operations.messageTransportCapability` reports the implemented boundary:
production sender unavailable, authenticated authority receiver unavailable,
and either disabled or explicitly enabled simulation mode. An environment flag,
an acceptance date in a local route row, and a receipt string do not install a
transport adapter. `apis.getSubmissionCapability` continues to report authority
submission unavailable, and `submitToAuthorities` fails before database writes.

The simulation claim includes tenant, route, transport profile, station,
origin/destination, immutable payload digest, stable idempotency key, lease key
and lease expiry. Result recording validates that binding and the current route
again. A stale worker cannot record a result after its lease expires or after a
replacement attempt acquires the message.

| State or result                                          | Meaning in this repository                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draft`                                                  | Local message preparation only.                                                                                                                                   |
| `queued`                                                 | Eligible for the explicit simulation runner; no transmission.                                                                                                     |
| `sending`                                                | A leased simulation attempt; no evidence of delivery.                                                                                                             |
| Result `simulated`                                       | A synthetic `fixture-` receipt exercised the state machine. The legacy stored status is `sent`, but the result explicitly reports `externallyTransmitted: false`. |
| `received` / `acknowledged` / `rejected` in fixture runs | Parser/state-machine outcomes. The result reports `authenticatedAuthorityAcknowledgment: false`; parsing and matching an envelope do not authenticate its source. |
| `failed` with `delivery_outcome_unknown`                 | Terminal quarantine requiring reconciliation; never an automatic resend.                                                                                          |
| `retry_scheduled`                                        | A failure explicitly classified `not_sent`, with bounded retries and the original payload/idempotency key.                                                        |

A timeout with an unknown delivery outcome and an abandoned `sending` lease can
represent a message already delivered to the destination. Both are quarantined.
The repository has no verified external status-reconciliation adapter, so an
operator must retain the original reference and obtain authoritative delivery
evidence before any separately implemented recovery action. No endpoint in this
change resets that ambiguous message to queued.

The synthetic handler-station runner refuses production, enables demos only
within its existing fixture scope, restores the previous environment afterward,
and asserts a simulated result. It supplies no real handler receipt or ACK.

Production activation remains blocked pending an installed worker/adapter with
authenticated receipts and ACKs, accepted tenant/carrier/station/profile bindings,
and provider evidence covering idempotency, rejection, timeout, lost response and
reconciliation. The current generic EDIFACT parser is only the syntax and
correlation layer of that future receiver.

يستقبل إجراء `aviationIntegrations.ingestCouponUplift` في بيئة الاختبار سطرًا مُحوّلًا من ETL عبر الظرف الموقّع الموجود. يحدد السطر التذكرة المكونة من 13 رقمًا ورقم القسيمة في `payload.ticketNumber` و`payload.couponNumber`، وتحدد `flightId` الرحلة. يُضبط المصدر بصلاحية `handler_etl` وبنطاق المستأجر والناقل ومطار المغادرة. يبقى `eventId` ثابتًا للسطر حتى إذا أُعيد توقيع الإرسال بوقت جديد. يحتفظ AIS بالحمولة الأصلية وبمطابقتها الداخلية للحجز والراكب والقسيمة ليستخدمها موظف المالية.

تتطلب تجربة المناول الفعلي مواصفة ETL وعينة قبول من المحطة، بما في ذلك ترجمة رقم الرحلة ويوم التشغيل إلى رحلة AIS، وربط مرجع كل سطر بالإرسال الأصلي. تظل بوابة استخدام القسيمة في الإنتاج مقفلة. الإجراء يعالج سطرًا واحدًا في معاملة واحدة.
