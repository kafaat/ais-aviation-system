# Sequential remediation of the 2026-09-09 audit

Base: `ef2a2dba476e51e2878fda5b88a86b5ac2f9ffa5` (1.20.26).
Branch: `fix/audit-ef2a2db-sequential`.

## Slice 1 — schema and runtime contracts

- F01: append migration 0013, with 89 new tables and the missing tenant/payment/auth columns. Preserve the 13 prior migrations. Register MFA settings in the declared schema and backfill previously nullable preference booleans before applying NOT NULL. Keep existing rows; duplicate favorites/reviews must be resolved before their unique constraints can be installed.
- Inventory correction: the initial regex counted 102 tables directly declared in schema.ts. Six more tables are re-exported from other schema modules. The effective base contains 108 tables; adding MFA brings the effective schema to 109. The live catalog verifier traverses all table exports.
- F01: test and E2E CI now use migrate, with a catalog comparison of actual tables, columns, types, nullability, auto-increment and index definitions. Remove the independent SQLAlchemy create_all writer. Empty and previous-release migration jobs both run the live verifier.
- F05: standalone job CLI entrypoints no longer execute inside an ESM bundle. BullMQ V2 uses legal names with an `ais` prefix; both queue layers share the Redis URL parser. The worker requires successful DB and Redis queries before announcing readiness.
- F10: optional Forge configuration no longer prevents API/worker startup. Compose orders writers after the migrator and updates the auth service and worker with the API. Kubernetes includes matching auth/worker deployments and CSRF configuration.
- F16: MySQL TLS verifies the server certificate; DB_SSL_CA_FILE supports a private CA. URL credentials are decoded.
- F17: readiness returns HTTP 503 when dependencies are unavailable, and 200 after recovery.

Validation: TypeScript and production build passed. Four focused tests passed (including real HTTP 503/200 behavior and the Redis URL contract). Running dist/index.js with unavailable synthetic services returned live=200 and ready=503. Running dist/worker.js no longer produced ESM or queue-name errors; it rejected the unavailable database instead.

Live MySQL/Docker are unavailable locally. Package installation failed on container UID/group restrictions; no restriction was disabled. SQL replay, nonempty upgrade preservation, image startup with live services and a real background job remain required before production acceptance. No local runtime failure due to missing services is treated as an application regression.

## Sequence established after slice 1

- F02/F06/F11: tenant boundaries, request limiting and authenticated offline data.
- F03/F08/F09/F12: MFA enforcement, shared session revocation, owner registration and refresh rotation.
- F04/F07/F15: funded wallet operations, canonical payment settlement and booking transactions/holds.
- F13/F14: image/supply-chain follow-up, honest operational capabilities and durable event handling.

Repository protection settings and production credentials are external to this source revision. They must be reported independently of source fixes.

## Slice 2 — tenant and request boundaries

- F02: `isAdmin` now means platform administration only. `airlineAdminProcedure` requires a matching assigned tenant. Airline booking reads filter by tenant; flight availability updates carry a tenant predicate. Unscoped audit/metrics, financial overrides and platform mutations reject airline admins. Unassigned resources no longer pass the default tenant assertion.
- F06: preserve Redis denial instead of deriving an allowed result from zero remaining quota. Redis errors reach the bounded fallback. Strict checks execute inside each tRPC procedure, including dotted paths, REST adapters and batch members. Network identity uses Express's explicitly configured trusted proxies; arbitrary forwarding headers are ignored.
- F11: API and unclassified dynamic responses use network-only/no-store. The new service-worker cache version removes old AIS caches on activation, and session cleanup requests private-cache removal. API response headers prohibit HTTP caching as well.

Validation: 92 tests in ten affected test files passed; TypeScript passed. Tests exercise actual HTTP 429 for dotted/batched procedures, both tenant rows under a generated SQL predicate, rejection before DB access, Redis denial propagation, and the real service-worker code refusing a previous user's cached response. Live multi-tenant DB/Redis and browser lifecycle verification remain part of acceptance.

## Slice 3 — authentication and shared session authority

