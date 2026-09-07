# Security remediation review — 7 September 2026

Base reviewed: `5788af7ce9e946a0318171f8849d7f2b5edb44bd` (main, v1.20.2).

This is a bounded remediation of three source-confirmed security defects, not a declaration that every item in `PROJECT_GAP_AUDIT_2026-09.md` is closed. The merged Docker and dependency changes from PRs #90 and #91 are preserved.

## Changes

### Mandatory password verification

`server/routers/auth.ts` no longer falls back to an email-only database lookup outside production. Failed credentials, an unavailable authentication service, and an incomplete successful response cannot authorize token or cookie issuance. Login and refresh remain public entry points; successful verification is still required for login.

### Retire unverified payment settlement and migrate the booking page

`payments.create` returns `PRECONDITION_FAILED` for authenticated callers, including administrators. It performs no database access, settlement, booking confirmation, or payment-success audit. A user's ownership or role is not proof that money was collected.

The existing booking page uses `payments.createCheckoutSession`, passes only the booking ID and provider, and redirects to the returned checkout URL. It no longer supplies an amount or announces payment success before provider verification. Legacy API integrations must migrate to provider checkout; manual offline settlement is not implemented by this change.

### Authenticate refund overrides at both layers

The refund router passes the trusted session actor separately from request data. The refund service requires that actor, checks ownership, and permits explicit amounts only for authenticated admins. Overrides must be positive safe integer cents, and both overridden and calculated amounts must not exceed the booking total. A zero amount is rejected rather than silently replaced with the policy amount. Ordinary requests without an amount retain the cancellation-policy calculation.

This is a per-request authorization and amount-validation fix. It does not implement cumulative refund accounting, durable refund idempotency, or transaction-safe inventory restoration.

## Regression coverage

New tests exercise the actual tRPC procedures and refund service with synthetic provider and database doubles. They cover failed login across environment modes, successful verified login, legacy payment rejection without side effects, retained provider checkout and ownership enforcement, refund actor propagation, role enforcement, invalid amounts, and ordinary policy-based refunds. Additional source-contract tests verify the booking page wiring; these are explicitly not browser E2E tests.

Run the focused suite with:

```bash
pnpm exec vitest run server/routers/auth.security.test.ts server/routers/payments.security.test.ts server/routers/refunds.security.test.ts server/services/refunds.security.test.ts server/__tests__/booking-checkout-contract.test.ts
pnpm run check
pnpm lint
```

Execution results, exact tested head, and CI links belong in the pull request. The existence of these tests alone is not a passing result. A temporary branch-only preflight workflow supports formatting and execution where a local dependency install is unavailable; it is removed from the final branch before review completion. No deployment or production credentials are needed.

## Remaining blockers

The refund service still calls Stripe before non-transactional database updates, without durable idempotency or cumulative refund controls. Partial-refund booking lifecycle and seat restoration remain separate repair work.

`payments.createModificationCheckout` still accepts a client-supplied amount; payment-session verification and refund-detail reads also need ownership review. These were not silently declared fixed by disabling the legacy settlement endpoint.

The existing CI workflow still uses `drizzle-kit push --force` for test database setup, unlike production migration replay. Its audit command also tolerates advisory failures with `|| true`; a green security job is not proof of zero vulnerabilities. Migration completeness, public kiosk/bag-drop access, duplicate webhook handling, JWT secret configuration, and tenant isolation remain priorities from the broader audit and require their own source and runtime closure evidence.

Production approval: **not established by this remediation**. Merge and deployment are separate actions; neither is authorized by a passing unit suite alone.
