# ZATCA e-invoice readiness boundary

Reviewed on 3 November 2026. This increment preserves the priced invoice as
minor-unit component rows. Where a retail offer contains named fare lines, AIS
stores base fare, quoted tax estimate and booking fee for every passenger and
flight. Gross-only group allocations and price locks remain `unclassified` so
that finance can reconcile them without inferring a tax treatment.

## What the code proves

- `booking_fare_components` conserves the booking total and records the
  passenger, flight, source offer/policy and monetary component.
- `zatca_invoice_drafts` can hold an immutable internal source record and the
  hash of its components.
- `buildZatcaPreviewQr()` encodes the first five TLV fields for review. It is
  deliberately named **preview** and is not a Phase 2 QR code.
- draft creation is disabled unless `AIS_ZATCA_DRAFT_MODE=true`. Production also
  requires an operator acceptance evidence identifier. An offer line coded
  `OFFER_TAX_ESTIMATE` or any `unclassified` amount blocks draft creation.

## External acceptance still required

AIS does not generate the ZATCA XML, cryptographic stamp, invoice counter, hash
chain, Phase 2 nine-tag QR code, CSID onboarding request, reporting request or
clearance request. It does not classify a flight as domestic or international.
The airline's Saudi tax owner must approve the seller identity, route and
ancillary tax categories, document type, invoice timing and credit-note rules.
An onboarded E-Invoice Generation Solution must then sign the XML and a sandbox
acceptance must verify the FATOORA responses and retry/idempotency behaviour.

The official detailed guideline states that Phase 2 simplified invoices use an
onboarded EGS, stamped XML and a nine-tag TLV QR and that the XML is reported to
FATOORA within 24 hours. The implementation and security specifications remain
the source of truth for the version accepted by the operator:

- ZATCA, E-Invoice specifications, updated 19 May 2023 and accessed 3 November
  2026: https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/E-Invoice-specifications.aspx
- ZATCA, Security requirements, updated 19 May 2023 and accessed 3 November
  2026: https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/Pages/Security-Requirements.aspx
- ZATCA, Detailed E-Invoicing Guideline, accessed 3 November 2026:
  https://www.zatca.gov.sa/en/e-invoicing/introduction/guidelines/documents/e-invoicing_detailed__guideline.pdf
- ZATCA, VAT Implementing Regulations and Article 34 on international passenger
  transport, accessed 3 November 2026:
  https://zatca.gov.sa/en/RulesRegulations/VAT/Documents/Value-Added-Tax-Approved-Implementing-Regulations-Bilingual.pdf

## حد الجاهزية

تسجّل المنظومة مكوّنات السعر لكل راكب ورحلة عندما يوفر العرض تلك البيانات،
وتمنع إنشاء مسودة الفاتورة إذا بقيت الضريبة تقديراً أو بقي جزء من الإجمالي غير
مصنّف. لا تمثل المسودة فاتورة صادرة من ZATCA. التوقيع، وXML، ورمز QR ذي التسع
خانات، والإبلاغ أو التخليص، واستجابة FATOORA تبقى خلف قبول EGS فعلي وسياسة
ضريبية يعتمدها المشغّل.