- F03: verified passwords and OAuth identities receive a five-minute, five-attempt MFA challenge. Only successful, single-use TOTP/backup verification can mint a session. Challenges store a token hash; row locks protect challenge and backup-code consumption. Proof is bound to the exact enrollment. MFA setup changes revoke existing sessions and challenges. The browser completes the same challenge flow.
- F08: cookie and Bearer authentication consult a shared, revocable refresh-token family on every request, including current role/tenant/MFA state. Cookie tokens have explicit audience/issuer/purpose and a maximum 30-day lifetime. Logout, all-device logout and session revocation invalidate both transports. Old cookies and refresh records intentionally require login again.
- F09: public Python registration always creates role=user, including OWNER_EMAIL.
- F12: refresh rotation claims an unrevoked, unexpired record with an atomic conditional UPDATE before inserting its successor. Concurrent losers receive UNAUTHORIZED and do not mint tokens; the winning family remains usable. HMAC hashes protect refresh tokens at rest.
- Append migration 0014 (MFA challenges and session-family columns); do not edit previously applied migrations. Logout clears client query caches as well as stored tokens.

Validation: affected password/logout/type tests passed (22); the combined MFA/session, password and tenant regression suite passed (28). Real cookie/JWT cryptography under a deterministic DB adapter demonstrates shared revocation, denial without verified MFA, one refresh winner, challenge attempt persistence and consumed backup-code rejection. Python registration is executed under boundary doubles. TypeScript passes. These are not a substitute for MySQL lock/isolation and end-to-end OAuth/MFA acceptance on a configured environment.

## Slice 4 — funded, atomic financial operations

- F04: wallet top-up creates a pending Checkout request and credits only a verified amount/currency against that request, once per provider receipt. Wallet payment takes only a booking ID, verifies ownership, derives the amount, and debits wallet/ledger/inventory/booking in one transaction. Arbitrary unlinked wallet refunds are disabled. The UI redirects to Checkout rather than announcing an immediate balance increase.
- F07: Checkout and PaymentIntent completion call one settlement implementation. Paid status and exact SAR amount are required. The provider receipt key, booking locks and transaction protect sequential/concurrent retries. Split payments update their shares and only confirm when all active shares fund the exact total. Modifications update their own payment record and move capacity without being skipped because the original booking is paid. Refunds resolve by payment reference and record cumulative deltas only; partial refunds do not label the whole purchase refunded.
- F15: booking, passengers, server-priced ancillaries and the linked inventory hold are written atomically. Holds retain active status until payment/expiry. Settlement respects other purchases' active holds under the flight row lock. Cancellation and full refund use a persisted seatsReserved flag to prevent repeated restoration.
- Booking confirmation is persisted as an outbox event in the payment transaction; the pre-commit setImmediate side effect is removed. Flight cancellation requests real Stripe refunds and exposes pending/failing outcomes instead of assigning refunded status directly.
- Migration 0015 adds payment receipts and inventory ownership. It freezes legacy positive wallet balances because their historical funding was not verified. Existing confirmed/paid capacity is flagged for explicit inventory reconciliation; it is not possible to infer historical PI-first inventory errors from booking status alone.
- The read-only legacy-payment reconciliation script checks Stripe collections; --write-receipts can import verified baselines without altering historical ledger/inventory/wallet records. Old payments require this reconciliation before refunds enter the new receipt authority.

Validation: 16 executable regression cases cover real settlement functions with transactional persistence doubles (including both Stripe event orders, partial splits, modifications, cumulative refunds, wallet ownership, hold exclusion and booking rollback). The wider affected suite passed 71 cases before correcting a date/operator limitation in the test adapter; the three affected inventory cases subsequently passed. Provider HTTP calls are mocked; no real card, refund, wallet balance or production inventory was changed. Live MySQL contention and Stripe test-mode replay remain acceptance gates.

Stripe references: https://docs.stripe.com/metadata and https://docs.stripe.com/api/refunds/list .

## Slice 5 — durable operations and truthful delivery

