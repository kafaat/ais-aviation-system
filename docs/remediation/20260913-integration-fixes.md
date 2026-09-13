# Integration remediation

Base: `c4638b1` (audit PR #147 merged). This work closes findings in the
[dated audit](../audits/20260912-integration-review.md); historical evidence remains unchanged.

## Patch 1 — CI and secret detection

- Gitleaks exceptions match complete synthetic secret values, never adjacent text.
- CI installs CLI 8.24.3 with its pinned archive checksum; no Node 20 compatibility override.
- The real scanner passes all eight policy controls. `check:scripts` covers every TypeScript script.

## Patch 2 — Passenger departure control

- Web, kiosk and seat-map check-in share one transaction and lock order.
- A confirmed paid reservation, a current itinerary segment, the 48h–1h check-in
  window, document clearance and a real seat in the booked cabin are required.
- Passenger/flight state lives in `seat_inventory`. `bookings.checkedIn` means
  **any** checked-in passenger/leg, protecting itinerary changes until all are offloaded.
  The old passenger seat field projects the primary leg only.
- Boarding tokens contain flight identity, document/itinerary fingerprints and a
  check-in nonce. Online verification rejects changed or revoked state. Signature
  validation alone is not boarding authorization and does not prove airport acceptance.
- Migration 0032 adds a nullable nonce. Historical checked-in seats require offload
  and re-check-in before issuing a new pass; no existing state is silently certified.
- Check-in displays real inventory and signed QR codes per leg. Booking creation
  persists optional physical seat selections with its invoice and passengers.
- Self-service only offers seats without an additional seat charge. Chargeable
  seat changes need a priced, settled ancillary entitlement before enabling them.

Validation: disposable MySQL/Redis regressions for R01/R02/R03/R04, secondary-leg
statistics, nonce revocation, cancellation, concurrent seat claims, check-in
windows and booking-seat persistence; six cryptographic unit tests passed.
No external provider or airport calls were made.

## Patch 3 — One inventory authority across channels

- Availability adjustments lock the flight, account for reserved itinerary legs,
  legacy allocations and all active holds, and record an event with the actor.
- Waitlist offers use expiring canonical holds. Decline/expiry release the hold;
  customer acceptance transfers it once to a pending booking. Only settlement
  decrements inventory. Both former waitlist writers use the same offer service.
- Group approval is a temporary allocation to an identified organizer, not proof
  of collection. The organizer enters every passenger and checks out against the
  approved invoice. A group cannot consume an existing customer's checkout hold.
- Scheduled cleanup releases group/waitlist allocations and physical seats from
  expired unpaid checkout holds. Failures remain visible to the scheduler.
- Migration 0033 adds nullable allocation links. Old offered waitlist rows and
  confirmed groups without links require an operator's inventory reconciliation;
  their inconsistent historical capacity writes cannot safely be inferred.

Validation: R06/R10/R11 plus repeated decline, expiration, hold reuse rejection,
waitlist-to-paid-booking handoff, group invoice settlement and physical-seat
expiration passed on disposable MySQL. The runner now covers ten scenarios.
