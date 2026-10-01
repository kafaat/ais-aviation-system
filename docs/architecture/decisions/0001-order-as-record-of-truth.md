# ADR 0001: Moving the commercial record of truth from the booking to the order

- **Status:** Proposed. Nothing in this document is implemented; it exists so the
  transition can be reviewed before any code moves ownership.
- **Date:** 1 October 2026, written against `a99e64d4`.
- **Deciders:** repository owner and the engineering reviewer of this record.
  Domain ownership for the five commercial domains is still unassigned in
  `docs/architecture/service-catalog.json`; this ADR does not invent owners.

## Context

AIS is a hybrid. The commercial core is a booking: `bookings` carries a
six-character `pnr`, `passengers` carry 13-digit ticket numbers, and the
money lives in `payments`, `payment_receipts` and `financial_ledger`. Above it
sits an IATA ONE Order-shaped layer: `retail_offers` (channel, payload,
SHA-256 content digest, expiry, `consumedBookingId`), `ndc_offers`,
`ndc_orders` with a pending → confirmed → ticketed → changed → cancelled →
refunded lifecycle (`server/services/ndc-order-state.ts`), and
`order_service_refunds`. `createOrder` in `ndc.service.ts` creates the booking
and passengers first and then the order that points at `bookingId`. The order
is therefore a view over the booking, not its source.

IATA's definition of Offers and Orders covers the whole cycle: offer, order,
payment, servicing, delivery and accounting, with one order record replacing
PNR, ticket and EMD. Saudia's path with Amadeus Nevio, announced in July 2025,
was "smart bridging": PNRs and tickets translated into orders while the
existing platform kept running. That is the only precedent this repository
has evidence for, and it argues for a staged move, not a cut-over.

Two facts constrain the design:

- `financial_ledger` is the authority for money and must stay so. Every
  settlement, refund and internal funding path appends to it inside the same
  transaction as the inventory change (`booking-settlement.service.ts`).
- External fulfilment (ticket reissue, EMD) is gated by a contracted provider
  (`ndcExternalFulfillment` is `blocked` in the capability catalog). That gate
  is about compatibility with the legacy world; it is not what makes an order
  an order.

## Decision

Build an order model that owns the **commercial commitment**, and move
ownership of facts from the booking to it in phases, each with a
reconciliation that must be empty before the next phase starts. The booking
remains readable throughout and becomes a derived projection at the end.

### What the order owns, and what it does not

| Fact                                                                                             | Owner after the transition    | Notes                                                                                                          |
| ------------------------------------------------------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Order items (flight segments, ancillaries, services) with their price at commitment              | Order                         | Today split across `booking_segments`, `booking_ancillaries` and the offer payload                             |
| Service delivery state per item (not delivered, delivered, forfeited, refunded)                  | Order                         | Does not exist today as a first-class fact; check-in and bag-drop record events but no per-item delivery state |
| Order versions: every change, exchange and cancellation as a new version with a reason and actor | Order                         | Today `booking_modifications` and `booking_status_history` approximate this                                    |
| Payment status of the order and its link to receipts                                             | Order references the ledger   | Money itself stays in `financial_ledger`, `payments`, `payment_receipts`                                       |
| Inventory holds and seat allocation                                                              | Inventory services            | Unchanged; the order references them                                                                           |
| Passenger identity and documents                                                                 | Passenger record              | Unchanged; the order references passengers                                                                     |
| Accounting documents (ticket numbers, EMD numbers)                                               | Order, as attributes of items | Issued only when a provider is accepted; their absence does not make the order invalid                         |

### Phases

1. **Shadow order.** Every booking creation and change also writes an order
   version in a new set of tables. No reader uses it. A nightly reconciliation
   compares order items against booking segments, ancillaries, receipts and
   ledger entries and reports every difference. Exit criterion: zero
   unexplained differences across one full month of production-shaped
   acceptance data, and the reconciliation itself covered by the live
   acceptance suite.
2. **Order-first reads.** Customer-facing and operator-facing reads of the
   commercial state (what was bought, for how much, what was delivered) come
   from the order; the booking remains the write path. Exit criterion: no
   screen or export reads commercial facts from `bookings` directly, verified
   by the service catalog's table-expression inventory.
3. **Order-first writes for new orders.** New commercial commitments are
   created as orders first; the booking row, `pnr` and ticket numbers are
   derived from the order in the same transaction, because the legacy
   fulfilment world still needs them. Changes and refunds go through the order
   state machine. Exit criterion: the booking row has no field that is not
   derivable from the order plus inventory plus passenger records.
4. **Legacy bridge.** Historical bookings without an order are translated into
   orders by a one-way, idempotent job, item by item, with each translation
   reconciled against the ledger. Bookings that cannot be translated are
   listed, not forced.

Each phase is a separate pull request series with its own acceptance checks
in `scripts/verify-transaction-boundaries.ts`.

### Reconciliation and rollback

- The reconciliation job is the gate between phases and keeps running after
  them. It never corrects data; it reports.
- Rollback for phases 1 and 2 is removing readers; the shadow tables stay and
  keep being written. Rollback for phase 3 is re-enabling booking-first writes
  behind the same flag; both paths must exist until phase 4 completes.
- A difference between order and ledger is resolved in favour of the ledger,
  always, and raises a review in the existing settlement review mechanism.

### Non-goals

- No new payment provider, GDS, APIS or ticketing connector is part of this
  decision. They are separate acceptances listed in
  `docs/operations/provider-acceptance.md`.
- No change to how money is recorded. The ledger stays the authority.
- No retirement of `pnr` or ticket numbers while any external party needs
  them.

## Consequences

- Positive: one commercial record per purchase, per-item delivery state, and
  a path to the retailing standards the comparable products (Hitit Oxygen,
  Navitaire Stratos, Amadeus Nevio) are built around, without a rewrite.
- Negative: dual writes during phases 1 to 3 cost latency and storage, and the
  reconciliation job is a new operational duty that needs an owner before
  phase 1 starts.
- Open questions to settle in review before phase 1: whether the order is
  tenant-scoped at the row level like bookings (yes is the assumption), how
  corporate and group bookings map to orders (one order per traveller or per
  group), and which actor identity signs order versions created by jobs.

## References

- IATA, Offers and Orders / ONE Order:
  https://www.iata.org/en/programs/airline-distribution/retailing/one-order/
- Amadeus, Saudia moves to Orders with Amadeus Nevio (16 July 2025):
  https://amadeus.com/en/newsroom/press-releases/saudia-orders-nevio-accelerate-guest-centric-travel
- Repository: `server/services/ndc.service.ts`, `ndc-order-state.ts`,
  `retail-offer.service.ts`, `booking-settlement.service.ts`,
  `capability-catalog.service.ts`, `docs/operations/provider-acceptance.md`.
