"""Read-only HTTP checks for the deployed AIS web application."""
import argparse
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import json
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class ProbeFailure(Exception):
    pass


def require(condition, message):
    if not condition:
        raise ProbeFailure(message)


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class EntryPage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.root = False
        self.module = None

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "div" and values.get("id") == "root":
            self.root = True
        if tag == "script" and values.get("type") == "module" and values.get("src"):
            self.module = values["src"]


class Site:
    def __init__(self, base):
        self.base = base.rstrip("/") + "/"
        self.http = build_opener(NoRedirects())

    def get(self, path, status=200, headers=None, max_time=None, sample=False):
        url = urljoin(self.base, path)
        origin = urlsplit(url)
        target = urlsplit(self.base)
        require((origin.scheme, origin.netloc) == (target.scheme, target.netloc),
                "Entry point references a different origin")
        started = time.monotonic()
        try:
            try:
                response = self.http.open(Request(url, headers=headers or {}), timeout=10)
            except HTTPError as error:
                response = error
            with response:
                require(response.status == status,
                        f"{origin.path} returned HTTP {response.status}, expected {status}")
                body = response.read(128 if sample else 8 * 1024 * 1024 + 1)
                require(len(body) <= 8 * 1024 * 1024, f"{origin.path} response exceeded probe limit")
                if max_time is not None:
                    require(time.monotonic() - started < max_time,
                            f"{origin.path} exceeded its {max_time}s response budget")
                return body, response.headers
        except (URLError, OSError) as error:
            raise ProbeFailure(f"{origin.path} transport unavailable ({type(error).__name__})") from None

    def query(self, name, payload=None, error=None, **options):
        path = "api/trpc/" + name
        if payload is not None:
            path += "?" + urlencode({"input": json.dumps({"json": payload})})
        raw, headers = self.get(path, **options)
        try:
            envelope = json.loads(raw)
            if error is not None:
                require(envelope["error"]["json"]["data"]["code"] == error,
                        f"{name} returned the wrong tRPC error")
                return None, headers
            return envelope["result"]["data"]["json"], headers
        except (ValueError, KeyError, TypeError):
            raise ProbeFailure(f"{name} returned an invalid tRPC envelope") from None


def check_site(site, mode):
    attempts = 10 if mode == "smoke" else 1
    for attempt in range(attempts):
        try:
            live, _ = site.query("health.live", max_time=0.5 if mode == "smoke" else None)
            require(live == {"alive": True}, "Liveness is false")
            break
        except ProbeFailure:
            if attempt + 1 == attempts:
                raise
            time.sleep(5)
    ready, _ = site.query("health.ready")
    require(ready == {"ready": True}, "Dependencies are not ready")
    print("PASS API liveness and readiness")

    html, headers = site.get("", max_time=3 if mode == "smoke" else None)
    require(headers.get_content_type() == "text/html", "Homepage did not return HTML")
    page = EntryPage()
    page.feed(html.decode("utf-8"))
    require(page.root and page.module, "Homepage lacks the AIS root or JavaScript entry point")
    asset, headers = site.get(page.module, headers={"Accept-Encoding": "gzip"}, sample=True)
    require(asset and headers.get_content_type() in ("text/javascript", "application/javascript"),
            "Referenced JavaScript asset is missing or has the wrong content type")
    print("PASS HTML entry and referenced JavaScript asset")
    if mode == "critical":
        if headers.get("Content-Encoding", "").lower() == "gzip":
            require(asset.startswith(b"\x1f\x8b"), "Incorrect gzip encoding on JavaScript asset")
            print("PASS gzip response")
        else:
            print("SKIP gzip compression was not negotiated on this deployment")

    for route in ("bookings.myBookings", "admin.getMetrics"):
        site.query(route, status=401, error="UNAUTHORIZED")
    print("PASS anonymous access denied on booking and admin procedures")

    airports, _ = site.query("reference.airports")
    require(isinstance(airports, list), "Invalid airport catalog")
    require(all(isinstance(row, dict) and type(row.get("id")) is int and row["id"] > 0
                for row in airports), "Invalid airport identifiers")
    ids = list(dict.fromkeys(row["id"] for row in airports))
    site.query("flights.search", {}, status=400, error="BAD_REQUEST")
    print("PASS invalid flight search rejected")
    if len(ids) >= 2:
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
        rows, _ = site.query("flights.search", {
            "originId": ids[0], "destinationId": ids[1], "departureDate": tomorrow})
        require(isinstance(rows, list) and all(isinstance(row, dict) and
                isinstance(row.get("flightNumber"), str) for row in rows),
                "Invalid flight search response")
        print("PASS search using deployed airport IDs and a UTC calendar date")
    else:
        print("SKIP positive flight search requires two distinct airports in the deployed catalog")

    if mode == "critical":
        user, headers = site.query("auth.me", headers={"Origin": "https://probe.invalid"})
        require(user is None, "Anonymous auth.me returned an identity")
        require(headers.get("Access-Control-Allow-Origin") not in ("*", "https://probe.invalid"),
                "Unrelated origin allowed on identity response")
        # Express emits these on production requests. Non-production loopback
        # deliberately bypasses the middleware and cannot prove this contract.
        numbers = {}
        for field in ("Limit", "Remaining", "Reset"):
            name = f"X-RateLimit-{field}"
            raw = headers.get(name, "")
            require(raw.isascii() and raw.isdecimal(), f"Invalid or missing quota header {name}")
            numbers[field] = int(raw)
        require(numbers["Limit"] > 0 and numbers["Remaining"] <= numbers["Limit"]
                and numbers["Reset"] > 0, "Inconsistent production quota values")
        require(headers.get("X-RateLimit-Tier") == "anonymous",
                "Anonymous response lacks the anonymous quota tier")
        print("PASS anonymous identity, cross-origin restrictions and quota headers")
        site.query("invalid.endpoint", status=404, error="NOT_FOUND")
        print("PASS unknown procedure returns a tRPC 404")
        statuses, _ = site.query("flights.statusBatch", {"ids": [1]})
        require(isinstance(statuses, list), "Invalid flight status response")
        print("PASS deployed flight status polling procedure")
        print("SKIP WebSocket availability: the production client polls flights.statusBatch")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("smoke", "critical"))
    parser.add_argument("base_url")
    args = parser.parse_args()
    try:
        check_site(Site(args.base_url), args.mode)
    except (ProbeFailure, ValueError) as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
