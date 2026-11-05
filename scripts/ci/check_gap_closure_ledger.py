#!/usr/bin/env python3
"""Fail-closed integrity check for the AIS gap and report closure ledgers."""
import json
from collections import Counter
from pathlib import Path

root = Path(__file__).resolve().parents[2]
ledger = json.loads((root / "docs/remediation/coverage-closure-ledger.json").read_text())
catalog = json.loads((root / "docs/audits/reporting-completion-20261104/catalog.json").read_text())
rows = ledger["findings"]
assert len(rows) == 38, "Expected 38 original findings"
assert len({row["id"] for row in rows}) == 38, "Duplicate finding ID"
assert Counter(row["priority"] for row in rows) == {"P1": 33, "P2": 5}
allowed = {"needs_current_sha_verification", "verified", "partial", "blocked"}
for row in rows:
    assert row["status"] in allowed, f"Unknown status: {row['id']}"
    if row["status"] == "verified":
        assert row.get("accepted_sha") and len(row["accepted_sha"]) == 40, row["id"]
        assert str(row.get("acceptance_run") or "").startswith("https://github.com/"), row["id"]
        assert row["accepted_sha"] == ledger["source_revision"], row["id"]
report_rows = catalog["rows"]
assert len(report_rows) == 99
assert len({row["id"] for row in report_rows}) == 99
counts = Counter(row["availability"] for row in report_rows)
assert counts == {"available": 36, "partial": 35, "blocked": 28}, counts
assert ledger["report_catalog"]["promotions_verified"] == 0, "Promotion requires separate evidence review"
print("PASS: 38 distinct gaps, evidence guards, and 99 source-honest report classifications")
