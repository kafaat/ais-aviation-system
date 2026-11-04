# Rate-limit transport recovery — 2026-11-04

## Defect reproduced

The request-facing cache client used the pinned ioredis 5.11.1 defaults for
offline queuing and unacknowledged-command resend, with ten request retries.
Rate limiting performed `SET NX`, `INCR`, then `TTL` as separate round trips.
Protocol readiness fixed the initial-handshake case but did not bound a later
connection failure. A lost acknowledgement could remain pending, or an `INCR`
could be replayed after reconnect. The memory fallback also started an empty
counter after successful Redis requests, granting another allowance on outage.

Before the production change, the three real-ioredis TCP/RESP regressions failed:

1. A post-ready lost acknowledgement remained pending beyond the unchanged
   400 ms test budget.
2. An acknowledged one-request Redis allowance followed by disconnection allowed
   another request from a fresh memory bucket.
3. A dropped increment acknowledgement was transparently resent and returned a
   denial instead of reporting the interrupted operation.

## Implementation and guarantees

`cache.service.ts` now performs increment and expiry in one Redis Lua command.
It retains the integer counter and existing `${CACHE_PREFIX}:ratelimit:` key
format used by agent quota readers. An absent expiry is repaired atomically
without resetting the accumulated count. The reply includes the remaining TTL.
Invalid expiry input is rejected before sending any mutation.

The request-facing client uses a 250 ms command deadline,
`enableOfflineQueue: false`, `autoResendUnfulfilledCommands: false`, and
`maxRetriesPerRequest: 0`. Connection retries remain available for recovery,
but a failed request is not retried with the connection. Protocol readiness is
checked against the actual client status and transport as well as the ready
event. Healthy idle connections have no request timer.

This is not a `Promise.race` around an outstanding mutation. In the pinned
ioredis implementation, `Command.setTimeout()` rejects a promise without
removing its command from `commandQueue`. The `RequestRedis.sendCommand`
adapter observes that rejection and destroys the socket captured when the
command was sent. The close handler flushes pending commands with zero request
retries, and neither offline nor unfulfilled commands can be sent on a later
connection. This applies to all commands on the request-facing connection.
Capturing the socket prevents a late rejection from closing a newly recovered
transport. Explicit disconnect also disposes of the owned socket and stops
reconnecting even when `QUIT` cannot be acknowledged.

The adapter deliberately does not use pinned ioredis's `socketTimeout` option.
Its `Redis.js` `setSocketTimeout()` callback references the current `this.stream`,
while its data cleanup belongs to the old stream. The close handler does not
clear that timer. A dropped reply followed by a 100 ms reconnect therefore let
the old 250 ms timer destroy the healthy new stream. The follow-up regression
reproduced that failure and now verifies the recovered stream survives the old
deadline while idle.

`rate-limit.service.ts` synchronously reserves local quota before awaiting Redis.
That reservation is used once on failure. Successful Redis replies include
observed consumption from other instances and preserve subsequent in-flight
reservations. Reservation sequence numbers prevent an older reply from erasing
newer evidence. A reply from an old local window or before an administrative
reset cannot mutate a new entry. Status reads respect the same local ceiling.

### Finite quota windows

A follow-up regression found that taking the maximum of the old expiry and every
reply-time TTL could keep an exhausted counter alive indefinitely. A new Redis
window can begin just before the previous conservative expiry; carrying both
the old count and the new expiry would deny the next window and repeat forever.

The service now bounds each observed Redis expiry between command-send time plus
TTL and reply-receipt time plus TTL. Repeated observations of the same window
tighten this interval instead of moving its expiry later. A distinct expiry
interval after the previous window could have ended identifies a fresh server
window and rebases a healthy shadow to that new count. A prematurely reset
counter cannot erase the previously consumed allowance before that old window
could expire.

Once a request uses fallback, its local window's expiry is frozen. Recovery can
raise its count but cannot extend that expiry or erase fallback consumption.
After it expires, healthy traffic can obtain a fresh allowance; the regression
checks five consecutive healthy windows and four consecutive windows after
recovery, including a 10 ms reply-latency overlap. A further regression checks
the full allowance for concurrent requests crossing four consecutive boundaries;
reservations made before the first new-window acknowledgement move to that
window without carrying their old counter snapshots. A local denial may already
have consumed a Redis increment, so Redis itself may still deny the remainder of
its current window. The local fallback ceiling does not prolong itself into the
following window.

### Scope of the guarantee

- The bound is for this Redis quota operation while the Node event loop is
  running; it is not a bound for the complete HTTP request or a paused process.
- A mutation already transmitted to Redis may have executed even when its reply
  was lost. It cannot be undone by closing a TCP socket. The client never queues
  or replays that operation, and the local reservation conservatively charges
  the attempt. Direct cache-service callers receive an error rather than an
  invented allowance.
- The fallback preserves a **per-process** quota across transport failure and
  recovery, including Redis usage that this process observed. It is not a
  globally shared outage quota across disconnected replicas or process restarts.
- Combining local and Redis ceilings can deny requests longer than Redis alone
  while an already established fallback window remains active. That ceiling
  has a fixed finite deadline; recovery cannot slide it forward. Further Redis
  denial still depends on the actual shared counter and its own expiry.

## Verification

The focused command runs 55 tests across five files:

```sh
AIS_TEST_REDIS_SERVER_BIN=/absolute/path/to/redis-server \
  node node_modules/vitest/vitest.mjs run \
  server/__tests__/cache-rate-limit-native.test.ts \
  server/__tests__/cache-rate-limit-recovery.test.ts \
  server/__tests__/cache-transport-readiness.test.ts \
  server/services/rate-limit.service.test.ts \
  server/__tests__/tenant-rate-boundary.test.ts
```

The transport fixture uses actual ioredis and loopback sockets, including a
trickled incomplete reply that keeps the socket active past the command
deadline. It proves timely fallback, destruction of the failed transport,
retention of quota after recovery, survival of the recovered idle connection
past an old connection's deadline, and no mutation replay when reconnection is
held until after a one-second window expires. It models RESP counter replies;
it does not claim to implement Redis's Lua engine.

The separate native fixture runs the actual Lua against an owned disposable
Redis process. It accepts exactly five of twenty simultaneous requests, repairs
an existing count of four without expiry without resetting quota, checks real
window expiration, and proves invalid expiry creates no counter. Local native
acceptance used Redis 7.4.5 from official source commit
`7e0f53393290f7c1f35596117b67748efad16580`. The helper accepts only an explicit
absolute binary path, binds loopback, disables persistence, and stops only its
own child. It cannot select an inherited `REDIS_URL`.

The four native tests are explicitly skipped when
`AIS_TEST_REDIS_SERVER_BIN` is absent; CI must provide the binary to claim this
acceptance. The existing transaction-boundary acceptance also exercises the
same production quota method with twenty concurrent calls against its native
Redis service. Existing pre-ready latency and tenant/tRPC denial assertions
remain unchanged. Full integrated type checks and complete CI are separate
merge gates and are not implied by these focused results.
