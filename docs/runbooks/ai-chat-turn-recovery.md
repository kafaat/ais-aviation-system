# Durable chat turns: rollout, inspection and recovery

Migration `0081_chat_pending_turn` adds two nullable fields to
`chat_conversations`. It does not repair earlier transcript/count differences.
Use this procedure together with the canonical migration runner and the
deployment owner's environment-specific maintenance procedure.

## Compatibility gate

Old and new chat writers must not run concurrently. The old writer ignores the
pending association and can append messages or overwrite counts/context while
the new writer owns a turn. Additive nullable columns alone do not make this a
safe rolling deployment. The repository's default Kubernetes rolling strategy
and automatic release-set restoration do not establish this coordination.

Before enabling this release, the deployment owner must demonstrate that all
entry points to `startConversation` and `sendMessage`, and all chat cleanup
invocations, are stopped or drained across every instance. A read-only report
cannot prove that writers have stopped. Do not deploy this migration through an
unmodified rolling/automatic-rollback procedure.

1. Retain a verified backup and the current application/migration identities.
2. Stop new chat admissions and drain existing requests on **all** old writers.
   Keep the rest of the approved maintenance procedure under the environment
   owner's control; this document does not execute a production maintenance.
3. Execute `scripts/sql/chat-turn-preflight-before-0081.sql` using an authorized
   read-only database account. Retain its counts and bounded identifier samples.
   Missing tables, SQL failures and timeouts block acceptance; they are not zero
   findings. Investigate nonzero counts without deleting history, resetting
   counters or relabeling messages to make the report pass.
4. Apply the canonical journal with `pnpm db:migrate`; run `pnpm db:verify` and
   `pnpm db:verify-catalog`. Never use `db:push` to substitute for the migration.
5. Run both preflight SQL files. Confirm the two physical columns are nullable
   `int` and `timestamp(3)`, and that retained histories are unchanged. The normal
   first upgrade leaves both fields null. Do not treat successful DDL as proof
   that every historical conversation satisfies the new writer's invariants.
6. Start only the new writer version. Perform the authorized staging/UI
   acceptance, including a normal send, a concurrent refusal, reopening history
   and independently comparing durable rows/count/context. Record the exact
   commit, database version, settings and evidence before claiming readiness.

The two ALTER statements are separate MySQL DDL operations. If the first succeeds
and the second fails, retain the physical schema, error and journal evidence,
keep writers disabled, and obtain a reviewed forward-recovery procedure. The
canonical runner will refuse a schema ahead of its journal. Blind retries,
invented journal entries, adopting the partial schema, or deleting history are
not recovery steps.

The SQL files run a repeatable-read, read-only transaction. Each SELECT has a
5-second engine execution budget. Counts cover all matching rows; samples stop
at 50 ordered identifiers and exclude messages, names, email addresses and
provider credentials. Store even these identifiers with restricted access. The
post-migration script fixes one database timestamp for its expiry count/sample.

## Invariants and internal fields

