# ADR 0002: AIS as a multi-tenant platform with three operating modes

- **Status:** Proposed. Recorded on 10 November 2026 from the recommendation
  forwarded by the repository owner with the multi-currency planning; the
  owner adopts it by stating so on #319. Nothing in this document is
  implemented by its acceptance; it fixes the target shape so that currency,
  permission and accounting work in #319 is not redesigned when the first
  external airline is onboarded.
- **Date:** 10 November 2026, written against `main@b9addba`.
- **Deciders:** repository owner. Domain ownership remains unassigned in
  `docs/architecture/service-ownership.json`; this ADR does not invent owners.

## Context

AIS already carries a `tenants` table as its isolation boundary and
tenant-scoped procedures in departure control, baggage and settlement (see the
capability table in CLAUDE.md). The owner's question for the multi-currency
work was whether AIS is an independent technology platform sold to several
airlines, or a system dedicated to one airline, because the final financial
accountability differs between the two.

The answer recorded here is both, by design: one software core, several
tenants, and three distinct roles that AIS or its operating company may hold.

## Decision

AIS is designed as an independent multi-tenant platform that can be operated
in three modes, with legal, financial and operational roles and approval
authority kept separate while a single extensible core is retained.

| Mode                          | What it means                                                                                                            | What it does not grant                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Technology provider           | Develops reservations, ticketing, pricing, payments, departure control and reporting and offers them to several airlines | No commercial, financial or operational authority over a tenant airline                                                                                |
| Managed-service operator      | Runs some operations for an airline under contract and delegated permissions                                             | Does not become the legal air carrier                                                                                                                  |
| Airline operator (own tenant) | Sells carriage in its own name as a tenant of the same core, as a real or trial airline                                  | The software licence confers no operating authority; an air operator certificate and the applicable national approvals are separate regulatory matters |

Each tenant has its own configuration, financial data, users, contracts and
providers. The engine is shared; the data, settings, ledgers and approvals are
not.

### Division of responsibility

| Area                      | AIS platform                               | Tenant airline                                      |
| ------------------------- | ------------------------------------------ | --------------------------------------------------- |
| System development        | CTO / head of engineering                  | Reviews requirements and acceptance                 |
| Reservation policies      | Provides the rules engine                  | Reservations or product manager                     |
| Fares                     | Implements the pricing engine              | Revenue-management and pricing manager              |
| Base currency             | Provides the tenant-scoped setting         | Decides the approved currency for the organisation  |
| Accounting and settlement | Implements integrations and ledgers        | CFO and financial controller                        |
| Payments                  | Integrates providers                       | Merchant-account holder and finance officer         |
| Flight operations         | Provides DCS and operational tools         | Flight-operations manager and the licensed operator |
| Information security      | Protects the shared platform               | Controls its own permissions and data               |
| Acceptance and release    | Tests and accepts the software technically | Accepts operational readiness                       |

### Three rules that are not negotiable

1. **Tenant independence.** No airline can read another airline's bookings,
   ledgers or passenger data. Central AIS support access is scoped,
   time-limited and audited.
2. **Separation of financial responsibility.** Funds of different airlines are
   never pooled in one settlement ledger without an explicit separation of
   the owner of the funds, the legal merchant and the settlement documents.
   If AIS itself receives payments, its contractual and regulatory position
   and its PCI DSS obligations are assessed first.
3. **Technical acceptance is not operational approval.** Passing the
   platform's tests does not mean a tenant airline holds operational
   approval, payment-provider acceptance or airport acceptance.

## Consequences

- Multi-currency (#319) is specified per tenant from the start: default
  pricing currency, approved currency list, FX policy and accounting currency
  are tenant-scoped settings with audit, not global constants.
- Permission design distinguishes platform administrators, tenant
  administrators, finance approvers and ordinary users before any currency
  setting is exposed.
- The functional (accounting) currency of each entity follows its primary
  economic environment under IAS 21 and is set by that entity's finance
  function, not by a user-interface choice.
- This is the target shape, not a claim that tenant isolation, licensing or
  payment separation are complete in the current code. Closing the gap is an
  audit of existing capabilities followed by targeted changes, not a second
  system.

## Alternatives considered

- **Single-airline system.** Simpler permissions and accounting, but every
  later tenant would force a redesign of currency, ledger ownership and
  approvals.
- **Platform only, never an operator.** Clean, but it excludes the owner's
  stated option of running an affiliated or trial airline on the same core.
