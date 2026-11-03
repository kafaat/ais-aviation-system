import ctypes
import json
import os
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, nullcontext
from pathlib import Path
from unittest.mock import MagicMock

import honeywell as station
from win_spool import DocInfo, send_raw


FIXTURES = Path(__file__).resolve().parents[2] / "server/__tests__/fixtures/bcbp-samples.json"
SAMPLES = json.loads(FIXTURES.read_text(encoding="utf-8"))["encoded"]
TAG = "0000123456"


def documents(sample=SAMPLES[0]):
    values = sample["input"]
    flight = values["flightNumber"]
    auth = dict(passengers=[{"id": 3}], bookingId=7, bookingReference="CDE456",
                pnr=values["pnr"], flightNumber=flight, capabilityToken="test-only")
    bp = {"boardingPass": dict(
        bcbp=sample["bcbp"], origin={"code": values["departureAirport"]},
        destination={"code": values["arrivalAirport"]}, seat=values["seatNumber"],
        bookingReference=auth["bookingReference"],
        flight={"number": flight, "departureTime": values["departureTime"]})}
    bag = dict(totalBags=1, printStatus="document_ready", bagTags=[dict(
        barcodeData=TAG, tagNumber=TAG, printedAt=None, origin="JED", destination="RUH",
        bookingReference=auth["bookingReference"], flightNumber=flight)])
    return auth, bp, bag


class Documents(unittest.TestCase):
    def test_every_signed_repo_vector_is_preserved_in_a_single_pdf417(self):
        for sample in SAMPLES:
            with self.subTest(sample=sample["name"]):
                auth, bp, _ = documents(sample)
                raw, symbol = station.render("boarding-pass", bp, auth)
                self.assertEqual(sample["bcbp"], symbol)
                self.assertIn(f'b24,154,P,590,240,s5,f0,x2,y6,"{symbol}"\n'.encode(), raw)
                self.assertEqual(raw.count(b"\nP1\n"), 1)

    def test_bag_has_exact_itf_without_generated_check_digit_or_lost_zeroes(self):
        auth, _, bag = documents()
        raw, symbol = station.render("bag-tag", bag, auth, TAG)
        self.assertEqual(symbol, TAG)
        self.assertIn(b'B32,100,0,2,3,7,120,N,"0000123456"', raw)
        self.assertNotIn(b"test-only", raw)

    def test_mismatched_bag_or_multiple_labels_refused(self):
        for patch in ({"flightNumber": "WRONG"}, {"bookingReference": "OTHER"},
                      {"printedAt": "today"}, {"barcodeData": "1234567890"}):
            auth, _, bag = documents()
            bag["bagTags"][0].update(patch)
            with self.assertRaises(ValueError):
                station.render("bag-tag", bag, auth, TAG)
        bag["totalBags"] = 2
        with self.assertRaises(ValueError):
            station.render("bag-tag", bag, auth, TAG)

    def test_no_epl_command_injection(self):
        auth, bp, bag = documents()
        bp["boardingPass"]["bcbp"] = bp["boardingPass"]["bcbp"].replace("ALQAHTANI", 'A"\nP99\n"')
        with self.assertRaises(ValueError):
            station.render("boarding-pass", bp, auth)
        bag["bagTags"][0]["origin"] = "A\rB"
        with self.assertRaises(ValueError):
            station.render("bag-tag", bag, auth, TAG)
        self.assertEqual(station.epl_string('A"B\\C'), '"A\\"B\\\\C"')

    def test_api_uses_current_passenger_capability_and_exact_sector_and_tag(self):
        auth, bp, bag = documents()
        for kind, op, document, tag in (("bag-tag", "printBagTag", bag, TAG),
                                        ("boarding-pass", "printBoardingPass", bp, None)):
            api = MagicMock(side_effect=[auth, document])
            station.fetch_document("ais.test", kind, auth["pnr"], "Test", 3, 21, tag, api)
            self.assertEqual(api.call_args_list[0].args,
                             ("ais.test", "authenticate", {"bookingRef": auth["pnr"], "lastName": "Test", "flightId": 21}))
            expected = {"passengerId": 3, "flightId": 21, "capabilityToken": "test-only"}
            if tag:
                expected.update(tagNumbers=[tag], bagCount=1)
            self.assertEqual(api.call_args_list[1].args, ("ais.test", op, expected))
        api = MagicMock(return_value=auth)
        with self.assertRaises(ValueError):
            station.fetch_document("ais.test", "bag-tag", auth["pnr"], "Test", 999, 21, TAG, api)
        self.assertEqual(api.call_count, 1)

    def test_https_origin_is_canonical_and_has_no_credentials_or_path(self):
        self.assertEqual(station.station_host("https://AIS.TEST:443/"), "ais.test")
        for origin in ("http://ais.test", "https://ais.test/api", "https://name@ais.test", "https://ais.test/#foo"):
            with self.assertRaises(ValueError):
                station.station_host(origin)


