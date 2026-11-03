# إيصال تنفيذ موجة معايير الطيران — 3 نوفمبر 2026

## الحكم

تبدأ هذه الموجة من `main` بعد دمج الطلب #236 عند الالتزام
`1b15916c20e9d59f683ec38871c5b9b1aa12d84b`. لم تكن هناك طلبات سحب مفتوحة
عند بدء العمل. أثناء التكامل ظهر الطلب المتخصص #240 لتنفيذ BCBP/PDF417، لذلك
أزيل هذا النطاق من الدفعة منعاً للتكرار. جُمعت بقية التغييرات في فرع تكامل واحد، وولّد المخطط ترحيلاً واحداً
هو `0059_airline_standards_readiness` حتى لا تتنافس الفروع على سجل Drizzle.

التنفيذ يجعل النظام جاهزاً لاختبارات القبول التالية، ولا يثبت قبول جهة حكومية
أو مطار أو مناول أو مزوّد. جميع مخارج النقل والإصدار التي تحتاج طرفاً خارجياً
تبقى مغلقة افتراضياً.

## ما نُفذ

| المسار         | السلوك المثبت في المستودع                                                                        | بوابة الإنتاج المتبقية                                    |
| -------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| السعر والضريبة | مكونات لكل راكب وقطاع مع المصدر والسياسة، وحفظ المبلغ الإجمالي دون اختراع ضريبة للبيانات القديمة | قواعد ضريبية معتمدة لكل خط سير ومصالحة التعديل والاسترداد |
| ZATCA          | مسودة داخلية ترفض الضريبة التقديرية والمبلغ غير المصنف، وتحفظ بصمات المكونات وQR مراجعة          | EGS/CSID وXML والتوقيع وتسع خانات وقبول FATOORA           |
| RBD            | مخزون لكل رحلة وفئة، يظهر في البحث ويُحجز ذرياً في البيع المباشر وmultiCity ويُعاد عند الإلغاء   | سعات وخرائط فئات معتمدة من إدارة الإيرادات                |
| الأمتعة        | لوحة من عشرة أرقام، نقاط الحيازة الأربع، وتقرير close-out يكشف النقص والتكرار                    | BTIC وقبول الماسحات وتبادل فعلي مع المناول                |
| Type B         | مسودات PNL/ADL/LDM/MVT/BSM/BPM وسجل عناوين ومحاولات وتسليم وإقرار                                | عنوان كل محطة ومحوّل SITA/ARINC أو IP وعينات طرف مقابل    |
| API/PNR        | PNRGOV EDIFACT `21:1` بنيوي، ACKRES/CONTRL، idempotency وإعادة المحاولة                          | مواصفة NPSC والعنوان والقناة وعينات ACK/NAK الفعلية       |
| وثائق السفر    | قرار go/no-go مرتبط ببصمة الوثيقة والناقل والمسار                                                | Timatic أو مصدر رسمي وقبول حالات الوجهات الحقيقية         |
| الوزن والتوازن | سجل طائرات وملف توازن إصداري، DOW/DOI و%MAC وغلاف ZFW/TOW/LAW وLMC ومسودة load sheet             | بيانات AHM وحالات مرجعية وتوقيع تشغيلي وLDM/CPM           |
| الطاقم         | حدود 28/365 يوماً اختيارية داخل سياسة مشغّل موقعة وسارية                                         | جداول المشغّل المعتمدة وحالات FRMS وكل مسارات التعيين     |
| الولاء         | سياسة انتهاء اختيارية، تخصيص SSP، التزام IFRS 15 وأحداث idempotent وbreakage نسبي                | اعتماد المالية وربط دفتر الأستاذ العام والشركاء           |
| حقوق المسافر   | ملفات إصدار لـGACA وEU261 وUK261 وUS DOT مع رفض الحساب عند نقص الوقائع أو السعر أو العملة        | اعتماد قانوني وتشغيلي لكل سوق وتسوية فعلية                |

## مراجع السلطة التي ثُبتت في التصميم

- ZATCA، مواصفات XML والبيانات والأمن المنشورة في 19 مايو 2023:
  <https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/E-Invoice-specifications.aspx>
- ZATCA، مواصفات QR بصيغة TLV:
  <https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Documents/QRCodeCreation.pdf>
- IATA، Resolution 753 ونقاط الأمتعة الأربع:
  <https://www.iata.org/en/programs/ops-infra/baggage/baggage-tracking/>
- IATA، Type B Messaging white paper version 2.1 بتاريخ 14 يونيو 2024:
  <https://www.iata.org/contentassets/badbfd2d36a74f12b021c9dd899ecbad/type_b_messaging_whitepaper_v2dot1_14_june_2024.pdf>
- ICAO، إرشادات API ومعايير PNRGOV:
  <https://www.icao.int/facilitation-programmes/api-guidelines-and-pnr-reporting-standards>
- GACA، Part 117 version 3.0. الملف المنشور ينص على الرجوع للموقع للحصول على النسخة الحالية:
  <https://www.gaca.gov.sa/-/media/Files/PDF/LawsAndRegulation/Aviation-Safety-and-Environmental-Sustainability/GACAR-Safety-Regulations/Part-117---Flight-and-Duty-Limitations-and-Rest-Requirements_-Flight-Crew-Members.pdf>
- GACA، Passenger Rights Protection Regulations:
  <https://www.gaca.gov.sa/-/media/Files/PDF/LawsAndRegulation/Consumer-Protection/Passenger-Rights-Protection-Regulations-EN.pdf>
- EUR-Lex، Regulation (EC) 261/2004:
  <https://eur-lex.europa.eu/legal-content/en/ALL/?uri=CELEX:32004R0261>
- UK legislation، النسخة البريطانية المعدلة من Regulation 261/2004:
  <https://www.legislation.gov.uk/eur/2004/261/body>
- US DOT، Part 260 وحقوق الاسترداد التلقائي:
  <https://www.transportation.gov/individuals/aviation-consumer-protection/refunds>
- IFRS Foundation، IFRS 15 وبنود contract liability وbreakage، B44–B47:
  <https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/>

## حدود الدليل

الاختبارات المحلية تستخدم بيانات اصطناعية ولا ترسل بيانات ركاب أو رسائل تشغيلية
خارج العملية. لم يحدث نشر إنتاجي. لا تُرفع بوابة أي قدرة إلى `implemented` بسبب
هذه الموجة وحدها. يلزم إرفاق دليل قبول مؤرخ من الجهة أو المشغّل أو المزوّد قبل
تفعيل متغيرات الإنتاج أو تغيير حالة ملف السياسة من `draft` إلى `approved`.

تسجل نتيجة التحقق النهائي وSHA فرع التكامل في تعليق الطلب بعد اكتمال فحوص
TypeScript وESLint والمجموعة الكاملة واختبارات ترحيل MySQL في CI.