| Field or rule      | Meaning                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messageCount`     | Number of persisted transcript rows, including the greeting and an accepted user row whose reply is pending. Maximum 100.                                  |
| `pendingMessageId` | The accepted user row serving as a fencing value. Its ordinary message ID is public; the conversation's pending association is internal.                   |
| `pendingUntil`     | Database-derived expiry, with millisecond precision. Null together with `pendingMessageId` when no turn is pending.                                        |
| Admission          | An authenticated owner locks the current user and conversation in a short transaction, validates history and reserves room for the eventual assistant row. |
| Completion         | Suggestions, assistant row, count, business context and pending-field clearance commit together only while the original claim is still valid.              |
| Overlap            | A second send to the same conversation is refused before adding its transcript row or invoking the provider. Another conversation may progress.            |

The existing 50-active-conversation limit includes the newly created greeting
atomically. Message admission requires space for both the user row and its
eventual assistant row; a conversation already at 99 cannot start another turn.
Historical inconsistencies fail closed and require a reviewed reconciliation
decision. No automatic historical repair is included.

## Time, failures and recovery

The awaited preparation budget is 120 seconds from send entry, and the database
lease is 150 seconds. These are engineering bounds, not approved production
latency objectives. Activity, expiry and archive cutoff use database time.
Provider and flight preparation run outside the chat row transaction.

Abort propagates through the gateway and transport; no further fallback begins
after abort. Already issued or queued database searches, including work inside
an already-started search or hold helper, may outlive the outer wait because
their driver path has no cancellation support. Late preparation
results cannot complete a stale chat claim. This is not a guarantee of exactly
one provider inference, a refunded provider charge or immediate resource release.

Recovery is **lazy**: a subsequent authenticated send or an explicitly invoked
archive completes an expired claim with the friendly failure response once.
History reads do not trigger recovery, and no periodic recovery worker is added.
A dormant interrupted conversation can keep its accepted user row until one of
those entry points runs. Recovery commits even if its reply fills row 100 and
the new message is then refused. Newer claims cannot be overwritten by a late
completion of an older request.

Archiving uses a fixed database cutoff and high-water ID, ascending batches,
and a separate transaction per conversation. It advances past ineligible or
invalid rows, retains already committed progress, and returns actual
`archivedCount` and `failedCount` (per-record errors plus any scan failure).
Inspect failures; zero archived rows alone is
not success. The cleanup wrapper is available but is not registered as a cron
job. Invoking it changes conversation state and needs the relevant operational
authorization and retention decision.

## Client delivery states

| Result                                                               | Delivery meaning                                                                       | Client behavior                                                                                                                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed `CONFLICT`, `TIMEOUT`, `TOO_MANY_REQUESTS` from chat admission | This input was not admitted. Earlier expired-turn recovery may already have committed. | Correct only this optimistic attempt; restore its text if the composer is still current, otherwise retain it as **Not sent** with manual draft recovery. No automatic resend. |
| Typed `PRECONDITION_FAILED` from completion                          | The input was admitted but its completion is stale or expired.                         | Keep the accepted attempt and reconcile authoritative history with request/conversation guards.                                                                               |
| Generic HTTP/transport error, abort or lost response                 | Delivery is unknown.                                                                   | Explain the uncertainty and provide a manual history refresh. Never infer non-admission from an HTTP 408/504 or timeout text.                                                 |

The HTTP request timeout can expire before the preparation budget, and stopping
the client wait does not cancel the server operation. A late result must not
overwrite a newer composer draft, conversation, selection or wait state.
History does not contain all transient hydrated cards or policy language
metadata, so the client must not reconstruct those by interpreting message text.

## Rollback barrier

Prefer forward correction. Before re-enabling any old writer, stop/drain all new
writers and run both preflight scripts again. `chat_pending_count` must be zero;
an expired lease still counts as pending and is not cleared merely by waiting.
Structurally valid pending rows also block rollback. Do not clear pending fields
with ad hoc SQL or allow old writers to finish those turns.

If a pending turn cannot complete normally, a reviewed recovery/archival action
using the new implementation is required before rollback. Archiving active
conversations is a business-visible state change, not a harmless deployment
shortcut. Leave the additive columns in place; removing them is unnecessary for
old-reader compatibility and is not an authorized rollback procedure here.
Retain current migration tooling as well: an old migrator rejects journal 0081
because that entry is absent from its own immutable history. Do not erase the
journal or run old migration tooling as a downgrade.

## Evidence boundary

Native tests use owned MySQL databases and controlled provider promises. Seeded
expired rows prove recovery logic, not actual process termination. Copied-table
preflight tests prove query detection and nonmutation; they do not prove foreign
key behavior or canonical upgrade preservation. Keep canonical migration and
actual interface evidence separate. Local and CI results do not establish
production-data health, operator coordination, live provider acceptance, RPO,
RTO or a completed deployment.
