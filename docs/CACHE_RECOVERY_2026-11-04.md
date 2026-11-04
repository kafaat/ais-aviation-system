# Durable cache invalidation and Redis recovery

## Behavior and guarantee

Migration `0067_cache_namespace_generations` adds one small MySQL authority table. An acknowledged namespace invalidation first commits a new opaque generation there. Every later versioned cache read obtains the current global and namespace generations in one primary-key query. Consequently, an old Redis entry stays unreachable after a Redis outage, a reconnect, or termination of the process that acknowledged the invalidation. No local replay queue or reconnect callback is needed for correctness.

Cache keys retain the existing Redis counter and add the durable generation pair. Direct Redis counter increments used by existing fixtures still fence late source fills. Connection epochs continue fencing local reads and fills across disconnect/reconnect transitions. Old cache entries expire under their original TTL; no TTL has been extended.

The authority key is SHA-256 over the unambiguous tuple `[CACHE_PREFIX, namespace]`. The global scope uses `null`, which cannot alias a namespace string. Distinct prefixes therefore use separate durable generations. Generation rows contain no customer data, and the existing parameter hashes, tenant boundaries, DTO allowlists and live flight-state checks are retained.

**This guarantee starts after a successful cache invalidation. It is not an atomic business mutation plus invalidation guarantee.** The caller audit found namespace invalidation only in cache administration and the read-only popular-route refresh. No booking, payment or flight mutation currently calls this service's invalidation methods inside a business transaction. Adding such a writer later requires advancing a generation within its transaction or publishing a reliable transactional event; calling invalidation after commit leaves a crash window. This change does not turn a committed business mutation into a failed request.

## Authority failure and cost

- A missing table, unavailable database or failed read bypasses both Redis and memory. A failed read never guesses the initial generation. An initial `0.0` token is valid only after a successful authoritative read finds no generation rows.
- The authority read deadline is 250 ms and the write acknowledgement deadline is 2 seconds. At most eight authority operations may remain outstanding in a process. A timed-out query keeps its slot until it actually settles, so timeouts do not create an unbounded queue of abandoned cache queries. This bounds cache-specific waiting/work, not the application's separate source query.
- A failed or timed-out invalidation is not acknowledged as successful. A timed-out SQL upsert can still finish afterward; retrying is safe and advances to another opaque token.
- Each source read/fill pair captures once. The cost is one indexed two-key MySQL lookup per versioned cache request. A warm flight request already queries live status, capacity and hold/RBD state from MySQL. The reference and route caches now also require a healthy authority to serve cached results. Under authority saturation, uncached source reads are preferred over unverifiable cached values.
- Redis commands have a 1-second timeout and no offline command queue. A durable invalidation still succeeds if the subsequent best-effort legacy Redis counter update fails.

Do not delete generation rows as routine cache cleanup. Deleting them can reintroduce an earlier generation. After restoring an older database backup, discard the corresponding Redis cache or rotate `CACHE_PREFIX` before serving traffic; the generation authority must not be rolled back independently of its cached values. Deploy migration 0067 before the new application version. An unmigrated application remains fail-safe by bypassing versioned caches and refusing invalidation acknowledgements.

## Callers and helper semantics

The following production readers now reuse the same captured generation across their cache lookup and asynchronous source fill:

| Reader                     | Namespace  | Source                                       |
| -------------------------- | ---------- | -------------------------------------------- |
| `searchFlights`            | `search`   | Flight search plus live capacity/hold checks |
| `getFlightById`            | `flight`   | Flight details plus live status overlay      |
| `referenceRouter.airlines` | `airlines` | Active airline catalog                       |
| `referenceRouter.airports` | `airports` | Airport catalog                              |
| `getPopularRoutes`         | `routes`   | Booking-derived route ranking                |
| `getSuggestedDestinations` | `routes`   | Origin-specific route ranking                |

Namespace writers are `cacheRouter.invalidateNamespace`, `invalidateFlightSearch`, `invalidateReferenceData`, `invalidatePricing`, `clearAll`, and `refreshPopularRoutesCache`. Targeted flight-detail deletion and targeted pricing deletion conservatively advance the entire containing namespace, including every cabin and any pending fill. This can cause additional cache misses but cannot leave the supposedly deleted key readable after a Redis outage.

`clearAll` first advances the durable global generation, then scans and deletes only its literal Redis prefix. If raw Redis cleanup cannot be confirmed, it reports a partial-cleanup error; versioned invalidation already completed and retrying is safe. Successful administration reports versioned invalidation and confirmed Redis key cleanup explicitly.

**Raw helpers and cached session helpers are separate, best-effort helpers.** Their key formats and ordinary `getRaw`/`setRaw`/`deleteRaw` behavior are retained. This change does not claim durable raw deletion, cross-process raw-memory invalidation, session revocation or transactionally atomic raw cleanup. `clearAll` confirms the Redis cleanup attempt, not concurrent raw writers or another process's raw-memory cache. Authentication session authority is not moved into these helpers. The price-calendar raw cache remains outside the versioned-generation guarantee.

