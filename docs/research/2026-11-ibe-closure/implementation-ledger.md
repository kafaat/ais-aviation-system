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
| Direct sectors, scoped initial extras, named fare rules, ticket allowance, agency ownership, kiosk and reporting | PR #248 `eef8e9894059956410c54413210a47a42d3dac08` (initial dependency `83d950f`)                    | Included as an explicit dependency, preserving its commits and financial writers.                     |
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

### Owner update consumed after the first CI run

PR #248 advanced to `eef8e9894059956410c54413210a47a42d3dac08` while the
first integration CI was running. Its substantive fixes are consumed as an
explicit second parent: flown-coupon cancellation/refund protection, evidence
requirements for agency commission approval/payout, consistent bounded booking
exports, and named fares per multi-city sector. Its new commission and
multi-city-fare browser suites remain registered. Conflict resolution preserves
typed passenger edits, raw search/authentication context, canonical pricing and
the owned invoice-review destination. The F07 createAgentBooking function and
ownership guards remained byte-identical through this owner update.

Initial CI head `dde3bd37770b06b2a22002f06a007e5318eb9ab4`, tree
`c7aca993e978db311f898970eeb05e25826d4b91`, passed all application/E2E/script
type checks, lint, security, component labs and Docker checks. On both MySQL 8.0
and 9.7 it passed 132 live transaction checks, 36 integration remediation checks,
37 baggage baseline cases and all seven mutation checks, plus a matching
172-table backup/restore snapshot. Those checks made no provider calls.

The initial complete test run had 3284 passes and four failures in static
source-contract assertions that still expected provider navigation in
BookingPage and the old literal agent-command return statement. The assertions
were updated to follow CheckoutResume and the guarded transaction while retaining
the authority requirements. A new IBE browser assertion was also corrected to
compare the ledger's decimal SAR major units with invoice minor units. None of
these test corrections changes financial source to satisfy an obsolete test.
The resulting integrated head requires a fresh complete CI run; initial results
are not transferred to changed source.

After resolving that merge, 34 focused multi-city/authentication cases and
68 commission/export/refund cases passed. The four stale assertions were
reproduced before correction; afterward 67 cases passed across their two wiring
contracts and three existing checkout/agency behavior suites. These runs overlap
earlier evidence and are not added together as a single acceptance suite.

### Browser acceptance findings and concurrent repair

The integrated `0a525390db3c37f6b68695c27421cfbafe30613a` head passed all
3304 unit/coverage cases, all type checks, build, security and both live MySQL
gates. Its Chromium run passed 40 of 43 cases and exposed three issues:

- A real transport defect: My Bookings combined 16 tRPC queries into one request,
  exceeding the server's existing limit of 10. The HTTP 400 response prevented
  all allowance regions in that batch from verifying their data.
- The servicing test remained on invoice review before locating Manage Services,
  which belongs to My Bookings.
- A named-fare test required a literal href without the preserved search context.

Concurrent commit `2301c336f5ce147853978dddfbb22d2db3bccbe8` supplied the shared
`TRPC_BATCH_LIMIT = 10`, the client cap and navigation corrections. It is preserved
as an ancestor. This branch reuses that constant and server setting and adds an
executable configured-client transport regression; no parallel batch policy or
relaxation of the server limit is introduced. The client factory retains the
same URL, credentials, fetch options and SuperJSON transformation.

Before correction the regression reproduced the HTTP 400. After correction all
three cases pass: 16 concurrent allowance queries split into 10 + 6 with every
result intact, mutation body/headers/dates/session credential mode are preserved,
and a direct 11-call request still fails before any resolver executes. The
servicing test follows the existing My bookings link; the fare test checks the
flight path, cabin, fare code and original search parameters explicitly. The
funded baggage and single-bag weight assertions remain unchanged.

These changes require the complete CI/browser run on their new published head;
the 40 passing cases on the earlier head do not close the three failures.

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
