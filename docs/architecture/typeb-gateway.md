# Type B messaging gateway

Status: formats, queue, station file and triggers implemented in the
repository; no SITA/ARINC connectivity and no handler sample exchange have
been recorded. Written 3 November 2026 against proposal #12 of
`docs/research/2026-11-market-gap-analysis/README.md`.

## Why

A departure-control system that cannot speak Type B cannot work at an
outstation with a third-party handler: the handler's DCS expects a PNL/ADL
from reservations, the OCC and the arrival station expect MVT and LDM, and
the baggage sortation system expects BSM/BPM for every accepted bag (IATA
Type B messaging whitepaper v2.5; RP 1745; AHM 583/780; research notes
`standards_regulation.md`, `operations_systems.md`). The gap analysis found no
Type B code at all in AIS (`README.md`, section "نصف DCS بلا Type B"). The
market is moving baggage messaging to BIX (RP 1755, Baggage Community System
launched May 2026) with a ten-year co-existence window, so a new gateway must
emit Type B now and keep its payload model mappable to BIX.

## Shape

```
producers (DCS, bookings, custody scans, admin)         handler / OCC / sortation
        │  TypeBPayload (model.ts)                               ▲
        ▼                                                        │
  builders.service.ts ──► gateway.service.ts ──► typeb_messages ──► TypeBTransport
  (reads flights,          (station file,         (queued → sent    (memory, filedrop,
   bookings, SSR,           envelope, lease,       → acked|failed)   future SITA/ARINC)
   custody, rotation)       dedup)                       ▲
                                                         │ raw + parsed (received|failed)
  triggers.service.ts ◄── event_inbox / event_deliveries │
  (PNL timer, ADL/MVT/BSM from archived events)          └── ingestInboundTypeB (admin / token)
```

All code lives in `server/services/typeb/`, the router in
`server/routers/typeb.ts` (`typeb.*`), the admin page at `/admin/typeb`.

### Payload model and serialisers

`model.ts` defines one typed payload per message (`PnlPayload`,
`AdlPayload`, `LdmPayload`, `MvtPayload`, `BsmPayload`, `BpmPayload`).
`serializer.ts` exposes two `MessageSerializer`s over the same payloads:

