# Baggage entitlement authority

## Safety boundary

`computeBaggageEntitlement` is the single automatic allowance authority used by
bag drop. It adds purchased weight only when all of these are true:

- the item is active and belongs to the requested passenger;
- the item has an explicit `specific_segment` scope;
- the immutable purchase snapshot is a positive gram value;
- `fundedAt` and `fundingReference` agree with the completed financial source;
- the referenced booking or modification receipt is still `applied`.

Any legacy or ambiguous baggage item grants no automatic weight. It produces a
named warning and causes self-service bag drop to require operator review. This
is fail-closed for both free allowance and automatic excess charging.

`all_segments` is represented in the schema but is not honored. Its commercial
meaning remains **PENDING APPROVAL — F30**.

## Funding writers

Two completed paths may create an entitlement:

1. Order servicing records an exact passenger, flight/segment, structured
   weight snapshot and either a collected modification receipt or an explicit
   no-charge execution event.
2. Initial provider collection may resolve a checkout item only when the paid
   booking has exactly one passenger and one stored segment. Multi-person or
   multi-segment items remain unresolved.

Kiosk insertion, an active status, a catalog name and a payment receipt recorded
before application are not funding evidence.

## Session revalidation

Admission stores an entitlement snapshot and segment identity. The authority is
queried again before every measurement and before belt confirmation. A changed
allowance recalculates excess weight and price; any prior paid marker is
invalidated when the required amount changes. The existing certified-device and
verified-PSP gates remain unchanged.

The existing baggage-custody authority blocks adding order-service baggage after
custody. No second custody state was introduced.

## Catalog and historical data

`BAG_20KG` and `BAG_30KG` have reviewed 20,000 g and 30,000 g definitions.
`BAG_SPORTS` remains undefined. Catalog migrations never synthesize historical
purchase snapshots, funding timestamps or scopes. Use the read-only SQL reports
in `scripts/audit-baggage-*.sql` to inventory reconciliation work.

## Acceptance evidence

The focused suite covers funded/unfunded evidence, explicit passenger and
segment isolation, cancellation before/after values, no-charge authority,
provider booking collection, a fixed 32,000 g single-piece limit, and session
revalidation after cancellation. The migration replay still requires a real
MySQL environment; schema generation and TypeScript checks do not replace it.

## Deliberately open

- `all_segments`, loyalty grams and expiry policy: **PENDING APPROVAL — F30**.
- Individual ancillary refund amount/allocation: owned by the financial
  authority and not inferred from grams.
- Legacy multi-passenger/multi-segment reconciliation: operator workflow.
- Live kiosk, scale, printer, belt and provider acceptance: external evidence;
  this implementation does not close E01–E11.
