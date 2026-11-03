import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import { issueSelfServiceCapability } from "../services/self-service-capability.service";
import * as seatMap from "../services/seat-map.service";
import { kioskRouter } from "./kiosk";
import { printBagTag } from "../services/kiosk.service";
import { readStationTag } from "../../scripts/acceptance/kiosk-printer";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
const caller = kioskRouter.createCaller({ user: null } as TrpcContext);
const tag = "0065123456";
const input = {
  capabilityToken: issueSelfServiceCapability({
    kind: "kiosk-session",
    sessionId: 1,
    bookingId: 1,
    passengerIds: [2, 3],
  }),
  passengerId: 2,
  flightId: 5,
  bagCount: 1,
  tagNumbers: [tag],
};
let fixture: ReturnType<typeof transactionMemory>;

beforeEach(() => {
  const departureTime = new Date(Date.now() + 4 * 3600000);
  const arrivalTime = new Date(Date.now() + 6 * 3600000);
  fixture = transactionMemory({
    bookings: [
      {
        id: 1,
        bookingReference: "TRAVEL",
        pnr: "FAMILY",
        status: "confirmed",
        paymentStatus: "paid",
        flightId: 4,
        cabinClass: "economy",
        checkedIn: true,
        deletedAt: null,
        tenantId: null,
      },
    ],
    passengers: [2, 3].map(id => ({
      id,
      bookingId: 1,
      firstName: "P" + id,
      lastName: "Journey",
      tenantId: null,
    })),
    booking_segments: [
      {
        id: 10,
        bookingId: 1,
        flightId: 4,
        segmentOrder: 1,
        status: "confirmed",
        seatsReserved: true,
      },
      {
        id: 11,
        bookingId: 1,
        flightId: 5,
        segmentOrder: 2,
        status: "confirmed",
        seatsReserved: true,
      },
    ],
    flights: [
      { id: 4, originId: 6, destinationId: 7, flightNumber: "XX101" },
      { id: 5, originId: 7, destinationId: 6, flightNumber: "XX102" },
    ].map(f => ({
      ...f,
      departureTime,
      arrivalTime,
      tenantId: null,
      status: "scheduled",
    })),
    airports: [
      { id: 6, code: "AAA", country: "SA" },
      { id: 7, code: "BBB", country: "SA" },
    ],
    seat_inventory: [
      {
        id: 12,
        bookingId: 1,
        passengerId: 2,
        flightId: 5,
        seatNumber: "1A",
        status: "checked_in",
        checkedInAt: new Date(),
        boardingSequence: 1,
        checkInNonce: "current",
        cabinClass: "economy",
      },
    ],
    baggage_items: [
      {
        id: 8,
        bookingId: 1,
        passengerId: 2,
        tagNumber: tag,
        status: "loading",
      },
    ],
    baggage_custody_events: [
      {
        id: 9,
        baggageId: 8,
        flightId: 5,
        airportId: 7,
        stage: "transfer",
        observedAt: new Date(),
      },
    ],
  });
  state.db = fixture.db;
});

it("returns the same existing plate and return routing without a hardware acknowledgement or side effects", async () => {
  const document = await caller.printBagTag(input);
  expect(document).toMatchObject({
    printStatus: "document_ready",
    totalBags: 1,
    bagTags: [
      {
        tagNumber: tag,
        barcodeData: tag,
        origin: "BBB",
        destination: "AAA",
        flightNumber: "XX102",
        printedAt: null,
      },
    ],
  });
  expect(await caller.printBagTag(input)).toEqual(document);
  expect(fixture.rows("baggage_items")).toHaveLength(1);
  expect(fixture.rows("baggage_custody_events")).toHaveLength(1);
  expect(fixture.rows("kiosk_sessions")).toEqual([]);
});

