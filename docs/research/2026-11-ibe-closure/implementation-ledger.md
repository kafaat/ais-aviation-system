# IBE journey completion — ownership and acceptance

Implementation checkpoint: 2026-11-03, against main
`128e67c640ebb1e57f9e944471b89b1bb4711660`.
Delivery: [PR #250](https://github.com/kafaat/ais-aviation-system/pull/250),
`codex/ibe-journey-completion-20261103`.

A source change, a passing test, a merged change and acceptance on a deployed
target are separate states. The PR records CI results against the published
head; this ledger does not convert local component or memory-database tests
into live database, provider or production acceptance.

## Existing owners checked before implementation and integration

| Scope                                                                                                            | Existing work and inspected head                                                                     | Treatment here                                                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Direct sectors, scoped initial extras, named fare rules, ticket allowance, agency ownership, kiosk and reporting | PR #248 `83d950fef7140b89f4522002793ecba5f3fd6b6b`                                                   | Included as an explicit dependency, preserving its commits and financial writers.                     |
| Departure desk, boarding/offload, physical baggage acceptance, APIS                                              | PR #247 `4f803a6fbb02e57e44372bb0e54c0fb26bc34a19`; later `00ef5528b64ee0454e70140bb7bd6f6cf9cc2d4b` | Kept with its owner. Compatibility tested in a separate local integration, not imported into this PR. |
| Passenger special services by sector                                                                             | PR #249, incorporated into #247                                                                      | Its sector/authorization work is retained in the separate compatibility integration.                  |
| DCS funded recovery and seat denial follow-up                                                                    | PR #251 `34129b2da63b70d07a70a4cd1e8df6dd9b2f1f50` at discovery                                      | Separate owner; no duplicate DCS implementation here.                                                 |
| Version proposal                                                                                                 | PR #245 `release/v1.35.0`                                                                            | Release metadata remains independent of functional acceptance.                                        |

PR heads can advance. Re-read exact heads and changed hunks before merging;
sharing a file does not imply sharing ownership of every feature.

## Implemented work owned by this branch

| Audit finding                           | Implementation                                                                                                                                                                                                            | Authority and limits                                                                                                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IBE F04 — resume checkout               | Owned `/checkout/:bookingId` invoice review; legacy cancelled-provider URLs resolve to the same booking; pending bookings expose a resume link; card, wallet and split-payment actions coordinate through one busy state. | Reads canonical invoice/claim state, handles frozen/paid/expired/cancelled states and reconciles ambiguous outcomes. It never creates a replacement booking or sends a client-calculated payable amount.                                                               |
| IBE F05 — authentication and navigation | Safe internal return destinations across password login, registration, MFA and OAuth; protected passenger entry; original raw query preserved through nested routes; usable back-to-search behavior.                      | Open redirects and encoded hostile destinations are rejected. Financial and account authorization remain server-side.                                                                                                                                                  |
| IBE F06 — public booking retrieval      | `/manage-booking` and POST-only `manageBooking.lookup`, with reference and surname, generic failure, no-store responses and separate IP/reference limits.                                                                 | Minimal itinerary/status only. No passenger/contact/payment details, internal booking ID or account mutation capability. Tenant resolution is deployment-scoped; no anonymous cross-tenant search.                                                                     |
| IBE F07 — travel agent portal           | Session-protected `/agent`, owner-scoped agency selection, party-aware search, booking list/statistics and reservation-to-checkout journey. Complete payload and UUID remain frozen after an ambiguous submission.        | Uses the existing agent command, inventory, limits, pricing, commission and idempotency authorities. Same-transaction owner/tenant checks precede cached replay. No browser API secrets, administrator ownership bypass or replacement-owner access to prior bookings. |
| IBE F08 — display preferences           | Validated region/currency controls, navigation preservation and display-only local preferences; optional fresh-rate estimates next to canonical SAR amounts.                                                              | Stale, fallback and cross-rate estimates are suppressed. Currency selection does not change invoice, tenant, fare or settlement policy.                                                                                                                                |
| IBE F09 — branding and embedding        | Operator display identity; isolated optional `/embed/search` document; native GET form opens normal search at the top level.                                                                                              | Explicit HTTPS origin allowlist; exact server-path framing exception; conservative client isolation of normalized variants. Other account/payment routes retain framing restrictions. Deployed proxy/browser acceptance remains environment-specific.                  |
| IBE F10 — search and promotion journey  | Adult/child/infant counts, return and multi-city itineraries, civil dates, adjacent-day navigation, authoritative quote readiness and promotion application before a payment claim.                                       | Existing fare and passenger policies determine prices. Unsupported vendor youth/brand policies are not invented. Removing a passenger preserves only the remaining passengers' seat assignments.                                                                       |

IBE F01–F03 consume PR #248 instead of introducing competing writers. Legacy
unscoped ancillaries are normalized only when passenger and sector are unique;
ambiguous scope is rejected atomically. Named paid seats and initial multi-city
seats use the existing canonical seat authority.

The source does not claim vendor hosting/ASPX compatibility, agency multi-sector
booking, editable passenger contact persistence in the agent command, airline
partner quota authority, or external payment/station acceptance. Operator
configuration is documented in:

- `docs/operations/public-manage-booking.md`
- `docs/operations/agent-browser-portal.md`
- `docs/operations/ibe-embedding.md`

## Local verification and integration evidence

The agent runs below overlap; their counts must not be added to imply one full
suite. The integration PR's checks are the authority for the published head.

| Boundary                                                          | Observed local evidence                                                                                                                                                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR #248 canonical booking, extras, funding, seat and ticket paths | 12 independent forensic probes passed against exact `83d950f`; combined checkout lifecycle probes and 16 checkout UI cases passed on local integration `90d188a`.                                     |
| Authentication and nested return destinations                     | 72 focused cases passed, including encoding and hostile return targets.                                                                                                                               |
| Public booking retrieval                                          | 52 focused cases passed, including real Express/tRPC HTTP, POST-only/no-store, batch rate-limit, tenant and minimal-disclosure checks. Database behavior uses transaction-memory fixtures.            |
| Checkout resume                                                   | 62 focused cases passed across owned snapshot, promotion/payment races, old-route routing and UI states.                                                                                              |
| Agent portal                                                      | 97 cases passed in the initial security/UI/command/retrieval regression; the subsequent 7-case portal UI run covers frozen ambiguous commands and definitive first-attempt rejection.                 |
| Embedding                                                         | 59 initial focused cases passed; subsequent 51-case normalization/form/HTTP run passed. These include actual Express/Helmet responses, not a deployed nginx or ingress controller.                    |
| Civil-day history replay                                          | Actual Home regression passed in `America/Los_Angeles`: 5 cases including civil-day and legacy ISO history.                                                                                           |
| Passenger-seat roster change                                      | Actual BookingPage and SeatMap reproduced 2 failures before the fix; all 3 regression cases passed after it. Together with scoped checkout, 6 cases passed.                                           |
| Search through multi-city login                                   | Independent component/navigation probe passed with actual MultiCityResults, protected route and login; typed passengers, sector order and nested encoded context were retained. Hooks were synthetic. |
| Build                                                             | Vite production bundle and server/worker esbuild completed locally before the final portal/seat follow-ups. CI rebuilds the exact published tree.                                                     |

Separate DCS compatibility commit
`55ad0f860d546f70a1adb51425d86717ddcc2033` combines IBE/VRS `90d188a` with
PR #247 `4f803a6`. It preserves sector-scoped SSR, EXST refusal and historical
unverified labels. Thirty-two distinct focused cases passed across SSR, DCS,
kiosk and late-refund/companion boundaries. Two synthetic test fixtures needed
initialization/canonical coupon-number corrections; financial source was not
rewritten. The later `00ef552` delta changed only formatting in two migration
metadata files; parsed JSON equality was verified. This evidence does not
claim that later F07/F09 additions were integrated into the DCS branch.

### Final combined local check

After integrating the final seat and portal changes, all **416 client tests in
42 files** passed with `TZ=America/Los_Angeles`. The six targeted server boundary
files passed **142 tests**, and the separate booking-command integrity file
passed **39 tests**. Whole-repository ESLint passed with zero warnings. Service,
capability and event-contract documentation checks passed. Playwright collected
the registered hardening journeys successfully; collection is not execution.

A no-browser probe using the repository's actual Playwright configuration also
verified both artifact policies: the agent-registration test resolves
trace/video/screenshots to `off`, while the independent base test retains the
normal recording settings. No broader trace policy was weakened.

## Browser and database acceptance

The existing CI browser job retains all PR #248 suites. It additionally
registers the following acceptance journeys in `hardening-journeys.spec.ts`:

1. Public search with adult/child and display preferences, real password login,
   canonical promotion, wallet settlement, legacy cancellation URL and exactly
   one booking/ledger charge.
2. Public reference lookup, minimal itinerary, no-store response and protected
   account action.
3. Linked agency owner searches and reserves through `/agent`, reviews an owned
   pending invoice, and is checked against the disposable database; anonymous
   and unrelated-account access are rejected. One-time agency registration
   credentials are excluded from this test's trace/video/screenshots.
4. Existing provider-boundary fixtures now pass through invoice review before
   invoking checkout, preserving their invoice/ledger assertions.

These use the CI-owned disposable MySQL/Redis environment and synthetic provider
boundaries, not production funds. At this local checkpoint those new browser
cases had been authored/collected but not executed: MySQL/Redis services are not
available in this workspace and Chromium execution is restricted. Full local
TypeScript checks were terminated with exit 137 before diagnostics; no local
type-check success is claimed. CI must pass formatting, lint, application/E2E/
script type checks, database suites, build and browser acceptance on the exact
published head before the implementation is considered ready to merge.

No merge to main or production deployment is recorded by this implementation
checkpoint. Follow-up CI findings and their fixes belong in the same PR, with
the tested commit identified explicitly.
