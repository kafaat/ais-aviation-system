# DCS seat remapping: protected-state policy

## Engineering decision

The repository permits a compatible seat-layout remap that preserves an
operational block. It refuses a remap that would remove, move, weaken or
incompatibly alter that protected seat. This is the existing behavior of
`remapDeskSeats`; the remediation retains it.

The older OPS-06 workbook criterion says to reject a remap whenever an
operational block exists. That blanket condition conflicts with the existing
compatible-remap behavior. Engineering verification therefore distinguishes
the two cases below. The original criterion remains in
`docs/remediation/coverage-closure-ledger.json` for traceability; passing the
compatible case does not establish literal compliance with the old blanket
wording or acceptance by an operating authority.

| Proposed change                                                                                                                       | Required behavior                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Active layout for the same carrier and assigned aircraft type, with compatible protected seats and unchanged cabin counts             | Permit the remap and retain protected state.                                           |
| Existing blocked or restricted seat at the same seat number, with unchanged cabin, seat type, price, price tier and physical features | Keep its existing status, even when the replacement template calls the seat available. |
| Protected seat removed, renumbered, moved to another cabin, repriced or given incompatible features                                   | Refuse the entire transaction and preserve state.                                      |
| Replacement template introduces a block on a seat that was not already blocked                                                        | Refuse pending inventory reconciliation.                                               |
| Any checked-in seat, check-in nonce or issued boarding pass                                                                           | Refuse pending departure-document reconciliation.                                      |
| Unapproved role, another tenant, inactive/wrong-carrier/wrong-equipment layout, ambiguous or malformed inventory                      | Refuse without remapping.                                                              |
| Repeated identical command key                                                                                                        | Return the original receipt without another event or another state change.             |

## Invariants

The transaction retains cabin seat counts and flight availability. Protected
seat rows retain their identity, booking/passenger ownership and operational
status. A compatible template cannot make a blocked seat available for sale.
If any protected seat is incompatible, every earlier update in the transaction
rolls back. The remap event records the old and new layout IDs and the actor's
reason once per command.

The production code and the native cases in
`scripts/acceptance/dcs-counter-lifecycle.ts` enforce these distinctions. In
particular, the case named “range blocks roll back on conflict, preserve
capacity and survive compatible remap” checks unchanged ownership, cabin and
status, unchanged flight availability, the retained block, and one event on
replay. The refusal matrix includes an incompatible operational block.

## Decision adopted on 2026-11-10

The repository owner adopted this behavior as the operating policy
(see [the decision record](../decisions/2026-11-10-gap-closure-decisions.md)),
with one clarification that the implementation already satisfies: constraints
follow their source. A block attached to a seat stays on that seat number and
is never moved to another seat or released by a replacement template; a
constraint attached to a passenger's assignment stays with that seat's
identity (cabin, type, price, tier and physical features) or the whole remap is
refused. The former OPS-06 blanket wording (refuse any remap whenever a block
exists) is superseded and kept on the ledger row for traceability. OPS-06 is
verified on the accepted source `main@941f86c` by the native cases named
above; no code change was required.

## Operating boundary

A layout being active in the local application does not certify the aircraft,
approve a carrier's equipment-change procedure or authorize physical dispatch.
The accountable carrier/station owner must accept the applicable procedure
and aircraft data before operational use. This document resolves what the
software permits and what its tests must protect; it supplies no external
approval, native execution receipt or final-source CI result.
