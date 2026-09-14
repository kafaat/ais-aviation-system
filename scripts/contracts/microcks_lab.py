"""Synthetic Hotelbeds wire fixtures; never a supplier acceptance certificate."""
import copy
import io
import json
import subprocess
import time

import requests
from testcontainers.core.container import DockerContainer

IMAGE = "quay.io/microcks/microcks-uber:1.13.2-native@sha256:e111d1952fa4635dd7f98d0621a52143fe647734d87c5bd9a03c58a1a9c0f8a6"


def document():
    hotel = {"code": 123, "checkIn": "2035-01-01", "checkOut": "2035-01-02", "rooms": [{"code": "SGL.ST", "rates": [{"boardCode": "RO", "rooms": 1}]}]}
    booking = {"reference": "123-456", "clientReference": "HLOCALFIXTURE", "status": "CONFIRMED", "currency": "SAR", "totalNet": 120, "hotel": hotel}
    quote = copy.deepcopy(hotel)
    quote.update(currency="SAR", totalNet=120)
    quote["rooms"][0]["rates"][0].update(rateKey="synthetic-rate-key", rateType="BOOKABLE", net=120, adults=1, children=0, rateComments="Synthetic terms; no supplier offer", cancellationPolicies=[])
    foreign_currency = copy.deepcopy(quote)
    foreign_currency["currency"] = "USD"
    wrong_identity = copy.deepcopy(booking)
    wrong_identity["clientReference"] = "ANOTHERFIXTURE"
    simulation = copy.deepcopy(booking)
    simulation["hotel"]["cancellationAmount"] = 0
    cancelled = copy.deepcopy(simulation)
    cancelled.update(status="CANCELLED", cancellationReference="CANCEL-FIXTURE")

    def operation(examples, method):
        result = {"x-microcks-operation": {"dispatcher": "QUERY_HEADER", "dispatcherRules": "x-fixture-case"}, "parameters": [{"in": "header", "name": "x-fixture-case", "schema": {"type": "string"}, "examples": {name: {"value": name} for name in examples}}], "responses": {"200": {"description": "Synthetic contract reply", "content": {"application/json": {"schema": {"type": "object"}, "examples": {name: {"value": value} for name, value in examples.items()}}}}}}
        if method == "post":
            result["requestBody"] = {"content": {"application/json": {"schema": {"type": "object"}, "examples": {name: {"value": {}} for name in examples}}}}
        return result

    paths = {
        "/hotel-api/1.0/checkrates": {"post": operation({"quote": {"hotel": quote}, "foreign-currency": {"hotel": foreign_currency}}, "post")},
        "/hotel-api/1.0/bookings": {"post": operation({"confirmed": {"booking": booking}, "wrong-identity": {"booking": wrong_identity}}, "post"), "get": operation({"confirmed": {"bookings": {"bookings": [booking]}}}, "get")},
        "/hotel-api/1.0/bookings/{reference}": {"parameters": [{"in": "path", "name": "reference", "required": True, "schema": {"type": "string"}, "example": "123-456"}], "get": operation({"confirmed": {"booking": booking}}, "get"), "delete": operation({"simulation": {"booking": simulation}, "cancelled": {"booking": cancelled}}, "delete")},
    }
    return {"openapi": "3.0.3", "info": {"title": "AISHotelbedsFixture", "version": "1.0"}, "paths": paths}


def verify(root):
    session = requests.Session()
    session.trust_env = False
    with DockerContainer(IMAGE).with_exposed_ports(8080) as container:
        base = f"http://{container.get_container_host_ip()}:{container.get_exposed_port(8080)}"
        for _ in range(120):
            try:
                if session.get(base + "/api/services", timeout=2).status_code == 200:
                    break
            except requests.RequestException:
                pass
            time.sleep(0.5)
        else:
            raise TimeoutError("Microcks did not become ready")
        response = session.post(base + "/api/artifact/upload", params={"mainArtifact": "true"}, files={"file": ("hotelbeds-fixture.json", io.BytesIO(json.dumps(document()).encode()), "application/json")}, timeout=20)
        assert response.status_code == 201, f"Microcks import failed: {response.status_code}"
        subprocess.run(["node", "--import", "tsx", "scripts/contracts/verify-hotelbeds-microcks.ts", base + "/rest/AISHotelbedsFixture/1.0"], cwd=root, check=True, timeout=90)
