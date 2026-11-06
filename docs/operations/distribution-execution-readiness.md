# GDS, NDC and interline execution boundaries

Reviewed against the integrated remediation baseline on 5 November 2026. These
are application execution gates. They do not establish provider connectivity,
carrier certification, contract acceptance or successful external fulfillment.

## Inspectable capabilities

| Procedure                          | Local capability                                                               | External execution                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `gds.getExecutionCapability`       | Configuration records and explicitly enabled nonproduction simulations         | Unavailable: no accepted GDS adapter                                        |
| `ndc.getExecutionCapability`       | Local AIS direct offers and orders                                             | Unavailable: no accepted external carrier/seller adapter                    |
| `ndc.lookupCapability`             | Action-specific local servicing checks; descriptive published carrier metadata | Published support does not enable an external operation                     |
| `interline.getExecutionCapability` | Agreement configuration, local eligibility and proration planning              | Unavailable: no accepted partner ticketing, baggage or settlement transport |

### GDS

Every executable GDS method remains guarded by the explicit demo capability.
Production refuses execution even if `AIS_ENABLE_DEMOS=true`, a connection is
marked active, its support flags are enabled, and credentials are present.

Successful simulator responses now carry `execution: simulation` and
`providerContacted: false`. These fields are retained by the router output
allowlists. Direct booking, ticket, cancellation and availability results carry
the same markers. Health messages and operation logs explicitly identify their
synthetic nature. The simulated latency is not a measured provider response,
and a synthetic PNR or ticket number is not provider issuance evidence.

### NDC

The public shopping and creation routes continue to use local AIS inventory.
Their service boundaries now reject an external channel or any non-null
distributor identifier, including a distributor literally named `AIS` or an
empty identifier. Calling the service directly cannot bypass this check.

Order creation also validates the persisted offer rather than trusting a caller's
`direct` label. It requires the direct channel and the known local `21.3` payload
version before booking or inventory mutation. Offer generation cannot claim a
different issuing carrier, and issuance rejects a segment operated by a carrier
different from the offer's carrier. External-origin orders cannot be cancelled
through the local cancellation path. Existing local invoice, ownership, payment,
inventory and servicing checks continue to apply.

Historical offers with a missing, malformed or unknown issuance version are
blocked. Do not add a version label to historical data merely to make it pass.
Regenerate an offer through the supported local generator, or reconcile its
original issuer and representation using separate verified evidence. The two
disposable native acceptance fixtures that construct local offers directly now
include `ndcVersion: "21.3"`, matching the real generator's output.

The local order begins pending. External booking/ticket/EMD acceptance, payment
settlement and any later financial recognition have separate authorities.

### Interline

`checkEligibility.data.eligible` retains its documented meaning: the two airlines
have a currently active local agreement. Activation and eligibility responses
now include a separate `execution` object with
`scope: local_agreement_planning` and `externalExecutionAvailable: false`.
This preserves local planning callers while preventing the response from being
presented as accepted partner execution. Local proration remains a calculation;
it does not establish external settlement.

No browser consumer of the interline eligibility procedure was identified in
the inspected client source. Consumers added later must retain this distinction
and must not turn local agreement eligibility into a fulfillment control.

## Remaining external acceptance inputs

An executable provider integration requires an installed adapter and accepted
bindings for environment, tenant/operator, carrier, seller and the specific
operation. Retain authoritative booking/order/ticket/EMD identifiers, authenticated
responses, and reconciliation evidence for duplicate requests, timeout, lost
response, cancellation, reissue and refunds. Interline additionally needs partner
acceptance for the applicable routes, through-checked baggage and settlement
obligations. An environment boolean or locally active agreement cannot supply
these prerequisites.

The focused tests use synthetic GDS results and local relational fixtures. They
make no provider calls. Native transaction and full-repository gates run at the
integration layer; neither those gates nor this document certify live carrier
delivery.

For APIS and Type B queue, simulation, lease and acknowledgment semantics, see
[operational messaging acceptance](operational-messaging-acceptance.md).
