"""AIS station client. See docs/operations/honeywell-station.md."""
import argparse
import hashlib
import http.client
import json
import os
import re
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone
from getpass import getpass
from pathlib import Path
from urllib.parse import urlsplit

from win_spool import open_queue, send_raw


SHARES = {"boarding-pass": "HWBP", "bag-tag": "HWBT"}


def field(value, pattern):
    if not isinstance(value, str) or not re.fullmatch(pattern, value, re.ASCII):
        raise ValueError("Invalid AIS document field")
    return value


def epl_string(value):
    # ESim quoted strings escape quotes and backslashes. Never pass command separators.
    field(value, r"[ -~]+")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def render(kind, document, auth, requested_tag=None):
    if kind == "bag-tag":
        if (document["printStatus"] != "document_ready" or document["totalBags"] != 1
                or len(document["bagTags"]) != 1):
            raise ValueError("Expected exactly one registered bag")
        bag = document["bagTags"][0]
        symbol = field(bag["tagNumber"], r"[0-9]{10}")
        if (symbol != requested_tag or symbol != bag["barcodeData"] or bag["printedAt"] is not None
                or bag["bookingReference"] != auth["bookingReference"]
                or bag["flightNumber"] != auth["flightNumber"]):
            raise ValueError("Bag does not match the requested document")
        origin = field(bag["origin"], r"[A-Z]{3}")
        dest = field(bag["destination"], r"[A-Z]{3}")
        flight = field(bag["flightNumber"], r"[A-Za-z0-9 -]{2,12}")
        lines = [
            'A32,16,0,3,1,1,N,"AIS BAG TAG"',
            f'A32,52,0,3,1,1,N,"{origin} - {dest}  {flight}"',
            f'B32,100,0,2,3,7,120,N,"{symbol}"',
            f'A32,240,0,4,1,1,N,"{symbol}"',
        ]
    elif kind == "boarding-pass":
        bp = document["boardingPass"]
        if (bp["bookingReference"] != auth["bookingReference"]
                or bp["flight"]["number"] != auth["flightNumber"]):
            raise ValueError("Boarding pass does not match the requested flight")
        # Use AIS's signed single-leg payload verbatim. The station never issues a pass.
        symbol = field(bp["bcbp"], r"M1[ -~]{58,250}\^140[0-9a-fA-F]{64}")
        origin = field(bp["origin"]["code"], r"[A-Z]{3}")
        dest = field(bp["destination"]["code"], r"[A-Z]{3}")
        if symbol[30:36] != origin + dest:
            raise ValueError("Boarding pass route mismatch")
        flight = field(bp["flight"]["number"], r"[A-Za-z0-9 -]{2,12}")
        seat = field(bp["seat"], r"[A-Za-z0-9]{1,4}")
        departure = datetime.fromisoformat(bp["flight"]["departureTime"].replace("Z", "+00:00"))
        if departure.tzinfo is None:
            raise ValueError("Missing departure time zone")
        time = departure.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
        lines = [
            'A24,12,0,3,1,1,N,"AIS BOARDING PASS"',
            f"A24,44,0,3,1,1,N,{epl_string(symbol[2:22].rstrip())}",
            f'A24,76,0,3,1,1,N,"{origin} - {dest}  {flight}  SEAT {seat}"',
            f'A24,108,0,3,1,1,N,"DEP UTC {time}"',
            f"b24,154,P,590,240,s5,f0,x2,y6,{epl_string(symbol)}",
        ]
    else:
        raise ValueError("Unknown document type")
    return ("N\n" + "\n".join(lines) + "\nP1\n").encode("ascii"), symbol


def kiosk_call(origin, method, payload):
    # Use only the configured HTTPS host. A redirect never receives the capability.
    with closing(http.client.HTTPSConnection(origin, timeout=20)) as conn:
        conn.request("POST", "/api/trpc/kiosk." + method, json.dumps({"json": payload}),
                     {"Content-Type": "application/json"})
        res = conn.getresponse()
        if res.status != 200:
            raise ValueError(f"AIS refused {method} (HTTP {res.status})")
        body = res.read(131073)
        if len(body) > 131072:
            raise ValueError("Oversized AIS response")
        return json.loads(body)["result"]["data"]["json"]


def fetch_document(origin, kind, ref, surname, passenger, flight, tag, call=kiosk_call):
    auth = call(origin, "authenticate", {"bookingRef": ref, "lastName": surname, "flightId": flight})
    if (ref not in (auth["bookingReference"], auth["pnr"])
            or passenger not in [p["id"] for p in auth["passengers"]]):
        raise ValueError("Passenger is outside the authenticated booking")
    payload = {"capabilityToken": auth["capabilityToken"], "passengerId": passenger, "flightId": flight}
    if kind == "bag-tag":
        payload.update(tagNumbers=[field(tag, r"[0-9]{10}")], bagCount=1)
    result = call(origin, "printBagTag" if kind == "bag-tag" else "printBoardingPass", payload)
    data, symbol = render(kind, result, auth, tag)
    # Binding to the booking/sector is stable even if a freshly-issued pass changes.
    key = digest(json.dumps([origin, kind, auth["bookingId"], passenger, flight, tag]))
    return key, data, symbol


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def journal(path):
    db = sqlite3.connect(path)
    db.execute("""CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, kind TEXT NOT NULL,
        scan_hash TEXT NOT NULL, started TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        windows_id INTEGER, queued TEXT, scan_matched TEXT)""")
    return db


