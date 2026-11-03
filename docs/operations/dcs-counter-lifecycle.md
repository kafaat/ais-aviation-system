# Departure counter lifecycle and physical baggage registration

This delivery implements the first operational slice from the VIDECOM DCS comparison
against AIS main `26fd19b75112eb70d0d6950391c61500c71d6054`. It provides a tenant-scoped
staff desk and closes the physical baggage registration boundary. The historical
training manual is a workflow reference; it is not a current certification standard.

## Operator workflow

Open **Departure desk / مكتب المغادرة** at `/airline/dcs`. The menu and page allow
`ops`, `airline_admin`, `admin` and `super_admin`. Server procedures independently
check roles and the flight/booking tenant. Baggage registration additionally requires
an actual airline tenant on the authenticated actor, including administrators.

1. Select a company flight, then find a passenger by name, PNR, booking reference or
   seat. The desk lists active paid reservations for that exact flight and exposes
   a read failure instead of permitting writes from a failed refresh.
2. Check in the selected passenger with an optional seat request and a reason.
   Automatic allocation uses actual available inventory in the booked cabin.
   Existing payment, document clearance, seat and time rules still apply.
3. Review the passenger's exact segment baggage allowance and the cumulative weight
   already registered. Record the weight of each received bag. Successful registration
   returns a numeric tag and preserves a staff-attributed counter receipt.
4. Close check-in when required, or reopen it with a reason. This gate controls new
   check-in and bag acceptance. Checked-in passengers can continue boarding while
   check-in is closed; this action does not release the flight for dispatch.
5. Record boarding from the selected passenger record, optionally supplying the
   current signed QR/JWT or BCBP scan. A supplied scan must match that passenger and
   flight and pass the current seat/nonce/document checks in the same transaction.
6. Deplane a boarded passenger before any offload or permission change. Deny/allow
   changes boarding permission independently of attendance. Offload cannot erase a
   denial or make a passenger eligible to check in again without an allow decision.

Flight, page and passenger selection stay fixed while a scoped desk command or data
refresh is pending, including a refresh paused by loss of connectivity. A failed
flight-list read preserves the selected desk. Selection becomes available after
these operations settle; retry-key retention is scoped to the current mounted form.

### Attendance recovery after a schedule cutoff or cancellation

The scheduled departure time does not prove that a currently boarded passenger
cannot return to the gate. `DEPLANE` and `OFFLOAD` therefore use a separate recovery
policy on `scheduled`, `delayed` and `cancelled` flights, including after the recorded
departure time. The desk enables only the actions appropriate to the passenger's
current attendance. A change in flight status does not silently change a pending
boarding instruction into an offload instruction.

Recovery still requires the authorized active tenant, a confirmed paid reservation
with reserved inventory, an unambiguous active segment and a current checked-in
seat/nonce. Deplane must precede offload for a boarded passenger. A physical bag
without verified withdrawal still blocks offload. Denial, coupon changes, command
receipts and actor/reason history retain their existing authority.

Completed flights, cancelled/ambiguous segments and refunded or otherwise invalid
reservations require reconciliation rather than this correction path. A financial
refund is not reversed or hidden to permit recovery. `BOARD`, `DENY`, `ALLOW`, new
check-in and new baggage acceptance retain their original admission/time rules.

Both free-seat selection and seat changes honor a boarding denial until an
authorized `ALLOW` decision. Seat release can free an eligible seat but cannot clear
the denial or permit a fresh check-in or boarding.

The departure history records actor, role, reason and before/after state. The desk
shows the latest 200 events and explicitly labels truncation; older events remain
stored. Oversized or ambiguous manifests fail for review instead of silently dropping
passengers. Operational transitions do not issue refunds or commercial upgrades.

## Baggage authority

`baggage.register` requires `bookingId`, `passengerId`, `flightId`, `segmentId`,
`weight` in kilograms and an `idempotencyKey` (8–128 characters). Description and
handling instructions are optional. Passenger ownership alone no longer authorizes
a physical receipt.

