# Public Manage Booking

`/manage-booking` accepts the AIS **booking reference**, not the separate PNR,
and the surname of one passenger. The lookup is a POST mutation
(`manageBooking.lookup`, also exposed as `POST /manage-booking/lookup` through
the configured REST adapter). It returns only booking status and itinerary:
flight number, airport code/city/time zone, departure/arrival and sector/flight
status. Cancelled sectors remain explicitly labelled, including historical
sectors from itinerary changes. Historical direct bookings without segment
rows use their parent flight for this read only.

No booking/passenger/account IDs, names, contact details, documents, ticket or
boarding-pass tokens, amounts, payment status or account fields are returned.
The lookup does not create a session or authorize changes or payments. The
existing authenticated, owner-checked account routes remain the authority for
those actions. The public page links to the protected `/my-bookings` journey.

## Tenant binding

The public interface is deployment scoped. Set
`PUBLIC_BOOKING_TENANT_SLUG` to an existing **active** tenant's slug to expose
that airline's bookings. A missing, suspended, pending, malformed or ambiguous
configured tenant fails closed with the same generic lookup error.

If the variable is absent or empty, lookup is explicitly limited to legacy
rows whose `tenantId IS NULL`. NULL is never a wildcard. Booking, surname and
every flight in the returned itinerary must belong to that same scope. If an
authenticated user belongs to a different tenant, the lookup also fails; it
does not silently switch the user's context. A platform account with NULL
tenant is a different scope from an airline tenant.

Neither request parameters nor Host/forwarding headers can select a tenant.
This setting aligns with deployment branding; a shared-host tenant resolver
would need a separately reviewed authoritative mapping before replacing it.
This change requires no database migration.

## Abuse and privacy controls

The existing strict rate-limit service permits **10 requests per IP per
15 minutes**, regardless of login or loyalty tier, and **5 requests per
normalized reference per 15 minutes**, shared across IPs/accounts. Successful
lookups count too. The IP middleware runs for each tRPC batch member, including
invalid input. The reference key is HMAC-derived with the server's JWT secret;
raw reference and surname are not used as rate-limit keys. Unknown reference,
wrong surname, unavailable tenant, deleted booking and ambiguous data receive
the same lookup failure. Production must retain correct `TRUSTED_PROXIES` and
shared Redis configuration: the existing in-memory fallback is per process
and cannot enforce a cross-replica quota during a Redis outage.

The response is `Cache-Control: no-store, private`. The browser sends the
credentials in the request body, never in the URL or browser storage. It does
not retry automatically, clears the surname after success, discards mutation
cache on unmount and provides an explicit clear action. Surname comparison
normalizes Unicode composition, case and repeated spaces, while retaining
accents and punctuation. The result is a limited lookup capability, not
strong identity proof or authorization for private account actions.

## Verification

The focused tests execute the real lookup service/router with the existing
transaction-memory relational test double, including its SQL predicates and
projection. They exercise wrong surname/reference, deleted/ambiguous data,
NULL/configured/foreign/inactive tenant boundaries, foreign passenger/flight
rows, private-field exclusion, rate quotas, HTTP POST-only behavior and
continued authorization of the account PNR route. Client tests check body
submission, generic failure and account handoff. These tests do not claim
live MySQL, distributed Redis, browser-provider or production acceptance.
