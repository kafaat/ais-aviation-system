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
