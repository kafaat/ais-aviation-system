# Privacy worker shutdown — 2026-11-04

## Observed CI behavior

The privacy export browser case in the [post-merge run for PR #267](https://github.com/kafaat/ais-aviation-system/actions/runs/41843383106)
completed on retry. Its first attempt reached `processPrivacyRequests:return`
at 106 ms and `closePool:return` at 107 ms, then the parent's existing 30-second
deadline terminated the child with `SIGTERM`. The immediate resource snapshot
contained `Immediate`, `MessagePort`, `PipeWrap`, and `TCPSocketWrap`.

The browser artifact identifies the actual CI runtime as Node 22.23.4. The local
runtime available for the investigation was Node 24.22.1. Both select the
synchronous registration path in the installed tsx 4.23.13. An immediate resource
snapshot does not identify which resource remained active at the deadline.

## Reproduced lifecycle defect

A loopback MySQL protocol fixture ran the actual
`scripts/e2e/process-privacy.ts` entrypoint against an explicitly disposable,
empty synthetic database. It acknowledged the UTC session setup and completed
the worker's transaction and queries. In the controlled failure condition it
received `COM_QUIT` but did not initiate socket closure.

With the original code, both processing and `closePool()` returned at 128 ms,
but the child was still running 2.5 seconds after launch with one open database
socket. Releasing the peer then allowed a natural exit with code 0. A normal
peer also exited with code 0. The corrected fixture emitted no packet sequence
warnings.

Installed mysql2 3.24.3 acknowledges `Quit` before writing its packet, and its
pool's `end()` completion does not await TCP closure. Thus awaiting that API
alone is insufficient to establish that the process has released its database
transports. This controlled reproduction establishes a real shutdown defect;
it does not establish the resource owner of the historical CI timeout.

## Correction

`closePool()` retains a single completion promise for concurrent callers. It
captures only connections owned by that pool, including connections still
handshaking, and waits for mysql2's queued-command shutdown before closing
their transports. It reads each final stream after that wait so that a TLS
handshake's stream replacement is respected.

For successful command shutdown, Node's
[`socket.destroySoon()`](https://nodejs.org/api/net.html#socketdestroysoon)
drains pending writes before closing the socket locally. The operation then
awaits socket closure. If pool shutdown fails, the remaining owned transports
are destroyed and the failure is propagated. Transport cleanup failures also
reject. The singleton state is reset only after cleanup has settled.

An expected peer reset after successful command shutdown retains mysql2's
normal close semantics. Other errors are checked both from `socket.errored`
and from events observed during closure, including an already-closed socket.
If command shutdown fails, closing the remaining transports can abort their
pending work; that path reports failure. This does not add a timeout for an
active SQL command or cover connections removed from the pool before shutdown.

The connection snapshot uses the pinned mysql2 internal queue already accessed
for pool statistics. Real subprocess regression coverage is required to guard
that dependency contract. No process-wide handle enumeration or destruction is
used to perform cleanup.

The corrected reproduction exits naturally with code 0 even when the peer does
not initiate closure. At the 2.5-second observation there are no open fixture
sockets and the child has already exited. The final worker snapshot contains
only `Immediate` and `PipeWrap`.

## Automated regression

[`privacy-worker-shutdown.test.ts`](../../server/__tests__/privacy-worker-shutdown.test.ts)
runs real Node subprocesses with piped output and the real installed logger.
Its five cases cover a normal peer, a peer that holds `COM_QUIT`, a reset after
`COM_QUIT`, a deliberately rejected privacy query, and a pending query with
concurrent shutdown callers. Each close completion in the last case must follow
both the query result and transport closure. The fixture checks wire sequence
warnings, observed `COM_QUIT`, natural exit status, and socket cleanup.

The held-peer case was run against unchanged main `538a577` and failed as
intended: processing returned at 151 ms and `closePool()` at 152 ms, but the
test's eight-second failure watchdog had to terminate the child. All five cases
passed with the correction on the available Node 24 runtime. The watchdog is
test cleanup for failure; it is never an application success mechanism.

## Logger control and acceptance boundaries

Nine separately instrumented runs exercised the actual worker with pretty and
JSON transports, successful work, deliberate SQL errors, and a held database
peer. All terminated naturally with their expected exit codes. Every observed
Pino `flushSync()` returned; successful transports reached readiness and released
their worker reference. The held-peer delay occurred after logger readiness,
without a logger flush in progress. No logger defect was demonstrated, so the
logger configuration and lifecycle were not changed.

The application does not force successful process exit. The browser case keeps
its original timeout and retry policy, its authenticated export download and
content assertions, and the other-account 404 assertion. Current-head CI and
browser acceptance results must be recorded separately from these local
controlled experiments. The completed Railway readiness recovery remains
documented in [the readiness audit](readiness-recovery-20261104.md).
