# Alternative payment readiness

The registry contains eight alternative HTTP adapters: HyperPay, Tabby, Tamara,
STC Pay, FloosAk, Jawali, OneCash, and EasyCash. Their presence is implementation
inventory. It is not accepted settlement or refund capability.

All eight remain unavailable. Credentials, environment selection, successful-looking
HTTP payloads, and the open provider boundary cannot activate them. Registry
selection and direct adapter checkout, verification, and refund entrypoints require
the same financial acceptance gate before any HTTP request. Their own `getInfo()`
results, registry metadata, and the available-provider listing consistently report
`enabled: false` and `integrationState: "unverified"`.

The existing configured Stripe route remains selectable. `implemented` describes
the integrated code path; it does not certify a live merchant account or external
production acceptance. Provider readiness inspection is local and does not probe
credentials or contact payment endpoints.

## Why the direct guard matters

Previously, registry selection rejected the eight alternatives but raw adapters
returned by `getAllProviders()` reported availability from credential presence.
Direct adapter methods could issue HTTP requests, including refund requests, despite
the central denial. The shared acceptance guard now covers those entrypoints too.
This correction does not validate or activate their dormant request/response mappings.

## Evidence required before activation

Each provider needs its own accepted, versioned contract and negative-case evidence:

- Immutable invoice/session identity linked to the intended tenant, booking and owner.
- Exact captured amount and currency, including minor-unit rules and partial outcomes.
- Authenticated webhook and authoritative settlement evidence; an authorization or
  successful transport response alone cannot confirm a booking.
- Stable operation identities across retries, duplicate and reordered events, timeouts,
  ambiguous responses, and late outcomes.
- Refund request identity, actual success evidence, cumulative limits, and the same
  funding/refund authority used by the booking and wallet boundaries.
- Verified user-facing availability and checkout behavior after the accepted integration
  is enabled in code.

No environment flag enables an unverified adapter. There is no test-only live bypass.
`server/__tests__/payment-provider-readiness.test.ts` checks all eight with synthetic
credentials and a stubbed successful-looking transport, and requires zero requests.
Those tests prove the denial/readiness contract, not an external provider contract.