- `typeBSerializer` → teletype text lines (today's wire format).
- `bixSerializer` → a JSON document following the AIDM vocabulary used in the
  public BIX guidance (bag, passenger, segments, status). It is labelled
  `conformance: "mapping_target_not_certified"` because the RP 1755 schema
  itself was not available; when it is, only `toBixDocument` changes.

### Formats implemented

| Type | Direction | Lines produced / parsed                                                                                                                                                                                                                         | Verified against                                           |
| ---- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| PNL  | out       | `PNL`, `FLT/DDMMM BRD PARTn`, `CFG/`, `RBD/`, `-DSTnnnC`, name elements `nSURNAME/GIVENTITLE .L/PNR`, ` .R/SSR HKn text`, ` .R/INFT`, ` .R/TKNE`, ` .R/SEAT`, ` .OSI/`, `ENDPARTn`/`ENDPNL`; parts kept under 3,840 characters, name lines ≤ 64 | public vendor notes (AeroCRS "PNL/ADL setup", Videcom)     |
| ADL  | out       | as PNL with `ADD`/`CHG`/`DEL` sections under each destination/class header, `ENDADL`                                                                                                                                                            | same                                                       |
| LDM  | out + in  | `FLT/DD.REG.C14Y165.cockpit/cabin`, `-DST.A/C/I.Tnnnn.n/wwww.PAX/c/y.PAD/c/y`, `SI` + remarks (total load, underload, ZFW/TOW/LAW, BAG/CARGO/MAIL)                                                                                              | AHM 583 public examples (Evionica knowledge base)          |
| MVT  | out + in  | `FLT/DD.REG.STN`, `ADhhmm/hhmm EAhhmm DST`, `AAhhmm/hhmm`, `EDhhmm`, `NIhhmm`, `DLcc/cc/hhmm/hhmm`, `PXn[/n]`, `SI`                                                                                                                             | AHM 780 as documented by KIU and the mvt-parser field list |
| BSM  | out + in  | `BSM`, optional `CHG`/`DEL`, `.V/1LSTN`, `.F/XY0123/DDMMM/DST/C`, `.N/<10 digits><3-digit count>`, `.S/`, `.P/`, `.L/`, `.W/K/pieces/kg`, `.O/`, `.I/`, `ENDBSM`                                                                                | RP 1745 as shown in SITA BagMessage material               |
| BPM  | out + in  | `BPM`, `.V/`, `.J/ind/hhmm/location[/device]`, `.F/`, `.N/`, `ENDBPM`                                                                                                                                                                           | same                                                       |

Envelope (`envelope.ts`): `QU`/`QD` priority line(s) with up to 32
seven-character addresses (eight per line), `.ORIGIN DDHHMM` origin line,
optional identity line, text, blank line and a signature trailer. Text is
restricted to the Type B character set (`A–Z 0–9 space - ? : ( ) . , ' = / +`),
lines to 69 characters and messages to 3,840 characters. All times are UTC.

Test vectors: `server/services/typeb/formats.test.ts` (19 cases) and
`gateway.test.ts`.

### Assumptions that need the handler exchange

These follow the widely documented form; the licensed IATA texts (PSCRM
RP 1708, AHM, RP 1745) were not available to confirm them. Each is a one-line
change once the counterpart's samples arrive.

1. OSI in PNL/ADL is carried as `.OSI/`; some handlers expect `.RN/`.
2. The ADL destination header count is the number of `ADD` names unless the
   caller supplies booked totals (`AdlPayload.totals`).
3. `CFG/` renders each class as three-digit seats plus class letter.
4. The trailer repeats the origin signature on two lines ("double
   signature"); both the signature and the doubling are switchable.
5. Priority codes other than `QU`/`QD` (`SS`, `QX`, ...) are refused.
6. An MVT with only one known time transmits that time alone and says so in
   `SI` (`OFF BLOCKS TIME ONLY`, `ON BLOCKS TIME ONLY`).
7. `.S/` field order (status, seat, class, sequence) and the `.J/` indicator
   vocabulary (`S` scanned, `L` loaded, `U` unloaded, `R` reconciled).
8. Total load and underload travel in the LDM `SI` section.

### Station file

`typeb_addresses`: one row per Type B address with `stationCode` (NULL = all
stations, for an OCC), handler name, subscribed message types and an enabled
flag, unique per tenant. Routing rule (`stationsFor`): PNL/ADL → departure
station; LDM → arrival station; MVT, BSM, BPM → both. An address with no
subscribers means the message is not generated (triggers) or the admin gets a
`BAD_REQUEST` naming the missing subscription (manual generation). The
seven-character origin address of this system comes from
`TYPEB_ORIGIN_ADDRESS`.

### Queue

`typeb_messages` stores every part of every message (a long PNL is several
rows). Outbound rows are `queued`, claimed with `FOR UPDATE SKIP LOCKED` plus
a lease token (orphaned leases reclaimable after five minutes), delivered,
then `sent` with the transport reference; failures increment `attempts` and
go back to `queued` until the fifth failure marks them `failed`. `acked`
is set by `typeb.acknowledgeMessage` from a provider acknowledgement or a
handler's confirmation; the two shipped transports never acknowledge.
`dedupKey` makes trigger-generated messages (`PNL:<flightId>`,
`ADL:<flightId>:<eventId>`, `MVT:<flightId>:<eventId>`,
`BSM:<bagId>:<eventId>`) and inbound messages (`IN:<sha256>`) idempotent.

The drain runs from the `typebGateway` entry in `PERIODIC_JOB_CATALOG`
(`cron.service.ts`, every minute on the worker) and on demand from
`typeb.runTick`.

### Transport contract

```ts
interface TypeBTransport {
  id: string; // recorded on each message
  mode: "sandbox" | "live";
  acknowledges: boolean; // can the provider confirm delivery?
  send(m: OutboundTypeBMessage): Promise<{ transportReference: string }>;
  receive?(): Promise<InboundTypeBMessage[]>; // optional polling
}
```

Shipped: `InMemoryTransport` and `FileDropTransport` (`<dir>/outbound/*.txt`
with CRLF, `<dir>/inbound/*.txt` moved to `inbound/processed/`).
`TYPEB_TRANSPORT=live` is refused: a SITA/ARINC adapter must (a) implement the
interface in `server/integrations/`, (b) be idempotent on the message id
(`send` may be retried after a lost response), (c) map provider
acknowledgements to `acknowledgeTypeBMessage`, (d) deliver inbound text to
`ingestInboundTypeB` by polling or by calling `typeb.ingestInbound` with
`TYPEB_INGEST_TOKEN`, and (e) require a recorded acceptance reference before
`live`, following the `ONCALL_*` / `HOTELBEDS_*` pattern. No credentials are
read anywhere in this module.

### Inbound

`ingestInboundTypeB` normalises line endings, parses the envelope, dispatches
to the MVT, LDM or BSM/BPM parser, matches the AIS flight by designator and
UTC date, and stores raw text plus the parsed record (`received`) or the
parse error (`failed`). Repeats of the same text are returned as duplicates.
PNL/ADL received from a partner are archived unparsed.

### Triggers

`triggers.service.ts` never edits another workstream's producer. It reads the
`event_inbox` archive that the outbox relay already writes and takes one
`event_deliveries` receipt per event under the consumer `typeb-gateway`
through `deliverExternalEffect`, so each event fires at most once and failed
attempts are retried up to five times within a three-day window.

| Source                                                              | Message                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| departure within `TYPEB_PNL_LEAD_MINUTES` (default 180), no PNL yet | PNL                                                                       |
| `booking.confirmed` / `booking.cancelled` after the PNL exists      | ADL ADD / DEL                                                             |
| `aviation.departure_actual` / `aviation.arrival_actual`             | MVT AD / AA (needs an assigned registration)                              |
| `aviation.baggage_custody` with stage `acceptance`                  | BSM (tag must be a 10-digit licence plate; others are skipped and logged) |

## Verified / not verified

Verified by tests in this repository: line and field rules above, part
splitting, envelope round trip, parser rejection of malformed times and
elements, routing, delivery partitioning, file-drop round trip,
configuration refusal of `live`.

Not verified and outside the repository: acceptance of any message by a
real handler or switch, SITA/ARINC addressing registration, message
identity conventions of the counterpart, acknowledgement semantics,
BIX/RP 1755 schema conformance. `capability-catalog.service.ts` records
`typeBMessaging` as implemented and `typeBTransport` as blocked for these
reasons.
