# Flight consumer records and privacy operations

The account export includes three distinct consumer record families. A route
favorite (`favorite_flights`) is different from an individual saved flight
(`user_flight_favorites`). Both are exported with their persisted owner predicate.
`flight_reviews` contains the author's review; `flight_review_helpful_votes`
contains the authenticated user's later helpful-vote choices. The latter is
exported as `reviewHelpfulVotes`, using keyset pagination like the other personal
records. No other customer's vote identity is returned in public review output.

The migration contract currently supports columns and indexes, not foreign-key
constraints. Review deletion locks the owned review row, removes its votes, and
deletes the review in one transaction using the same lock order as helpful
voting. Its unique `(reviewId, userId)` key provides retry deduplication, not a
retention policy. Historical `helpfulCount` values remain unchanged because old
voter identities cannot be reconstructed from an aggregate count.

Account erasure remains subject to the existing `RETENTION_REVIEW_REQUIRED`
workflow in `server/services/gdpr.service.ts`. Adding this table does not approve
financial or passenger-record erasure, remove another traveler's information, or
mark a blocked deletion request complete. The privacy owner must include these
consumer tables in the approved data-subject and retention inventory before
enabling the broader erasure workflow. No legal retention duration is invented
by this change.

## Pending migration correction

The first local migration attempt on 5 November rejected the foreign-key
proposal with `UNSUPPORTED_CONTRACT` before executing any DDL. Migration 0071
was still unpublished and unapplied. A follow-up commit corrects that pending
migration and snapshot to the established contract; it does not alter any
applied migration, suppress the verifier, or bypass schema drift checks. The
failed receipt remains in the forensic evidence.