def submit(db, kind, key, data, symbol, open_printer=open_queue, send=send_raw):
    # Opening a missing share cannot start a job. Never fall back to a default queue.
    with open_printer(SHARES[kind]) as handle:
        with db:
            row = db.execute("""INSERT INTO jobs(request_key,kind,scan_hash) VALUES(?,?,?)
                ON CONFLICT(request_key) DO NOTHING RETURNING id""", (key, kind, digest(symbol))).fetchone()
            if not row:
                previous = db.execute("SELECT id FROM jobs WHERE request_key=?", (key,)).fetchone()
                raise ValueError(f"Already attempted. Inspect receipt {previous[0]} and the queue before reprinting.")
        receipt = row[0]

        def record_job_id(job_id):
            with db:
                db.execute("UPDATE jobs SET windows_id=? WHERE id=?", (job_id, receipt))

        try:
            send(handle, data, receipt, record_job_id)
            with db:
                db.execute("UPDATE jobs SET queued=CURRENT_TIMESTAMP WHERE id=?", (receipt,))
        except Exception as exc:
            raise RuntimeError(f"Receipt {receipt}: spool outcome uncertain. Inspect queue and stock.") from exc
        return receipt


def check_scan(db, receipt, scanned):
    with db:
        row = db.execute("SELECT scan_hash FROM jobs WHERE id=?", (receipt,)).fetchone()
        if not row or digest(scanned) != row[0]:
            raise ValueError("Unknown receipt or scan mismatch")
        db.execute("UPDATE jobs SET scan_matched=COALESCE(scan_matched,CURRENT_TIMESTAMP) WHERE id=?", (receipt,))


def status(db, receipt):
    row = db.execute("SELECT kind,started,windows_id,queued,scan_matched FROM jobs WHERE id=?", (receipt,)).fetchone()
    if not row:
        raise ValueError("Unknown receipt")
    return dict(receipt=receipt, share=SHARES[row[0]], attemptedUtc=row[1], windowsJobId=row[2],
                queuedUtc=row[3], operatorScanMatchedUtc=row[4])


def station_host(value):
    parts = urlsplit(value)
    if (parts.scheme != "https" or not parts.hostname or parts.username is not None
            or parts.password is not None or parts.path not in ("", "/") or parts.query or parts.fragment):
        raise ValueError("Configure AIS_STATION_ORIGIN as the AIS HTTPS origin")
    host = parts.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    return host if parts.port in (None, 443) else f"{host}:{parts.port}"


def main():
    parser = argparse.ArgumentParser(description="AIS Honeywell Windows print station")
    actions = parser.add_subparsers(dest="action", required=True)
    for kind in SHARES:
        action = actions.add_parser(kind)
        action.add_argument("--passenger-id", type=int, required=True)
        action.add_argument("--flight-id", type=int, required=True)
    for name in ("scan", "status"):
        actions.add_parser(name).add_argument("receipt", type=int)
    args = parser.parse_args()
    if os.name != "nt":
        raise ValueError("Run the station client on Windows")
    folder = Path(os.environ["LOCALAPPDATA"]) / "AIS" / "HoneywellStation"
    folder.mkdir(parents=True, exist_ok=True)
    with closing(journal(folder / "receipts.sqlite")) as db:
        if args.action in SHARES:
            origin = station_host(os.getenv("AIS_STATION_ORIGIN", ""))
            if min(args.passenger_id, args.flight_id) < 1:
                raise ValueError("Passenger and flight IDs must be positive")
            ref = getpass("Booking reference or PNR: ").strip().upper()
            surname = getpass("Passenger surname: ").strip()
            tag = getpass("Registered 10-digit tag: ") if args.action == "bag-tag" else None
            result = fetch_document(origin, args.action, ref, surname, args.passenger_id, args.flight_id, tag)
            receipt = submit(db, args.action, *result)
        else:
            receipt = args.receipt
            if args.action == "scan":
                check_scan(db, receipt, getpass("Scan the paper with the independent reader: "))
        print(json.dumps(status(db, receipt)))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RuntimeError, sqlite3.Error, http.client.HTTPException,
            KeyError, TypeError, IndexError, EOFError) as error:
        sys.exit(str(error) if not isinstance(error, (KeyError, TypeError, IndexError)) else "Invalid station or AIS data")
