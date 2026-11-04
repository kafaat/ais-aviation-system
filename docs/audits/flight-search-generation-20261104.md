# Flight-search cache generation — 2026-11-04

## Observed browser failure

The [CI run for privacy head d9d03da](https://github.com/kafaat/ais-aviation-system/actions/runs/41866403623)
passed the privacy export case on its first attempt. A separate flight-date
case failed on its first search because the newly inserted fixture flight was
absent; that case passed on retry. The artifact does not retain the returned
flight array, so this observation alone cannot identify the cache interleaving.
The flight service, cache service, and fixture source were unchanged by that
privacy revision.

The search cache previously read its namespace generation independently for
lookup and publication. If a source query began before invalidation and finished
after it, publication could put the older rows into the newly advanced
generation. In addition, an absent version counter was read as 1, while the
first Redis INCR also created 1, leaving existing generation-1 rows visible.

## Controlled reproduction and correction

The regression runs the real flight service and cache implementation with a
stateful Redis-command stub and deferred database reads. Before the correction,
six cases failed and the ordinary warm-cache control passed. In the remote
invalidation case, an old query begins at generation 7; another process advances
the counter to 8; the old query then completes. The following search must include
the new flight rather than reuse the old result under generation 8.

The correction captures the Redis version and a local connection epoch before
cache lookup and source work. Publication reuses that captured version, so a
delayed result cannot acquire a later generation. Local invalidation and Redis
connection transitions advance the epoch; stale pending reads and fills cannot
repopulate memory after that boundary. Memory entries are cleared on connection
transitions, and Redis read-through checks the epoch after asynchronous reads.

The existing missing-version default remains 1. Invalidation initializes the
counter with `SET versionKey 1 NX` before `INCR`, making the first completed
invalidation advance beyond legacy generation-1 entries without resetting a
counter another process already created. The browser fixture uses the same
initialization before advancing the search generation.

This preserves existing cache keys, response contracts, normal TTLs, and live
availability overlays. Unrelated invalidation may conservatively skip a pending
fill; a subsequent request can fill the cache normally.

## Browser fixture isolation

The flight-date browser case creates its fixture on a reserved departure day,
60 days ahead, inside the original insert transaction. Other journeys retain
the existing default of two days ahead. Both search results must contain that
exact fixture flight, with departure and arrival values restored as Date
instances and equal to its authoritative detail response. The cold/warm detail
comparison and booking-page assertion remain in place.

Whole-array equality is unsuitable while other journeys create flights and
live availability overlays change. The focused regression separately verifies
a genuine warm Redis hit and date restoration. The browser continues to use
the disposable suite's real Redis service; no timeout, retry count, provider
boundary, or authenticated assertion is relaxed.

## Local evidence and limits

All seven generation regressions pass after the correction. The focused cache,
civil-day, freshness, and generation suites pass 48 tests in total. Application
TypeScript, targeted ESLint, formatting, and diff checks also pass. An independent
review checked the production changes and regression design, including remote
invalidation that does not call the local invalidation method and the absent
counter with preexisting legacy generation-1 data.

These controlled tests use a Redis-command stub rather than a native Redis
server and do not contact production databases or external providers. They
establish the reproduced cache races and their repair, not the exact historical
browser interleaving. Current-head CI, native database gates, and first-attempt
browser results must be assessed separately before merge.

An invalidation performed entirely while Redis is unavailable still affects
only the local fallback; this change does not add durable invalidation replay
on reconnect. Seed scripts also remain cold-setup tools: CI runs them before
starting the application. Running them against a live application with warm
caches requires separate cache coordination.
