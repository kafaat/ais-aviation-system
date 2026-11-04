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
without a logger flush in progress. These local controls did not reproduce the
remaining browser-run shutdown failure.

The [next browser run](https://github.com/kafaat/ais-aviation-system/actions/runs/41855648189),
on head `f8c5e483077602c02ed2bb752a101c4a8e2dc608`, passed all 3,954 unit tests
and all database gates, but the privacy browser case still required a retry.
Work returned at 141 ms and database cleanup at 143 ms. Its final resource
snapshot contained `Immediate`, `MessagePort`, and `PipeWrap`, with no database
TCP socket. The process was nevertheless terminated by the existing deadline.
All eleven reporting cases passed on their first attempt. A green workflow that
permits retries was not treated as completion of this shutdown investigation.

## Explicit logger shutdown

The first logger follow-up awaited the owned Pino transport as well as the
database. It retained the existing logger construction, formatting, destinations,
and redaction. Pino's exported stream symbol identifies that logger's transport.
Concurrent shutdown callers shared one promise that waited for transport
readiness, asynchronously flushed output, requested termination, and awaited
the close event. Its error listener spanned shutdown, including a delayed error
after a flush callback had rejected. Logger cleanup also ran after database
cleanup failure.

A referenced five-second watchdog keeps the event loop active while awaiting
asynchronous completion and reports failure if that wait stalls. It cannot
preempt thread-stream's synchronous `end()` handshake, which has its own library
timeout. No complete five-second process-exit bound is claimed. A logger failure
does not become successful work.

Direct stderr phases now distinguish database and logger cleanup. The browser's
existing allowlist accepts only those phase names, elapsed times, and safe
resource-type names; arbitrary child logs remain excluded from its error report.
Three additional subprocess cases verified final pretty/JSON records, redaction,
concurrent and repeated closure, and rejection with delayed transport errors.
Those eight shutdown cases passed locally and in CI, but did not reproduce the
remaining browser failure.

The [third CI run](https://github.com/kafaat/ais-aviation-system/actions/runs/41861575803)
on `4088ff9f00c4ec6a4df623ef5f0a8af6b1da2f28` passed 3,957 tests in 317 files.
Its privacy case still needed a retry: processing returned at 107 ms, database
cleanup at 109 ms, then `closeLogger:start` was the last recorded phase. The child
exited with code 1, without being killed or receiving a signal. The sanitized
artifact did not retain the underlying logger error, so it cannot distinguish a
timeout from a transport failure. Artifact `13340673083` has verified SHA-256
`27accadc372e7bdc3e76ca12bb71da098e486dd5f4185fd5fb12e70a62f0123c`.

## Reproduced logger readiness race and correction

A deterministic scheduling fixture reproduced a race in the unmodified pinned
thread-stream 4.2.0. Its `READY` handler captures a write position and waits for
the read position to equal it. Further writes can be consumed before that wait's
callback runs, advancing the read position beyond the captured value. The stream
then remains unready even though all current bytes have been consumed. An
asynchronous flush also waits for readiness and cannot release this condition.

The fixture delegates to the real installed Pino pretty/JSON destination and
gates only scheduling. It reads the internal indices to prove the race, without
changing the library, its worker, or the indices. Against the previous
`closeLogger()`, read and write positions both reached 412 while readiness stayed
false; shutdown rejected after 5,002–5,005 ms with `Logger shutdown timed out`.
The revised function closed the real worker in 11 ms for pretty output and 15 ms
for JSON. Both records were retained exactly once and in order, and the processes
exited naturally with code 0. This proves the controlled defect and its repair;
the historical CI snapshot alone still does not identify its internal indices.

The revised shutdown calls the transport's public `end()` directly and awaits
actual closure. That API drains queued writes, including writes waiting for the
shared buffer, and ends the destination before acknowledging completion. It
does not require the readiness barrier or a preceding asynchronous flush.
Concurrent callers still share one promise. Scoped error observation and checks
of the pinned transport's `writableErrored` getter preserve failures before and
after closure. Normal server logging remains asynchronous with the same options.

Separate large-output controls queued 12,000 records before readiness in each
format, exceeding the four-MiB shared buffer. Pretty output retained 8,700,000
bytes and JSON retained 7,956,000 bytes; each had all 12,000 unique markers in
order and exited naturally with its worker closed. This exercises deferred
buffer drain and rollover, not just empty-stream closure.

The regression suite adds deterministic readiness-race cases for both formats.
All ten shutdown cases and eleven existing unified-logger cases passed locally
on Node 24.22.1; CI must verify the same source on its Node 22 runtime.
Direct stderr diagnostics also classify logger failure as only `timeout` or
`transport`; the browser allowlist never includes arbitrary exception messages.
Browser first-attempt acceptance remains a separate current-head gate.

The application does not force successful process exit. The browser case keeps
its original timeout and retry policy, its authenticated export download and
content assertions, and the other-account 404 assertion. Current-head CI and
browser acceptance results must be recorded separately from these local
controlled experiments. The completed Railway readiness recovery remains
documented in [the readiness audit](readiness-recovery-20261104.md).

## First-attempt browser acceptance and main integration

The [fourth CI run](https://github.com/kafaat/ais-aviation-system/actions/runs/41866403623)
tested head `d9d03da9747e81b703d46e70f99af1931c7b0d20` on Node 22.23.4.
All 3,959 unit tests in 317 files passed, including all ten shutdown subprocess
cases. The privacy browser case passed on its first attempt in 4,176 ms. All
eleven reporting browser cases also passed on their first attempt, with 59
download assertions. Artifact `13342292926` has verified SHA-256
`b9303f3dbc4902639b6c68ce71c5864b8ba8a2b736306656c2f8844f37d6cdfe`.

The full browser run contained 62 cases: 61 passed on their first attempt and
one flight-search case passed on retry. That separate case failed because its
first search did not contain the newly inserted fixture flight. The flight
service, Redis cache service, and fixture source had not changed between the
base and this head. A separate cache-generation investigation reproduced
stale publication across invalidation; its correction and full-suite acceptance
must be recorded independently. This run establishes first-attempt privacy
acceptance, not a retry-free result for the entire browser suite.

PR #268 subsequently advanced main to
`dbf179516c5f91d423e6f6c2893cb95f862f6f08`. Merge commit
`54b67a4a22be39ff53617f814c5efdc54b439e2b` reconciles `server/db.ts` with that
main: it preserves removal of untracked fallback pools, deferred shared shutdown
and propagated errors, alongside the owned-transport drain above. The existing
pool test fixture now models the pinned driver's empty connection queue.
The integrated head requires its own checks; earlier CI results do not replace
validation of changed source or workflow action revisions.

## Bounded one-shot execution

The successful drain behavior above does not bound an active SQL command that
never replies. The logger's five-second timer also cannot interrupt the main
thread while the installed thread-stream `end()` handshake blocks synchronously.
New controlled subprocess cases demonstrated both gaps: a never-answering SELECT
and a real Pino destination whose `end()` waits indefinitely each required the
test's eight-second failure watchdog to terminate the original helper. Direct
SIGTERM during the pending query appeared as a signal exit, without an owned
supervisor completing cancellation.

The public `scripts/e2e/process-privacy.ts` entrypoint now supervises one owned
Node child. The existing privacy work and pool/logger cleanup sequence moved to
`process-privacy-task.ts` without changing its success or error behavior. The
supervisor imports no database or logger code, so their blocked event loop cannot
prevent its deadline callback. It validates the disposable database guard before
launch and gives the task a total 20-second budget measured from just before
launch. `AIS_PRIVACY_WORKER_TIMEOUT_MS` can reduce that budget to an integer from
100 through 20,000 milliseconds; invalid, fractional, non-finite, or excessive
values fail before database work starts. The browser keeps its existing
30-second outer timeout.

On its deadline, SIGTERM, or SIGINT, the supervisor marks failure and sends
SIGKILL only to the child it created. It waits for the child's actual `close`
event before returning a nonzero exit code; merely accepting the kill request
does not count as completion. A child failure remains a failure, and normal exit
zero is accepted only without a supervisor failure. Timer and signal/error
listeners are removed after closure. No successful exit is forced, and no
process-wide socket cleanup is introduced. The existing API shutdown's
10-second deadline remains separate and unchanged.

Only fixed `supervisor:deadline`, `supervisor:signal`, and `supervisor:error`
phase names with elapsed times were added to the browser diagnostic allowlist.
Workload phases retain their original child clock; supervisor phases measure
from child launch. Arbitrary error text or child logs remain excluded from the
browser failure summary. Authenticated export/content/download assertions,
the other-account 404, and retry policy are unchanged.

The stalled-destination fixture delegates to the real installed Pino and
thread-stream, replacing only the destination's end handshake with a controlled
blocking wait. It leaves the thread-stream main-thread `end()` implementation
intact. With a three-second configured budget, the corrected SQL and logger
probes completed in 3,101 ms and 3,110 ms respectively, exited with code 1 and no
signal, and left no fixture database socket open. The logger case observed
successful pool closure and logger-start evidence but no false logger-return
receipt. Both SIGTERM and SIGINT cancellations also exited with code 1 and
closed their pending SQL connection. Their test watchdog did not fire.

All 21 privacy subprocess cases passed locally, including the original normal,
held/reset peer, query error, pending-query drain, final-record/redaction,
readiness-race, and delayed logger-error controls. Invalid budgets are checked
before any query or connection. The test-only watchdog owns an isolated process
group on POSIX so a future supervisor regression cannot orphan its task; this is
test cleanup and never an application success path.

The focused verification command passed 56 tests across six files on Node
24.22.1, and changed TypeScript/CJS files passed ESLint with zero warnings:

```sh
node node_modules/vitest/vitest.mjs run --project server \
  server/__tests__/privacy-worker-shutdown.test.ts \
  server/__tests__/database-pool-shutdown.test.ts \
  server/__tests__/api-shutdown.test.ts \
  server/__tests__/api-shutdown-wiring.test.ts \
  server/__tests__/sentry-shutdown.test.ts \
  server/__tests__/new-features/unified-logger.test.ts
```

This is an independent-process deadline for these application stalls under a
normally scheduled operating system, not a hard real-time guarantee against a
frozen host or uninterruptible kernel operation. An external SIGKILL of the
supervisor cannot execute its cancellation handler. Forced cancellation does
not promise rollback of privacy work already committed. The reusable pool and
logger APIs retain their existing boundaries; only the supervised one-shot
entrypoint owns the new total budget. Integrated TypeScript checks, CI's Node 22
run, and current-head first-attempt browser acceptance remain distinct gates.
