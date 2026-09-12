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

## 06 — Temporal forecast evaluation

Demand now means booked departing passengers per flight instance, cabin, airline and tenant. It includes itinerary-segment membership and excludes unconfirmed bookings and future departures from training. The model compares weekday and trailing means using rolling origins, selects on an earlier window, and reports error/coverage on a separate final 14-observation window. At least 42 historical flights are required; sparse or unavailable data raises an explicit error. Fixed holiday boosts and the unmeasured 95% confidence claim are removed. Published diagnostics include the training cutoff, target, sample sizes, baseline error, nominal coverage and measured validation coverage.

`forecastDemand` now returns one target-departure observation instead of repeating a route total for each day. `reconcileForecastOutcomes` records completed-flight outcomes for this model version; `forecastAccuracy` scores one earliest pre-departure prediction per flight/cabin/target. Missing accuracy and undefined percentage denominators are null. Prediction persistence is required, not best effort.

AI multipliers are shadow suggestions; the effective AI multiplier is one. Human-approved base-price changes use the patch-04 executor. The historical outcome is booked demand, not unconstrained latent demand; sell-out censoring and production challenger acceptance still require operator data.

Validation: TypeScript and 25 forecast tests passed, including future-data exclusion, chronological comparison, zero actuals and sparse-data rejection.

## 07 — Paid order servicing

The existing modification screen now requests and reviews an actual fare quote, then explicitly confirms it. Date changes and cabin upgrades delegate to the same paid-servicing authority as `ndc.quotePaidService`. It exchanges a complete local itinerary (up to six connected segments in one cabin), or adds catalog entitlements, using server-priced snapshots, owned passengers, existing invoice/seat owners, preserved modification fees, durable idempotency and an execution event. Itinerary exchange requires reconciled ancillary fulfillment and preserves journey endpoints; the single-flight UI refuses to truncate a multi-leg journey.

Positive differences use a persisted Stripe checkout request and stable provider idempotency key. Checkout extends validated owned holds to the saved provider expiry. Only verified collection applies the change; a late or stale collection is retained for settlement review without moving seats. No-charge confirmation moves all affected capacity and invoice allocations atomically. Lower fares create refund transport intents allocated to original Stripe/split payer receipts. The periodic `orderServiceRefunds` job reconciles provider results and posts through `settleVerifiedRefund`; an expired idempotency window without a known outcome is quarantined. A queued refund is not reported as paid. Wallet/external-funded reductions require their refund authority and cannot be silently redirected to another payer.

Owned quotes can be cancelled; active provider checkout must first be confirmed expired. New paid catalog services create entitlements. Ticket reissue/EMD and physical service fulfillment remain separate provider acceptance states (`awaiting_ticket_reissue` / `entitlement_created`). This series does not invent an airline ticketing acceptance receipt. Existing NDC unpaid exchange also consumes its linked canonical fare snapshot.

Validation: TypeScript and 114 payment/servicing/refund tests passed, covering all-leg exchange, checkout replay, late collection review, no premature refund ledger entry, proportional original-payer allocation, preserved change fees and the existing modification UI's command retry.

## 08 — Baggage custody across journey legs

Signed `baggage_custody` events require capability `baggage` plus explicit `deviceIds` and `airportIds` in the source registry. Each payload binds tag, stage, airport, device and previousEvidenceId. Acceptance/loading/arrival and onward transfer must follow the actual booking segments and predecessor timestamp. Replaying a scan is harmless; unrelated flights, airports, devices and missing predecessors are rejected. Source evidence, custody chain and the existing tracking projection commit together.

`baggage.custody` is owner/scoped-admin only. The tracker shows verified versus required journey points separately from ordinary status history. Missing scans stay incomplete; an accepted bag blocks itinerary exchange until its physical rerouting is reconciled. The local workflow follows handover evidence concepts; it does not assert Resolution 753 certification or activate a bag-drop device without partner acceptance.

Validation: TypeScript and 14 custody/source/paid-servicing tests passed, including a six-point connecting journey, replay, failed projection rollback and access control. Hardware scanning and interline agreements remain external acceptance gates.

## 09 — Operator duty rules and executable disruption recovery

- `aviationIntegrations.acceptCrewRules` accepts a signed, scoped operator profile with a human acceptance receipt. Both crew assignment writers enforce the same rule authority under a crew lock: report/release bounds, rolling duty, rest, local report-time/segment FDP bands, licenses, medical expiry and aircraft qualifications. Historic assignments without duty evidence cannot assert compliance. The profile is a configured rule subset, not a declaration of regulatory certification; dispatch approval and any additional operator rules remain required.
- `irops.proposeRecovery` accepts an event, up to 20 booking groups and up to eight candidate flights. The server derives capacity minus active holds, itinerary connections and passenger counts. A bounded solver minimizes unserved passengers before passenger delay; an exhausted search reports unknown optimality gap. `approveRecovery` binds human acceptance to the exact digest, and `executeRecovery` revalidates the snapshot, available inventory and ten-minute expiry.
- Execution uses the existing seat reservation/restoration authority in one transaction, preserves the involuntary exchange invoice, updates segments and NDC order state, and confirms passenger protection only after a booking move. Local notifications have actual insertion receipts. Pending vouchers/hotels/compensation and unassigned passengers remain pending. Ticket reissue remains an external fulfillment task. Accepted baggage or ancillaries require verified rerouting before exchange.
- Connections now follow segments of the same booking. The static weekday-based disruption probability has been removed. Aircraft tail rotation and maintenance release checks are added in patch 10, sharing the integration evidence boundary.
- Validation: bounded-capacity/search-budget and duty/rest/FDP unit cases; TypeScript check. End-to-end SQL recovery is covered by the final acceptance harness.