class Journal(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "jobs.db"
        self.db = station.journal(self.path)
        self.addCleanup(self.db.close)
        self.opener = MagicMock(side_effect=lambda name: nullcontext(name))
        self.send = MagicMock(side_effect=lambda handle, data, receipt, started: started(19))

    def submit(self, kind="bag-tag", db=None):
        return station.submit(db or self.db, kind, "key-" + kind, b"test", TAG, self.opener, self.send)

    def test_distinct_routing_queue_and_independent_scan_evidence(self):
        for kind in station.SHARES:
            receipt = self.submit(kind)
            self.opener.assert_called_with(station.SHARES[kind])
            self.assertEqual(self.send.call_args.args[0], station.SHARES[kind])
            before = station.status(self.db, receipt)
            self.assertEqual(before["windowsJobId"], 19)
            self.assertIsNotNone(before["queuedUtc"])
            self.assertIsNone(before["operatorScanMatchedUtc"])
            with self.assertRaisesRegex(ValueError, "mismatch"):
                station.check_scan(self.db, receipt, TAG.lstrip("0"))
            station.check_scan(self.db, receipt, TAG)
            self.assertIsNotNone(station.status(self.db, receipt)["operatorScanMatchedUtc"])
            with self.assertRaisesRegex(ValueError, "Already attempted"):
                self.submit(kind)
        self.assertEqual(self.send.call_count, 2)
        self.assertNotIn(TAG, "".join(self.db.iterdump()))

    def test_lost_ack_blocks_retry_even_after_reopen(self):
        def lost(handle, data, receipt, started):
            started(42)
            raise OSError("lost acknowledgement")
        self.send.side_effect = lost
        with self.assertRaisesRegex(RuntimeError, "Receipt 1"):
            self.submit()
        with closing(station.journal(self.path)) as restored:
            record = station.status(restored, 1)
            self.assertEqual(record["windowsJobId"], 42)
            self.assertIsNone(record["queuedUtc"])
            self.assertIsNone(record["operatorScanMatchedUtc"])
            with self.assertRaisesRegex(ValueError, "Already attempted"):
                self.submit(db=restored)
        self.assertEqual(self.send.call_count, 1)

    def test_missing_queue_never_falls_back_or_creates_a_job(self):
        self.opener.side_effect = OSError("missing share")
        with self.assertRaises(OSError):
            self.submit()
        self.opener.assert_called_once_with(r"\\localhost\HWBT")
        self.send.assert_not_called()
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM jobs").fetchone(), (0,))

    def test_two_connections_can_only_submit_once(self):
        barrier = threading.Barrier(2)
        def attempt():
            with closing(station.journal(self.path)) as db:
                barrier.wait(timeout=5)
                try:
                    return self.submit(db=db)
                except ValueError:
                    return None
        with ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(attempt) for _ in range(2)]
            self.assertCountEqual([f.result(timeout=10) for f in futures], [1, None])
        self.assertEqual(self.send.call_count, 1)


class Transport(unittest.TestCase):
    def test_raw_spool_sequence_and_short_write(self):
        for short in (False, True):
            spooler = MagicMock()
            def write(handle, data, length, count):
                count._obj.value = length - int(short)
                return 1
            spooler.WritePrinter.side_effect = write
            def start(handle, level, info):
                header = ctypes.cast(info, ctypes.POINTER(DocInfo)).contents
                self.assertEqual((level, header.datatype, header.name), (1, "RAW", "AIS station 2"))
                return 17
            spooler.StartDocPrinterW.side_effect = start
            record = MagicMock()
            if short:
                with self.assertRaisesRegex(OSError, "Incomplete"):
                    send_raw((spooler, 1), b"N\nP1\n", 2, record)
                spooler.AbortPrinter.assert_called_once()
                spooler.EndDocPrinter.assert_not_called()
            else:
                send_raw((spooler, 1), b"N\nP1\n", 2, record)
                self.assertEqual([c[0] for c in spooler.method_calls], [
                    "StartDocPrinterW", "StartPagePrinter", "WritePrinter", "EndPagePrinter", "EndDocPrinter"])
            record.assert_called_once_with(17)

    @unittest.skipUnless(os.name == "nt" and os.getenv("AIS_TEST_PORT_DIR"), "requires isolated Windows spooler file ports")
    def test_windows_raw_ports_receive_only_their_exact_document(self):
        port_dir = Path(os.environ["AIS_TEST_PORT_DIR"])
        auth, bp, bag = documents()
        with closing(station.journal(":memory:")) as db:
            for kind, doc in (("boarding-pass", bp), ("bag-tag", bag)):
                raw, symbol = station.render(kind, doc, auth, TAG if kind == "bag-tag" else None)
                receipt = station.submit(db, kind, kind, raw, symbol)
                self.assertIsNone(station.status(db, receipt)["operatorScanMatchedUtc"])
                captured = port_dir / (station.SHARES[kind].split("\\")[-1] + ".prn")
                until = time.monotonic() + 30
                while time.monotonic() < until:
                    try:
                        if captured.read_bytes() == raw:
                            break
                    except (FileNotFoundError, PermissionError):
                        pass
                    time.sleep(.2)
                self.assertEqual(captured.read_bytes(), raw)
                if kind == "boarding-pass":
                    self.assertFalse((port_dir / "HWBT.prn").exists())


if __name__ == "__main__":
    unittest.main()