- F14: email now requires a configured Resend sender and a successful provider response containing an ID. Failed/missing delivery is an error, so workers cannot announce success from a console log. Confirmation emails carry a stable idempotency key; mileage awards are serialized and deduplicated by booking.
- F14: outbox delivery uses the confirmation pipeline or an authenticated HTTPS receiver. Claims carry a unique lease token; completion/failure updates must still own that token. A stale worker cannot overwrite a replacement claim. Delivery remains at least once: receivers must deduplicate eventId, and provider acceptance is not proof of inbox delivery.
- F14: load-plan details are stored in MySQL with optimistic version checks and transactional summary updates. No new plan depends on a process-local Map. Previously lost in-memory plans cannot be reconstructed by migration.
- F14: simulated GDS reservations/tickets and disaster-recovery measurements refuse production execution. Development simulation requires AIS_ENABLE_DEMOS=true. Real GDS integration, measured recovery objectives and restore exercises remain operator/provider work; these capabilities are not declared implemented.
- F10/F14: the Kubernetes backup job writes a checked nonempty dump and SHA-256 digest onto a configured persistent volume, using an existing credential secret. The release job fails when backup is enabled without these prerequisites. Job cleanup does not delete the persistent volume. A restore exercise is still required.
- F01: the upgrade CI gate now seeds seven core tables at the previous release, snapshots their original values, and checks preservation after migrations and catalog verification. This gate requires live MySQL; it was not executed locally.
- F13: production image builds pull the current base, and the runner removes unused global npm/corepack/yarn toolchains. Image vulnerability closure still requires the real CI image scan; no vulnerability exemption was added.
- Append migration 0016 for durable load plans and fenced outbox claims. Update Compose/Kubernetes settings for email and event delivery. Full refunds also update their associated payment-history rows.

Validation before dependency upgrades: the full suite passed 1,035 tests; 240 existing/integration tests were skipped (83 passed files, 17 skipped). TypeScript and production build passed. Runtime HTTP probes returned liveness=200, readiness=503 with unavailable dependencies, and the strict login quota=5. The affected operational/email/loyalty/refund suite passed 60 tests. Python syntax, deployment YAML and generated persistent-backup job structure passed. An executable refund rollback case now injects an outbox failure after capacity restoration and verifies the whole transaction rolls back.

These tests use provider and transactional persistence doubles where services are unavailable. They do not establish live MySQL locking, durable-volume restore, actual email receipt, payment-provider replay or image-scan success. The complete-suite log includes existing React act warnings. No production data was changed.

Email references: https://resend.com/docs/api-reference/emails/send-email and https://resend.com/docs/dashboard/emails/idempotency-keys .

## Slice 6 — security dependencies and telemetry privacy

- F13: update both Sentry SDKs to 10.74.0, resolving OpenTelemetry core to 2.11.0 through supported dependency relationships. Update Vitest and its coverage provider together to 4.1.11. The frozen lockfile installs successfully. No cross-major OpenTelemetry override or advisory suppression was introduced.
- Migrate Vitest's removed environmentMatchGlobs option to explicit server/node and client/jsdom projects with inherited aliases/setup. Preserve coverage include patterns after removing obsolete coverage options. Browser observer and Redis constructor doubles now use constructable functions; callback mocks retain their component prop types. Browser setup/cleanup is awaited and hoisted mocks select the environment inside their factory. Set the TypeScript target to ES2022 for the existing modern runtime; rebuild its incremental cache after the option change.
- Additional privacy correction: mask text and block media in session replay. Error/transaction request export removes raw payload, serialized queries, cookies and credential headers. Manual middleware context no longer exports raw query input, recognizes normalized sensitive field/header names, and redacts excessively deep input.

Final validation: 1,037 tests passed, 240 skipped (84 passed files, 17 skipped) under Vitest 4 with V8 coverage. Coverage includes 502 source files and measures 10.73% of lines and 7.41% of branches: this is a limited baseline, not comprehensive assurance. TypeScript and the production build passed. ESLint passed with 0 errors and 250 warnings. pnpm audit reported zero advisories at all severities. The real Sentry SDK initialized and exported an event to an in-memory transport without sending external telemetry. Built-API probes again returned live=200, unavailable-dependency ready=503, and login quota=5. All 13 original SQL migrations and all 36 original audit evidence files remain unchanged.

The new manifest will distinguish final verification from intermediate failures encountered during migration of old test assumptions. Docker image scanning, live MySQL/Redis isolation and migration replay, provider test-mode operations, browser lifecycle, restore validation and repository protection remain acceptance work. Existing peer-dependency warnings also remain, notably the legacy trpc-openapi adapter with tRPC 11/Zod 4; REST/OpenAPI adapter replacement is a separate unresolved compatibility item. No claim that all 17 findings are operationally closed is made.

