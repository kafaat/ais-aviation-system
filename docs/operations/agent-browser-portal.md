# Session-based agent portal

`/agent` is protected by the existing account login journey. The `agentPortal`
router uses the authenticated session to list active agencies whose
`ownerUserId` is the current user. Neither the browser nor these endpoints
accept agency API keys/secrets or a caller-selected owner or tenant.
Agency assignment remains an administrator operation; the portal does not
claim or relink an agency.
Responses are marked `no-store, private`; the page does not persist command
or passenger data in browser storage and discards its query/mutation cache
when the corresponding views are unmounted.

Every operation rechecks the database account, current tenant, the existing
account lock/deletion guard, active tenant and active agency ownership. A
platform account with NULL tenant sees only NULL-tenant inventory/bookings.
There is no administrator bypass in these owner routes. There is no new email
verification flag: the existing authenticated session is the account proof.

## Search and booking

The portal offers direct one-flight reservations for 1–9 passengers, economy
or business. Search applies the exact tenant, origin/destination, origin-local
calendar day, future departure, scheduled/delayed status and party-size
constraints. It subtracts canonical and unlinked legacy inventory holds using
the existing read-only capacity helper. Search returns at most 100 candidate
flights per day and does not call the legacy API search that lacks tenant and
party predicates. Displayed SAR prices are the recorded adult base fare;
server-priced passenger totals are reviewed at checkout.

Reservation commands delegate to the existing `createAgentBooking` authority:
its pricing, transaction, inventory holds, passenger records, agency limits,
commission ledger and durable idempotency result are retained. The optional
`expectedOwner` argument binds a browser command to its authenticated user
and tenant without changing existing API-key callers. The agency lock,
current account/tenant checks and idempotency claim/replay use the **same
transaction/connection**. The guard runs before cached replay too. New
session commands also check exact flight tenancy, including NULL, under the
flight lock. A relink between initial validation and locked execution fails
instead of creating a booking for a replacement owner.
The replacement owner cannot replay or reuse a command key recorded for the
previous owner; a new reservation requires its own command key.

The browser freezes the complete in-memory payload and UUID on submission,
including the agency and passenger snapshot. Search, flight/agency selection
and draft fields stay locked after transport, internal or conflict errors;
retries send that exact snapshot. A background agency-list refresh cannot
discard the unresolved workspace. Editing resumes only after a definitive
first-attempt validation, authorization, missing-resource, precondition or
quota rejection. A rejection after an earlier ambiguous response cannot rule
out the original commit and therefore does not unlock the command. Duplicate
pending submissions are blocked, and success opens `/checkout/:id`.
The key is not persisted across page reloads; after reloading an uncertain
submission the operator must consult the owner-scoped booking list before
creating another reservation. No payment provider is called by the portal's
reservation endpoint. Existing checkout ownership and settlement controls
remain authoritative.

The portal does not collect editable contact fields that the booking authority
would ignore. The existing agency contact snapshot satisfies the unchanged
agent command contract and request hash; it does not create new passenger
contact records or add a contact delivery/notification promise.

## Booking list and statistics

The agency ledger is intersected with bookings owned by the current account,
the exact tenant, nondeleted records and same-tenant flights before either
rows or totals are returned. A replacement agency owner does not acquire the
previous owner's bookings or aggregate totals. The page displays 20 rows at
a time. Statistics describe recorded booking value/commission, not collected
funds or settled commission. This read implementation loads the agency ledger
to apply ownership before pagination and should be query-optimized before
serving exceptionally large historical agency ledgers.

This change does not add agency multi-sector bookings, operational DCS/APIS,
named-fare selection or a provider payment acceptance claim. Those use their
separate existing or concurrently owned workflows.