The service locks the authorized booking and its itinerary before validating the
passenger and checked-in seat. It requires an active tenant, confirmed paid reserved
booking, confirmed exact sector, open check-in, a current nonce and a passenger who
has not boarded or been denied boarding. Weight has at most two decimal places,
each piece is at most 32 kg, and the **sum** of registered pieces cannot exceed
`computeBaggageEntitlement` for that passenger/segment. Existing financial authority
decides which purchased allowances are funded; the counter has no payment override.

The command receipt, canonical baggage item and actor-attributed tracking record
commit together. Repeating the same key and payload returns the original result;
changing a payload under that key conflicts. Before sending, the UI saves the exact
command and key in the current browser tab, scoped to the authenticated employee,
tenant, booking, passenger, flight and segment. It restores an unacknowledged
command after navigation, reload or reauthentication and offers **Recover bag
receipt** while fresh registration stays locked. A new acknowledged bag gets a
new key.

Saved commands include `expectedActorId` and `expectedTenantId`. The server checks
these against the authenticated context before replay or a new write, so a changed
shared login cannot turn recovery into another employee's registration. Existing
non-UI callers may omit both bindings. A late rejection cannot clear a newer retry.
Corrupt or inaccessible recovery storage blocks new registration for review. This
recovery lasts for the same browser tab; closing the tab or clearing its storage
removes the local command. It does not expire automatically or replace the durable
server receipt and physical baggage record.

`baggage_items.flightId` and `segmentId` preserve explicit operational scope.
Manifest, closeout and signed custody ingestion/readers honor that scope. A bag
registered for one segment cannot automatically appear on every onward segment.
Historical rows remain nullable. Unambiguous single-sector history counts
conservatively; ambiguous multi-sector or malformed history requires review and
does not create extra allowance.

Both new OFFLOAD and legacy undo-check-in reject an unresolved current-sector
physical registration even before a signed device event arrives. Ambiguous legacy
records also block. Changing a bag's mutable label to `claimed` or `lost` is not
proof of return. Valid other-passenger/other-sector bags do not block the selected
passenger unless current-flight custody evidence establishes a conflict.

An externally confirmed late refund remains a financial fact. If its reservation
cleanup leaves a recorded boarded passenger without an eligible paid reservation
or a current checked-in seat, the desk refuses the normal view and requests
departure reconciliation. A current-flight physical bag excluded by reservation
cleanup similarly prevents a clean manifest or baggage closeout. These read guards
preserve evidence; they do not invent deplaning, baggage retrieval or payment reversal.
The manifest also refuses a recorded boarded passenger omitted by reservation
filtering, including a passenger who has no registered baggage.

Counter registration and signed custody are separate records. This delivery does
not synthesize airport/device signatures, loading scans, baggage return, rerouting,
printer output, belt movement or dispatch release.

## Passenger documents and APIS

The customer check-in page now mounts the APIS form for an actual passenger and
selected flight. Saved details prefill the form, saving refreshes the status, and
the journey panel reads the current document clearance authority.

Document completeness and clearance are separate. The staff APIS page displays and
downloads the exact generated message as an **untransmitted draft**. Its submit
control depends on an explicit capability read; unavailable or failed capability
reads keep transmission disabled. Authority transport, acknowledgements and
rejection handling still require a real integration.

## Special-service sector scope and priority

New passenger special-service requests select a flight sector and preserve that
original flight and, when present, its stored booking segment. A request on one
sector does not apply automatically to the onward sector. Exchanging a segment
does not reassign its existing request to the replacement flight.

Historical requests remain unscoped until their sector is verified. A `pending`
or `confirmed` wheelchair, medical-assistance or unaccompanied-minor request with
no recorded flight causes priority scoring, ranking and rebooking advice to fail
with `PRECONDITION_FAILED` and an explicit reconciliation message. These readers
neither guess the sector nor return a complete ranking with the assistance omitted.
Cancelled or rejected requests do not block, and explicitly scoped other-flight
requests stay on their own sector. An explicitly recorded flight on a supported
legacy booking without a stored booking segment remains valid.

Request storage and priority handling do not establish partner acknowledgement or
delivery of the requested service. SSR/APFAX meal reports remain unimplemented.

