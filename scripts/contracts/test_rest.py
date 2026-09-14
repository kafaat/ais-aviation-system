"""Generated negative/positive cases and real DB-backed state transitions."""
import json
import os
from pathlib import Path

import requests
import schemathesis
from hypothesis import given, settings, strategies as st
from hypothesis.stateful import RuleBasedStateMachine, initialize, invariant, rule
from schemathesis.generation import GenerationMode

lab = json.loads(Path(os.environ["AIS_CONTRACT_DESCRIPTOR"]).read_text())
schema = schemathesis.openapi.from_dict(lab["schema"])
session = requests.Session()
session.trust_env = False
session.headers["Authorization"] = "Bearer " + lab["tokens"][0]
url = lab["url"] + "/api/rest"
schema.config.update(base_url=url)
schema.config.generation.update(with_security_parameters=False)


def call(path, method="GET", token=None, **kwargs):
    case = schema[path][method].Case(**kwargs)
    headers = {"Authorization": "Bearer " + token} if token else {}
    response = case.call(base_url=url, session=session, headers=headers, timeout=10)
    case.validate_response(response)
    return response


@settings(max_examples=35, deadline=None, derandomize=True)
@given(case=schema["/notifications"]["GET"].as_strategy(generation_mode=GenerationMode.POSITIVE))
def test_generated_positive(case):
    response = case.call(base_url=url, session=session, timeout=10)
    case.validate_response(response)
    assert response.status_code == 200


@settings(max_examples=35, deadline=None, derandomize=True)
@given(case=schema["/notifications"]["GET"].as_strategy(generation_mode=GenerationMode.NEGATIVE).filter(lambda case: set(case.query or {}).issubset({"limit", "offset", "type", "unreadOnly"})))
def test_generated_negative(case):
    response = case.call(base_url=url, session=session, timeout=10)
    case.validate_response(response)


def test_auth_and_fractional_pagination():
    # OpenAPI query parameters are not a closed object. Zod strips unknown keys.
    assert call("/notifications", query={"unknown": "ignored"}).status_code == 200
    for token in ["invalid-fixture-token", ""]:
        response = requests.get(url + "/notifications", headers={"Authorization": "Bearer " + token}, timeout=10)
        assert response.status_code == 401
    for query in [{"limit": 1.5}, {"offset": 0.5}]:
        assert call("/notifications", query=query).status_code == 400


class NotificationLifecycle(RuleBasedStateMachine):
    @initialize()
    def reset(self):
        response = session.post(lab["url"] + "/__contract/reset", headers={"x-lab-reset": lab["resetToken"]}, timeout=10)
        assert response.status_code == 200
        self.unread = set(lab["notificationIds"][0])

    @rule(index=st.integers(min_value=0, max_value=9))
    def read_one(self, index):
        identifier = lab["notificationIds"][0][index]
        response = call("/notifications/{id}/read", "POST", path_parameters={"id": identifier}, body={}, media_type="application/json")
        assert response.status_code == 200 and response.json() == {"success": True}
        self.unread.discard(identifier)

    @rule()
    def read_all(self):
        response = call("/notifications/read-all", "POST", body={}, media_type="application/json")
        assert response.status_code == 200 and response.json() == {"count": len(self.unread)}
        self.unread.clear()

    @rule()
    def foreign_id(self):
        response = call("/notifications/{id}/read", "POST", path_parameters={"id": lab["notificationIds"][1][0]}, body={}, media_type="application/json")
        assert response.status_code == 404

    @invariant()
    def counts_and_isolation(self):
        assert call("/notifications/unread-count").json() == {"count": len(self.unread)}
        assert call("/notifications/unread-count", token=lab["tokens"][1]).json() == {"count": 1}
        rows = call("/notifications", query={"unreadOnly": "true"}).json()
        assert {row["id"] for row in rows} == self.unread
        assert all(row["userId"] == lab["userIds"][0] for row in rows)


TestNotificationLifecycle = NotificationLifecycle.TestCase
TestNotificationLifecycle.settings = settings(max_examples=8, stateful_step_count=15, deadline=None, derandomize=True)
