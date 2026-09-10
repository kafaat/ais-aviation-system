# Forensic review follow-up: resource ownership and SMS

Baseline: `main` v1.22.2, commit `3c3c7fe5302717101e067a05b1983f59cf85477f`.

The baseline review recorded 33 findings. This change addresses G02, G03 and
G33. The other findings retain their original status. The implementation must be
merged and deployed before these fixes can be attributed to a running environment.

## Contracts and consumers

| Finding | Producer / resource                                         | Consumer                                                                       | Enforcement in this change                                                                                                     |
| ------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| G02     | Passenger and booking ownership in `access-control.service` | `apis.submitInfo`, `apis.getMyAPISStatus`, `emergencyHotel.getMyHotelBookings` | Resolve the passenger's parent booking and check its owner before calling the domain service.                                  |
| G02     | Booking ownership in `access-control.service`               | `multiCity.getSegments`, including its REST exposure                           | Check booking ownership before reading itinerary segments.                                                                     |
| G03     | `seat_holds.userId` and current status                      | `inventory.releaseHold`                                                        | Pass the authenticated user ID to the service; condition the write on owner and active status.                                 |
| G03     | `waitlist.userId` and current status                        | `inventory.removeFromWaitlist`                                                 | Only the owner may cancel a waiting or offered entry. The API rejects requested confirmation and expiry.                       |
| G03     | Current waitlist status                                     | `InventoryService.processWaitlist`                                             | A stale candidate list cannot offer an entry that was cancelled before its update.                                             |
| G33     | Configured SMS provider                                     | `sendSMS` and its notification callers                                         | Production requires a real configured provider. Configuration failures return `success: false` and produce failed log entries. |

For the G02 endpoints, the existing shared helper continues to permit platform
administrators (`admin` and `super_admin`) to support another user's booking.
`airline_admin` does not receive that override. Inventory withdrawal endpoints
operate on the authenticated user's own resources.

These are technical ownership rules. The audit did not establish a named
organizational owner for each service. Booking/application security, inventory,
and notifications/platform teams are proposed maintainers and require an actual
assignment by the repository owner.

## Resulting behavior

- An unauthorized resource read or mutation fails before APIS, hotel or itinerary
  service execution. Missing resources return `NOT_FOUND`; ownership denial
  remains `FORBIDDEN` instead of being rewritten as a server failure.
- Hold release and waitlist cancellation repeat safely for the same owner. A
  converted/expired hold or confirmed/expired entry is preserved. Conditional
  writes reject state changes that occurred after the initial read.
- Existing callers can send `reason: "cancelled"` or omit the reason when
  withdrawing from the waitlist. `confirmed` and `expired` are rejected. No direct
  frontend caller of the affected inventory mutations was found in this baseline.
- Production never defaults or falls back to mock SMS. A missing provider,
  unsupported provider, or incomplete Twilio credentials returns failure. An HTTP
  success without a provider message ID also returns failure.
- `sent` indicates provider acceptance, not a handset delivery receipt. Delivery
  confirmation integration remains outside this change.

## Configuration

For production SMS, configure `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER`. No credentials are supplied by this
change. The three API replicas and worker in `docker-compose.production.yml`
forward all four values. The alternate `docker-compose.prod.yml` already loads
the shared production environment file. Kubernetes API/worker deployments load
their settings from `ais-secrets`; include these values when provisioning it.
The staging and production CI deployment steps now populate the same keys from
the GitHub `SMS_PROVIDER` variable and the three `TWILIO_*` secrets. Configure
environment-specific values where the accounts differ. Values enter shell commands
through environment variables rather than direct expression interpolation.

Leaving SMS unconfigured does not prevent application startup. SMS attempts fail
explicitly and are logged as failures. Mock SMS remains available in development
and tests.

## Verification

- 72 targeted tests passed across the three new regression files and the existing
  access-control tests. They cover owners, other users, airline administrators,
  platform administrators, missing records, unavailable ownership storage,
  unauthenticated requests, stale reads, terminal states, provider failures and
  configured-provider success.
- Full TypeScript checking passed.
- The full local test suite passed: 1,419 tests passed and 241 were skipped by
  their existing conditions, across 96 passing and 17 skipped test files.
- The frontend, API bundle and worker bundle built successfully.
- Changed TypeScript files passed ESLint with no errors. Two existing `any`
  warnings remain in unrelated SMS preference code.
- The production Compose file parsed successfully and all four processes were
  verified to receive the SMS configuration keys.

The tests run real routers and relevant ownership/inventory logic with database
doubles. Provider requests are stubbed; no actual SMS was sent. The inventory
double evaluates SQL predicates and supports deterministic state changes between
read and write; it is not a MySQL lock simulator. APIS/hotel domain calls are
stubbed to prove they cannot run before authorization.

Regression files:

- `server/__tests__/passenger-resource-ownership.test.ts`
- `server/__tests__/inventory-owner-mutations.test.ts`
- `server/services/sms.production-boundary.test.ts`

## Remaining audit work

The missing APIS/hotel tables (G01), tenant propagation gaps (G25), dual inventory
models (G09), and provider/booking settlement gaps (G04–G08) are separate findings.
This change does not certify those features for production. The next remediation
should establish the missing schema and canonical booking/inventory/payment
contracts before enabling those affected paths.