## Rollout and compatibility

- Apply committed migrations `0061_dcs_counter_lifecycle.sql`,
  `0062_special_service_sector.sql`, then
  `0063_baggage_flight_reconciliation.sql`, in journal order before deploying the
  updated application. Migration 0061 adds the two nullable baggage fields, their lookup
  index, and flight state, passenger state and audit event tables. Migration 0062
  adds nullable original flight and booking-segment identifiers to special-service
  requests. Migration 0063 indexes baggage reconciliation reads by flight and bag
  ID. These migrations do not invent historical scope or operational events.
- Review active historical assistance requests before using priority rankings or
  reaccommodation advice. Reconcile their original sector from verified request
  evidence; a deployment must not populate every request with the primary flight
  or mark it inactive simply to suppress a reconciliation error.
- Unconfigured flights keep the existing check-in window: 48 hours until one hour
  before departure. Explicit opening does not extend that window.
- Legacy bookings without a stored segment can use the existing supported check-in
  path, but the staff baggage form remains unavailable until an exact sector is
  established. More than one active segment matching a flight is an error.
- Provision actual tenant-scoped operations accounts. This application has no
  verified staff-to-airport grant model; the implementation does not claim station
  authorization beyond its tenant and recorded flight origin.
- Set `BAGGAGE_AIRLINE_NUMERIC_CODE` to the carrier's configured three-digit numeric
  code. The synthetic `123` value exists only in disposable tests. Carrier allocation,
  station acceptance and hardware validation remain operator deployment work.
- PR #246's passenger/segment ancillary purchase and funding work was merged in
  main `128e67c640ebb1e57f9e944471b89b1bb4711660` during this delivery. This branch
  incorporates that main revision and consumes its canonical entitlement reader
  without replacing or duplicating the purchasing implementation. PR #248 was also
  merged into main at `ad4ca56772a75b2d10104090071db908bb1fd5f5` and reconciled here,
  preserving its ticket allowance, coupon, initial-seat and VRS workflow changes.
- Rollback should preserve the new receipt and history tables. Do not drop evidence
  or null out baggage scope to work around an operational refusal.

## Verification

Focused service regressions cover unsafe booking states, owner/foreign-tenant
requests, cumulative weights, exact sector identity, changed-payload replay,
transaction rollback, boarding/denial transitions, scan identity and unresolved
physical baggage. SQL-predicate tests cover multi-sector manifest/closeout behavior.
Priority regressions cover active unscoped assistance, propagation through ranking
and advisory readers, and inactive or explicitly scoped requests.

React tests exercise role gating, selected passenger/sector binding, unavailable
reads, denied/offloaded state, retry keys, baggage allowance and APIS form/preview
reachability. Authenticated browser journeys use isolated operations tenants and
real booking/payment commands. They lose a **committed** bag response, then recover
the exact original payload and key, including after a same-tab reload. The recovery
checks confirm one physical bag and one tracking row.

The required Production Gates run the additional departure counter acceptance
against actual MySQL 8.0 and 9.7 and Redis, including competing registration,
offload and check-in commands. Recovery acceptance also verifies correction after
the cutoff/cancellation, exact-key replay, tenant/baggage/completed-flight refusal,
and the same denial policy through both seat-allocation paths. The authenticated
browser journeys perform check-in, boarding, deplane and offload through the real
desk/API after changing only the disposable fixture's flight clock/status; these
are not provider cancellation or aircraft movement tests.
The migration gates replay both fresh and previous
release databases. Unit tests, schema generation and local TypeScript/build checks
are not substitutes for those CI results or for airport operational acceptance.
The same gates exercise active unscoped assistance, inactive historical requests
and explicit sector scoring through the real priority readers.

## Remaining comparison work

This slice does not implement GoShow/NoRec creation, cabin downgrade desk flows,
bulk/date-range seat blocking, aircraft seat remapping, bag correction or verified
retrieval/transfer/reroute, SSR/APFAX meal reports, or production APIS/device/dispatch
adapters. These remain separate workflows requiring their own authority and evidence.