## Evidence collected locally

All commands below were run from the cache worker worktree using the existing matching dependency installation. The repository's full application/scripts/E2E TypeScript checks are reserved for the integrated tree.

1. Before implementation, adding `does not revive a pre-outage Redis entry after an offline invalidation` to the existing generation suite produced **1 failure / 7 passes**. The observed value after reconnect was `"stale Redis record"`, where `null` was required. Command:

   ```sh
   node node_modules/vitest/vitest.mjs run --project server server/services/flights-cache-generation.test.ts --maxWorkers=1
   ```

2. After implementation, **61 tests in six focused files passed**, including the original seven generation/epoch regressions, durable remote invalidation, failed-authority bypass, targeted invalidation, global invalidation, bounded authority waits, pending-operation caps, and existing flight/reference serialization behavior:

   ```sh
   node node_modules/vitest/vitest.mjs run --project server server/services/cache-generation-authority.test.ts server/services/flights-cache-generation.test.ts server/services/redis-cache.service.test.ts server/routers/reference.test.ts server/services/flights-cache.test.ts server/__tests__/search-freshness.test.ts --maxWorkers=1
   ```

3. An owned Redis 7.4.5 process and an actual TCP partition passed **two native transport cases**. The first verifies that the pre-outage Redis bytes still exist while offline invalidation changes which generation can be read after reconnect; it also rejects a late source fill. The second verifies partial-clear errors during the partition and actual raw Redis cleanup after reconnect:

   ```sh
   AIS_TEST_REDIS_SERVER_BIN=/tmp/ais-resilience-tools/redis-7.4.5/src/redis-server node node_modules/vitest/vitest.mjs run --project server server/services/redis-cache-native.test.ts server/services/flights-cache-generation.test.ts server/__tests__/cache-recovery-mysql.test.ts --maxWorkers=1
   ```

   That combined command reported **13 passed / 3 skipped**. The two local native-Redis tests intentionally use a controlled authority fixture; they are not SQL acceptance evidence. The three skipped cases require native MySQL and are described below. Redis was built from official commit `7e0f53393290f7c1f35596117b67748efad16580`; binary SHA-256 was `b90506919b2f2567f4bc21817a512c7a14c8941d813dacf530088ce45779461c`. The shared native Redis launcher is owned by the rate-limit workstream.

   The final combined run of all eight files from items 2 and 3 reported **63 passed / 3 skipped**, with seven files passing and only the native MySQL file skipped. It used the identical committed shared Redis launcher from the rate-limit workstream.

4. A separate actual child-process smoke verified the worker's IPC-ready handshake, raw native-Redis round trip, and the production authority's fail-safe behavior against an explicitly unavailable loopback MySQL port. It did not claim a successful MySQL read or write. An initial smoke attempt had incomplete fixture environment variables and exited at the existing environment validator; the corrected complete test environment passed.

5. The repository's guarded migration generator accepted only `cache_namespace_generations` as the changed table. `assertSnapshotMatchesSchema()` passed, and affected-file ESLint and `git diff --check` were clean. There are now **181 application tables**, or **182 including `__drizzle_migrations`**. Table catalog verification derives its expected names from the schema; no hardcoded table count was weakened.

   ```sh
   DATABASE_URL=mysql://test:test@127.0.0.1:3306/ais_test node --import tsx scripts/db/generate.ts --name=cache_namespace_generations --tables=cache_namespace_generations
   node --import tsx --input-type=module -e 'import { assertSnapshotMatchesSchema } from "./scripts/db/snapshot-check.ts"; await assertSnapshotMatchesSchema();'
   ```

## Native MySQL acceptance still required in CI

`server/__tests__/cache-recovery-mysql.test.ts` is enabled by `NODE_ENV=test` and `AIS_DISPOSABLE_DATABASE=true`; it then requires explicit loopback MySQL and Redis URLs. It creates an owned temporary schema, copies the committed migration's generation table structure without copying user data, and uses independently killable Node processes running the production cache and SQL authority. All Redis keys have a unique owned prefix; the shared Redis server is never stopped or reset.

The three cases cover:

- A reader that stays connected while only the writer loses Redis connectivity; a successful SQL invalidation; killing that writer with SIGKILL; a stale late fill in the surviving reader; and a restarted writer reading the current generation.
- Prefix isolation, global invalidation while offline, explicit partial raw cleanup, and successful cleanup after reconnect.
- A temporarily unavailable authority table causing cache bypass and rejected invalidation, then recovery without publishing an unverifiable fill.

No native MySQL server was available in the local workspace. These three cases, catalog verification and the full integrated typechecks must pass in CI before this workstream is described as fully validated across MySQL and multiple application processes.
