"""Production admission checks committed ownership; fixture names are synthetic."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "service_ownership", Path(__file__).resolve().parents[1] / "deploy/verify_service_ownership.py")
service_ownership = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service_ownership)


class ServiceOwnershipTest(unittest.TestCase):
    def setUp(self):
        self.domain = {"id": "test-domain", "accountableOwner": "test owner",
                       "onCall": "test rotation", "acceptanceEvidence": "test receipt"}
        self.assignments = {"domains": [self.domain]}
        self.service = {"domain": "test-domain", "lifecycle": "active", "ownershipStatus": "assigned",
                        "accountableOwner": "test owner", "onCall": "test rotation",
                        "ownershipAcceptance": "test receipt"}
        self.catalog = {"services": [self.service]}

    def test_accepts_matching_declarations(self):
        service_ownership.verify(self.assignments, self.catalog)

    def test_rejects_incomplete_operating_assignments(self):
        for key in ("accountableOwner", "onCall", "acceptanceEvidence"):
            for invalid in (None, " ", "TBD"):
                with self.subTest(key=key, invalid=invalid), self.assertRaises(ValueError):
                    service_ownership.verify({"domains": [{**self.domain, key: invalid}]}, self.catalog)

    def test_rejects_stale_or_unassigned_catalog_entries(self):
        for patch in ({"ownershipStatus": "unassigned"}, {"onCall": "old"}, {"domain": "unknown"}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                service_ownership.verify(self.assignments, {"services": [{**self.service, **patch}]})

    def test_rejects_empty_domain_or_service_set(self):
        for data, catalog in (({"domains": []}, self.catalog), (self.assignments, {"services": []})):
            with self.assertRaises(ValueError):
                service_ownership.verify(data, catalog)
