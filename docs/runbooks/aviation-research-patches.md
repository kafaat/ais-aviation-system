# Aviation research implementation series

Base: `3161c036b221f0d2e3610c3d6430609b0f5605bb` (`v1.22.11`).
Apply the numbered patches in order. Production migrations and partner acceptance are separate deployment steps; no production connection is used to produce this series.

## 01 — Financial read definitions

Owner: `financial-reporting.service`; consumers: Analytics KPI/daily collections and Warehouse revenue exports. Uses the existing `financial_ledger`, including booking wallet spending and each settled split payer. Wallet top-ups are excluded to prevent counting funding twice. Refunds use posted amounts and posting dates, including partial and refund-only days. Booking invoice amounts use creation dates and remain separate. All values are SAR minor units; UTC dates are independent of the database session timezone.

`totalRevenue`/daily `revenue` remain compatibility aliases for **net collections**; dashboard labels have changed. Revenue exports now expose explicit billed, collected, refunded and net-collected columns; `earnedRevenue` is empty/unknown, never inferred from payment or flight status. Consumers of the previous revenue-export layout must update their mappings. Incremental invoice timestamps are rejected for settlement exports. Booking-origin/popularity and ancillary metrics elsewhere still describe invoiced amounts; they must not be interpreted as cash or recognition.

Paid/refunded legacy bookings without a booking charge, and unclassified adjustment entries, appear as reconciliation gaps. Reconcile them with provider and accounting evidence; no automatic historical ledger entries are fabricated.

Validation: financial read tests cover split payers, partial refunds, posting dates, an unknown earned amount, invalid amounts, export parity and storage failures. Final validation results are recorded with the patch bundle.

## 02 — Durable disruption recovery

Migration `0021_durable_irops` must precede this code. Disruption identity/status remain owned by `flight_disruptions`; IROPS adds durable enrichment and request-keyed actions, with outbox events in the same transaction. Repeating protection planning under the event lock reuses actions. The dashboard and metrics read the database and count each disruption once. Passenger recovery counts unique confirmed re-accommodations, not hotel tasks or proposed actions. Closing an event refuses unconfirmed work; it never marks work completed.

Mass notification stores an idempotent in-app notice and its receipt atomically. This confirms an inbox record, not email delivery. Re-accommodation completion is internal to the booking authority; no API accepts an arbitrary `completed` flag. Partner hotel/voucher/compensation execution still requires the appropriate provider authority and acceptance evidence. Existing legacy disruption rows remain readable without invented completion evidence. The new action store contains booking/passenger IDs rather than copied names or email addresses.

Local validation at this stage: TypeScript check passed; 14 financial/IROPS tests passed. Database restart/concurrency acceptance follows in the final acceptance script.

## 03 — Persisted fare offers

Direct bookings and NDC AirShopping now use `calculateFlightPrice` and persist a five-minute fare snapshot. Direct offers bind the passenger-type mix and owner; NDC retains its existing passenger-count fare policy with explicit fare-class/tax policy metadata. Booking creation locks and consumes the snapshot with the booking/outbox transaction, so retries cannot purchase it twice. The booking screen refreshes and displays the accepted fare; ancillaries are still priced by the invoice authority and purchased price locks remain separately enforced. Public loyalty/miles price composition is a what-if view, not a redemption authorization. Legacy NDC offers expire under their original policy; new offers carry the canonical snapshot identity.

Validation: TypeScript and 55 targeted offer, booking, payment-boundary and price-composition tests passed. Actual airline NDC certification is an external acceptance gate.

## 04 — Bound approvals and execution

Unknown agent actions (including unapproved outbound notifications) are denied; only explicitly read-only actions are automatic. `aiPricing.approveOptimization` records a human approval of the exact recommendation, tenant, previous price and factors. `applyOptimization` consumes that approval, refuses expiry, tampering, a changed current price and changes above 30%, and commits the new price, recommendation state and execution receipt together. Execution retries return the original receipt. Approval expires after 30 minutes and recommendations older than one day require review. Decision overrides annotate history; they do not reverse financial or inventory effects.

Validation: TypeScript and 14 governance tests passed, including tenant isolation, stale approval, payload changes and rollback if event persistence fails. Any additional mutating agent action needs its own bounded executor before it can be enabled.

## 05 — Flight-instance operational evidence

`aviationIntegrations.ingestOperations` accepts only signed, timestamped source events tied to an internal flight instance ID and matching tenant. Deployment config `AVIATION_SOURCE_REGISTRY` is a JSON array of `{sourceId, tenantId, capabilities, secretEnv, validUntil}`; the named environment secret must contain at least 32 characters. Use capability `operations`. Sign `HMAC-SHA256(secret, calculateRequestHash(envelope))` as lowercase hex. Transport timestamp tolerance is five minutes; a retry may refresh issuedAt, but reusing a source event ID with changed business content is rejected. No sample source or secret is enabled by default.

Normalized kinds: departure_estimate, departure_actual, arrival_actual, tobt, tsat. Payload is `{time: ISO-8601 UTC}`. Source evidence and its outbox event commit together. Arrival/departure actual timestamps cannot be in the future; a stale estimate becomes unknown after 15 minutes. A newer estimate never overwrites an actual departure. Source adapters must map AIDX/A-CDM fields and flight identity into this explicit envelope; this is not a claim of protocol certification.

The operations agent now reads source timestamps instead of invented hourly delays. Departure OTP uses unique observed flights with a 15-minute threshold. Missing observations, utilization and turnaround evidence remain unknown; completing a flight no longer means it was on time. Briefing text preserves the unknown state.

Validation: TypeScript and four signed-ingestion tests passed (including replay, changed payload, foreign tenant, unavailable capability, atomic rollback and stale-data behavior).