References: https://v4.vitest.dev/guide/migration , https://docs.sentry.io/platforms/javascript/guides/node/migration/v8-to-v9/ , https://docs.sentry.io/platforms/javascript/guides/node/migration/v9-to-v10/ .


## Slice 7 — REST/OpenAPI compatibility and transport boundaries

- Replace the incompatible trpc-openapi 1.x dependency with trpc-to-openapi 3.3.0 / zod-openapi 5.4.6 for documentation. Generate OpenAPI 3.1 with 211 paths; missing output validators are explicitly marked x-response-schema-unavailable rather than fabricating typed responses. Preserve original client inference and runtime parsers.
- Execute REST requests through the original tRPC caller. Convert HTTP strings without mutating shared Zod schemas; retain input refinements, auth, tenant context, sensitive-procedure limits and JSON body types. Static routes precede parameter routes; path identifiers override body/query values. Unknown REST routes return 404. Apply the general per-user API limiter to REST too.
- Mark public/protected procedures at their actual middleware source for accurate documentation security. Use the real cookie name and /api/rest base URL. Complex query values accept explicitly documented JSON strings.
- Documentation failures return HTTP 503 or a failing generator exit, never a cached empty success. The one-shot generator exits after its synchronous file writes; generated snapshots are excluded from git.

Validation: five regression cases pass, including real loopback HTTP requests and complete application route/document generation. They prove transport behavior with a supplied test context; existing session/MFA tests separately cover credential verification. MySQL, provider calls and actual production credentials are not exercised by these tests. This slice resolves the REST compatibility limitation recorded in slice 6.

Reference: https://github.com/mcampa/trpc-to-openapi . Its stock HTTP adapter mutates coercion flags; AIS deliberately uses its own transport boundary and only the supported documentation generator.


## Slice 8 — collection/refund lock ordering and legacy baseline safety

- Refunds discover an immutable receipt reference without locking, then lock its booking or top-up request/wallet before a current receipt read, matching collection order. All booking receipts used to decide full refund are current locking reads, avoiding a stale repeatable-read snapshot.
- Legacy receipt import remains read-only by default. Writing requires an explicit maintenance-window flag after payment/refund/webhook writers have stopped; the importer rechecks the locked booking against the provider snapshot and reports existing/changed rows accurately. The flag is an operator assertion, not automatic verification that external writers have stopped.

Validation: 15 financial boundary cases pass, including new booking/wallet lock-order assertions. The transactional double records lock calls but does not simulate MySQL deadlocks. Live contention is covered by the subsequent CI acceptance gate, which must actually run before operational closure.


## Slice 9 — preserve collected funds requiring review

- Append migration 0017 with explicit applied/review_required/review_refunded receipt state and a review reason. A verified booking collection that cannot reserve inventory, arrives after cancellation, duplicates an already funded booking or conflicts with an active split plan is retained in the receipt, payment history and ledger, with a durable review event. It does not confirm the booking. Fully funded splits that encounter inventory failure mark their funding receipts for review.
- Expected inventory/state errors are distinguished from database/outbox failures. Technical failures still roll back and remain retryable; a failure to save the review event also rolls back its receipt and ledger.
- Checkout, split checkout and wallet spending reject bookings with an outstanding review. Platform administrators can list reviews and request a provider refund through documented routes. Repeated operator requests use identical Stripe parameters and a stable key. Provider acknowledgement leaves the review open; only a verified refund webhook closes it. Refunding a reviewed duplicate cannot cancel or release the valid paid booking.
- Receipt replay validates immutable purpose/target/amount/currency. Remove absent-receipt locking reads that could hold MySQL gap locks; same-purchase owner locks and the unique receipt key remain authoritative.

Validation: 23 affected payment/operator cases pass. Tests cover late/cancelled and inventory-starved collections, duplicate refund isolation, review-event rollback, blocked repeat wallet payment, administrator permissions and provider retry identity. Provider HTTP is mocked. Unsupported/mismatched purchases and stale modification/top-up state still remain retryable errors in the durable Stripe-event inbox; this slice does not fabricate automatic reconciliation for every business case. Administrative review is exposed through tRPC/REST/Swagger; no dedicated new dashboard was added.
