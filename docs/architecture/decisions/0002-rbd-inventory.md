# ADR 0002: Booking-class (RBD) inventory nested inside the cabin counters

- **Status:** Accepted by the change that adds `flight_fare_class_inventory`
  (proposed and accepted in the same series, as the first step of ADR 0001).
- **Date:** 3 November 2026, written against `89aa998`.
- **Deciders:** repository owner and the engineering reviewer of this record.
- **Relates to:** ADR 0001 (order as record of truth), market-gap proposal #10.

## Context

Inventory in AIS is two integers per flight: `flights.economyAvailable` and
`flights.businessAvailable`. Holds are rows in `inventory_locks` with an
expiry; a hold counts against the cabin while it is active, and the cabin
counter itself is decremented only when funds settle
(`booking-settlement.service.ts: reserveSeats`, under `SELECT ... FOR UPDATE`
on the flight row) and restored on cancellation or refund (`restoreSeats`).
Hold expiry needs no counter repair because held seats are derived, not
stored.

`fare_classes` already models IATA booking classes (RBD code, cabin, fare
family, priority "for nested availability", `basePriceMultiplier`,
`seatsAllocated`, baggage and penalty attributes) but only `fare-rules.service`
and `ndc.service` read it; `flights.search` and `bookings.create` sell the
cabin at `economyPrice`/`businessPrice`. The market-gap analysis names this
as the gap that keeps AIS on a single-segment PNR model while the Saudi market
moves to Orders: the data is designed, the sale path ignores it.

## Decision

Add a per-flight booking-class layer **nested inside** the cabin counters,
and consume it on the sale path in the same transactions that already move
the cabin counters. The cabin counters stay the physical authority; nothing
that works today stops working.

### Data

`flight_fare_class_inventory` (unique on `flightId, fareClassId`):

| Column            | Meaning                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `flightId`        | The flight                                                                                |
| `fareClassId`     | The airline's `fare_classes` row (RBD)                                                    |
| `cabinClass`      | `economy` or `business`; must equal the fare class's cabin                                |
| `authorizedSeats` | Authorization level (AU) of the class on this flight                                      |
| `sold`            | Seats sold in this class; moves with the cabin decrement in the same transaction          |
| `nested`          | `true`: serially nested with the cabin's other nested classes; `false`: a discrete bucket |

Held seats are **not stored**. A hold is an `inventory_locks` row; this change
adds a nullable `inventory_locks.fareClassId`, and the class's held count is
the sum of its active, unexpired locks, exactly as the cabin's held count is
today. A stored `held` counter would drift on every expiry sweep and crash;
the derived figure cannot. `bookings.fareClassId` and
`booking_segments.fareClassId` (nullable) record what was sold so settlement
and cancellation know which class to move.

### Nested availability model

Within a cabin, nested classes are ordered by `fare_classes.priority`
(highest on top; the full fare Y/J normally has AU equal to the cabin
capacity). With `consumed(c)` = `sold + held` of class `c`:

```
raw(c)       = AU(c) - sum(consumed(k) for every nested k at or below c)
available(c) = min(raw(k) for every nested k at or above c, including c)
available    = max(0, min(available, physical cabin seats))
```

So a sale in a lower class consumes every class nested above it (one Q sale
takes one seat from M and from Y as well), a lower class can never show more
seats than the class above it, and no class can show more than the cabin
physically has. A class with `nested = false` is a discrete allotment
(group or award bucket): `available = AU - sold - held`, capped by the cabin.
`computeNestedAvailability` in `rbd-inventory.service.ts` is the pure
function; `rbd-inventory.test.ts` pins the arithmetic.

### Coexistence with the cabin counters

- A booking **without** `fareClassId` is a cabin-level sale and behaves
  exactly as before. The RBD layer is never consulted.
- A booking **with** `fareClassId`:
  - `bookings.create` / `multiCity.create` validate the class (active, the
    flight's airline, the booked cabin), price the offer through the
    existing `calculateFlightPrice` → `createRetailOffer` path with the
    class multiplier applied to the base fare (taxes and fees stay as the
    pricing engine quoted; `composeOfferPolicy` is the only arithmetic), then
    inside the booking transaction, after the cabin hold is created or
    adopted, `holdBookingClass` locks the flight's RBD rows and the counted
    holds `FOR UPDATE`, checks nested availability excluding the booking's
    own hold, and writes `inventory_locks.fareClassId`.
  - On settlement, `reserveSeats(..., fareClassId)` decrements the cabin as
    before and then `sellBookingClass` increments `sold` behind the same
    flight row lock, with a guarded `UPDATE ... WHERE sold = <read value>`.
    A closed or oversold class raises `InventoryUnavailableError`, which the
    payment settlement already treats as a business rejection that rolls the
    whole leg back.
  - `restoreSeats(..., fareClassId)` returns the class with the cabin on
    cancellation and refund (`greatest(0, sold - n)`, never negative).
  - Hold expiry (`releaseExpiredLocks`) needs no RBD code: an expired lock
    stops counting.
- The physical cabin counter is the cap in every view, so paths that still
  move only cabin seats (exchange in `order-servicing`, IROPS recovery,
  rebooking in `payment-settlement`, group and waitlist allocations) cannot
  make the RBD view oversell; they can leave `sold` on the original flight
  stale when a booking that carried a class is moved. That is listed below
  as remaining work, not hidden.

### Search and detail

`flights.search` and `flights.getById` gain an additive `bookingClasses`
array per flight (code, name, cabin, fare family, priority, multiplier,
indicative base fare, available, authorized, sold, held, nested, rules
summary). Sold-out and inactive classes are filtered out. The Redis overlay
(`getFlightLiveState` → `overlayLiveState`) now carries `bookingClasses`
alongside the cabin counters, so a cached row never shows a class that has
since sold out; rows cached before the field existed are served with an
empty list.

### Backfill

`scripts/db/backfill-rbd-inventory.ts` (idempotent, `--dry-run`): for each
airline it picks one default class per cabin (the active highest-priority
class of that cabin, or a new `Y`/`J` "Standard" class with multiplier
1.000), then inserts one nested row per flight cabin with
`authorizedSeats = cabin capacity` and `sold = capacity - available`, so the
class view equals the cabin view on day one. Cabins that already have an
operator-set class are left alone. The migration itself only adds the table
and the three nullable columns; existing flights work without the backfill
because cabin-level sales never consult the layer.

## Consequences

- Positive: booking classes are sold, held and released transactionally on
  the same sale path and under the same locks as the cabin; search can show
  fare families with real availability; the offer payload records the class
  it was priced for and a booking cannot adopt an offer priced for another
  class.
- Negative: two figures per cabin to keep consistent (`sold` and the
  counter). Both move in one transaction on the paths this change covers;
  the exchange/IROPS paths need the same two-line hook before an exchanged
  booking's class can be trusted.
- Open: per-class AU management is operator data with no UI yet; the
  backfill gives one class per cabin and `fare-rules.service` keeps its
  `seatsAllocated` view, which this layer supersedes for sold flights.

## References

- `server/services/rbd-inventory.service.ts`, `booking-settlement.service.ts`,
  `bookings.service.ts`, `multi-city.service.ts`, `retail-offer.service.ts`,
  `server/db.ts`, `server/contracts/flights.ts`.
- Tests: `server/__tests__/rbd-inventory.test.ts` (fixture) and
  `server/__tests__/integration/rbd-inventory-concurrency.test.ts`
  (MySQL-compatible server, two racing transactions).
- Market-gap analysis, proposal #10:
  `docs/research/2026-11-market-gap-analysis/README.md`.