it(
  "renders one diagnostic label from the returned tag and compares the exact scanner digits",
  { timeout: 20000 },
  async () => {
    const document = await caller.printBagTag(input);
    const directory = mkdtempSync(join(tmpdir(), "ais-kiosk-printer-"));
    const response = join(directory, "response.json");
    const pdf = join(directory, "test.pdf");
    function run(args: string[], stdin = "") {
      return spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/acceptance/kiosk-printer.ts", ...args],
        { input: stdin, encoding: "utf8", timeout: 10000 }
      );
    }
    try {
      writeFileSync(
        response,
        JSON.stringify({ result: { data: { json: document } } })
      );
      const label = run(["label", response, pdf]);
      expect(label.status, label.stderr).toBe(0);
      expect(readFileSync(pdf).subarray(0, 5).toString()).toBe("%PDF-");
      expect(run(["scan", response], tag + "\r\n").status).toBe(0);
      const mismatch = run(["scan", response], tag.slice(1) + "\n");
      expect(mismatch.status).toBe(1);
      expect(mismatch.stderr).toContain("MISMATCH");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
);

it("requires precise physical identities and passenger/sector check-in", async () => {
  for (const patch of [
    { tagNumbers: undefined },
    { bagCount: 2, tagNumbers: [tag, tag] },
    { tagNumbers: ["0065000000"] },
    { flightId: 4 },
    { passengerId: 3 },
    { passengerId: 999 },
    { flightId: 999 },
  ]) {
    await expect(caller.printBagTag({ ...input, ...patch })).rejects.toThrow();
  }
  expect(fixture.rows("kiosk_sessions")).toEqual([]);
});

it("rechecks the receipt identity and time window even if discovery preceded a passenger or flight correction", async () => {
  const receipt = { bookingRef: "family", lastName: "journey", tagNumber: tag };
  const prepare = () => printBagTag(1, 2, 1, 5, [tag], receipt);
  await expect(prepare()).resolves.toMatchObject({
    printStatus: "document_ready",
  });
  fixture.rows("passengers")[0].lastName = "Changed";
  await expect(prepare()).rejects.toMatchObject({ code: "NOT_FOUND" });
  fixture.rows("passengers")[0].lastName = "Journey";
  fixture.rows("bookings")[0].pnr = "NEWPNR";
  await expect(prepare()).rejects.toMatchObject({ code: "NOT_FOUND" });
  fixture.rows("bookings")[0].pnr = "FAMILY";
  fixture.rows("flights")[1].departureTime = new Date(
    Date.now() + 30 * 3600000
  );
  await expect(prepare()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(fixture.rows("kiosk_sessions")).toHaveLength(0);
});

it("refuses to copy a bag after its handover receipt even if an old transfer status survives", async () => {
  fixture.rows("baggage_items")[0].returnEventId = 17;
  await expect(caller.printBagTag(input)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  expect(fixture.rows("baggage_items")).toHaveLength(1);
  expect(fixture.rows("baggage_custody_events")).toHaveLength(1);
  expect(fixture.rows("kiosk_sessions")).toHaveLength(0);
});

it.each(["loading", "arrival"])(
  "refuses a tag whose most recent custody is %s",
  async stage => {
    const event = fixture.rows("baggage_custody_events")[0];
    fixture.rows("baggage_custody_events").push({
      ...event,
      id: 10,
      stage,
      observedAt: new Date(event.observedAt.getTime() + 1000),
    });
    await expect(caller.printBagTag(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  }
);

it.each(["flightId", "airportId", "baggageId"])(
  "requires custody matching %s",
  async field => {
    fixture.rows("baggage_custody_events")[0][field] = 999;
    await expect(caller.printBagTag(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  }
);

it("refuses unpaid or cancelled bookings even with current custody and a checked-in seat", async () => {
  fixture.rows("bookings")[0].paymentStatus = "refunded";
  await expect(caller.printBagTag(input)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  fixture.rows("bookings")[0].paymentStatus = "paid";
  fixture.rows("bookings")[0].status = "cancelled";
  await expect(caller.printBagTag(input)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
});

it("returns the boarding document issue time without acknowledging printer output", async () => {
  const issuedAt = new Date("2026-01-02T03:04:05Z");
  fixture.rows("bookings")[0].pnr = "TRAVEL";
  fixture.rows("passengers")[0].ticketNumber = null;
  fixture.rows("flights")[1].aircraftType = null;
  const generator = vi
    .spyOn(seatMap, "generateBoardingPass")
    .mockResolvedValue({
      flightNumber: "XX102",
      airline: { name: "Test Airline", code: "XX" },
      origin: { code: "BBB", city: "Origin", name: "Origin Airport" },
      destination: {
        code: "AAA",
        city: "Destination",
        name: "Destination Airport",
      },
      departureTime: issuedAt,
      arrivalTime: issuedAt,
      passenger: {
        firstName: "P2",
        lastName: "Journey",
        ticketNumber: null,
        title: null,
      },
      seat: {
        seatNumber: "1A",
        cabinClass: "economy",
        boardingGroup: null,
        boardingSequence: 1,
      },
      gate: null,
      boardingTime: null,
      barcodeData: "synthetic-qr",
      bcbp: "synthetic-bcbp",
      issuedAt,
    });
  try {
    const document = await caller.printBoardingPass({
      capabilityToken: input.capabilityToken,
      flightId: 5,
      passengerId: 2,
    });
    expect(document).toMatchObject({
      printStatus: "document_ready",
      boardingPass: {
        issuedAt: issuedAt.toISOString(),
        printedAt: null,
        barcodeData: "synthetic-qr",
        bcbp: "synthetic-bcbp",
      },
    });
    expect(fixture.rows("kiosk_sessions")).toHaveLength(0);
  } finally {
    generator.mockRestore();
  }
});

it("accepts a single registered document and rejects ambiguous captures", async () => {
  const document = await caller.printBagTag(input);
  const envelope = { result: { data: { json: document } } };
  for (const body of [document, envelope, [envelope]])
    expect(readStationTag(body)).toBe(tag);
  for (const body of [
    [],
    [envelope, envelope],
    { error: { message: "Not authorized" } },
    { ...document, totalBags: 2 },
    { ...document, printStatus: "printed" },
    {
      ...document,
      bagTags: [
        { ...document.bagTags[0], printedAt: new Date().toISOString() },
      ],
    },
    {
      ...document,
      bagTags: [{ ...document.bagTags[0], barcodeData: "0065999999" }],
    },
    {
      ...document,
      bagTags: [{ ...document.bagTags[0], tagNumber: "12", barcodeData: "12" }],
    },
  ])
    expect(() => readStationTag(body)).toThrow();
  expect(fixture.rows("kiosk_sessions")).toEqual([]);
});
