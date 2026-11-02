"""Require recorded service ownership before a configured production rollout."""
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2] / "docs" / "architecture"


def verify(assignments, catalog):
    domains = assignments["domains"]
    by_id = {d["id"]: d for d in domains}
    if not domains or len(by_id) != len(domains):
        raise ValueError("Missing or duplicate ownership domains")
    active = [s for s in catalog["services"] if s["lifecycle"] == "active"]
    if not active:
        raise ValueError("No active services to verify")
    fields = ("accountableOwner", "onCall", "acceptanceEvidence")
    unresolved = set()
    for domain in domains:
        if any(not isinstance(domain.get(key), str)
               or not domain[key].strip()
               or domain[key].strip().lower() in {"unassigned", "tbd", "pending", "n/a"}
               for key in fields):
            unresolved.add(domain["id"])
    for service in active:
        name = service["domain"]
        domain = by_id.get(name)
        if (not domain or service["ownershipStatus"] != "assigned"
                or [service.get(key) for key in ("accountableOwner", "onCall", "ownershipAcceptance")]
                != [domain.get(key) for key in fields]):
            unresolved.add(name)
    if unresolved:
        raise ValueError("Production service ownership is incomplete or stale for: "
                         + ", ".join(sorted(unresolved)))


if __name__ == "__main__":
    try:
        verify(json.loads((ROOT / "service-ownership.json").read_text()),
               json.loads((ROOT / "service-catalog.json").read_text()))
    except (ValueError, KeyError) as error:
        sys.exit(str(error))
    print("Production service ownership declarations match the active catalog")
