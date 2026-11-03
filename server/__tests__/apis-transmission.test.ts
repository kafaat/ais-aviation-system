import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: undefined as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  applyAcknowledgement,
  backoffMinutes,
  dispatchDueTransmissions,
  listTransmissions,
  MAX_ATTEMPTS,
  processApisTransmissions,
  queueFlightTransmissions,
  retryTransmission,
  upsertPnrgovSchedule,
} from "../services/apis-transmission.service";
import {
  FileDropTransport,
  InMemoryTransport,
  TransportError,
  UnconfiguredAuthorityTransport,
  resolveApisTransport,
} from "../services/apis-transport";
import { mkdtemp, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const departure = new Date("2026-11-10T00:00:00Z"); // 03:00 Riyadh
let fixture: ReturnType<typeof transactionMemory>;
let transport: InMemoryTransport;

beforeEach(() => {
  fixture = transactionMemory({
    airlines: [{ id: 1, code: "XX", name: "TEST AIR" }],
    airports: [
      { id: 9, code: "RUH", country: "SA", timezone: "Asia/Riyadh" },
      { id: 10, code: "XAA", country: "XA", timezone: "Europe/London" },
    ],
    flights: [
      {
        id: 4,
        tenantId: 1,
        airlineId: 1,
        flightNumber: "XX123",
        originId: 9,
        destinationId: 10,
        departureTime: departure,
        arrivalTime: new Date(departure.getTime() + 6 * 3600_000),
        status: "scheduled",
      },
    ],
    users: [{ id: 3, email: "pax@example.com" }],
    bookings: [
      {
        id: 2,
        userId: 3,
        tenantId: 1,
        flightId: 4,
        pnr: "AB1CD2",
        bookingReference: "AB1CD2",
        status: "confirmed",
        paymentStatus: "paid",
        cabinClass: "economy",
        totalAmount: 50000,
        numberOfPassengers: 1,
        deletedAt: null,
        createdAt: new Date("2026-10-01T10:00:00Z"),
        updatedAt: new Date("2026-10-02T10:00:00Z"),
      },
    ],
    passengers: [
      {
        id: 5,
        bookingId: 2,
        type: "adult",
        firstName: "Test",
        lastName: "Traveler",
        ticketNumber: "0010000000051",
        seatNumber: null,
      },
    ],
    // apis_data uses snake_case SQL columns: the memory double filters on
    // the SQL name and returns the row as seeded, so both spellings are set.
    apis_data: [
      {
        id: 1,
        passenger_id: 5,
        passengerId: 5,
        bookingId: 2,
        documentType: "passport",
        documentNumber: "P123456",
        issuingCountry: "XB",
        nationality: "XB",
        dateOfBirth: "1990-01-15",
        gender: "M",
        expiryDate: "2030-01-01",
        givenNames: "TEST",
        surname: "TRAVELER",
        status: "validated",
      },
    ],
    payments: [
      {
        id: 1,
        bookingId: 2,
        method: "card",
        status: "completed",
        amount: 50000,
        currency: "SAR",
      },
    ],
    pnrgov_schedules: [
      {
        id: 1,
        tenantId: null,
        destinationCountry: "XA",
        authorityCode: "XAAUTH",
        messageVersion: "21:1",
        offsetsMinutes: [-1440, -60, 0],
        timingSource: "placeholder",
        isActive: true,
        updatedAt: new Date(),
      },
    ],
  });
  state.db = fixture.db;
  transport = new InMemoryTransport();
});

const actor = { requestedBy: 7, tenantId: null };

describe("transmission queueing", () => {
  it("queues the future pushes of the destination schedule once and reports missed offsets", async () => {
    const now = new Date("2026-11-09T12:00:00Z"); // 12h before: the 24h push is missed
    const first = await queueFlightTransmissions({
      flightId: 4,
      messageType: "PNRGOV",
      now,
      ...actor,
    });
    expect(first.created).toHaveLength(2);
    expect(first.missedOffsets).toEqual([-1440]);
    expect(first.authorityCode).toBe("XAAUTH");
    const again = await queueFlightTransmissions({
      flightId: 4,
      messageType: "PNRGOV",
      now,
      ...actor,
    });
    expect(again.created).toEqual([]);
    expect(again.skipped).toBe(2);
    const rows = fixture.rows("apis_transmissions");
    expect(rows.map(r => r.scheduleOffsetMinutes)).toEqual([-60, 0]);
    expect(rows[0].scheduledFor.toISOString()).toBe("2026-11-09T23:00:00.000Z");
    expect(
      rows.every(
        r => r.status === "queued" && /^[A-Z0-9]{14}$/.test(r.correlationId)
      )
    ).toBe(true);
  });

  it("refuses to queue without a schedule for the destination country", async () => {
    fixture.rows("pnrgov_schedules")[0].isActive = false;
    await expect(
      queueFlightTransmissions({ flightId: 4, messageType: "PNRGOV", ...actor })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await upsertPnrgovSchedule(
      {
        destinationCountry: "XA",
        authorityCode: "XAAUTH2",
        messageVersion: "21:1",
        offsetsMinutes: [0],
        timingSource: "operator",
        isActive: true,
      },
      { userId: 7, tenantId: null }
    );
    const result = await queueFlightTransmissions({
      flightId: 4,
      messageType: "PNRGOV",
      immediate: true,
      ...actor,
    });
    expect(result.authorityCode).toBe("XAAUTH2");
    expect(result.created).toHaveLength(1);
  });
});

describe("dispatch, acknowledgement, retry and dead letter", () => {
  async function queueImmediate(now: Date) {
    const { created } = await queueFlightTransmissions({
      flightId: 4,
      messageType: "PNRGOV",
      immediate: true,
      now,
      ...actor,
    });
    return created[0];
  }

  it("generates the body at dispatch, stores its hash and marks the row sent", async () => {
    const now = new Date("2026-11-09T12:00:00Z");
    const id = await queueImmediate(now);
    const summary = await dispatchDueTransmissions({ transport, now });
    expect(summary).toMatchObject({
      dispatched: 1,
      failed: 0,
      deadLettered: 0,
    });
    const [row] = fixture.rows("apis_transmissions");
    expect(row.status).toBe("sent");
    expect(row.attempts).toBe(1);
    expect(row.body).toContain(
      `UNB+IATA:1+XX+XAAUTH+261109:1200+${row.correlationId}'`
    );
    expect(row.body).toContain("RCI+XX:AB1CD2'");
    expect(row.body).toContain(
      "SSR+DOCS+HK+1+XX+/P/XB/P123456/XB/15JAN90/M/01JAN30/TRAVELER/TEST'"
    );
    expect(row.bodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.pnrCount).toBe(1);
    expect(transport.sent[0]).toMatchObject({
      transmissionId: id,
      correlationId: row.correlationId,
    });
    const [listed] = await listTransmissions({ flightId: 4, tenantId: null });
    expect(listed).toMatchObject({
      status: "sent",
      transportName: "memory",
      bodyLength: row.body.length,
    });
  });

  it("moves a sent row to acked or rejected from a matching CUSRES", async () => {
    const now = new Date("2026-11-09T12:00:00Z");
    await queueImmediate(now);
    await dispatchDueTransmissions({ transport, now });
    const [row] = fixture.rows("apis_transmissions");
    const originalCorrelationId = row.correlationId;
    const unmatched = await applyAcknowledgement({
      body: "UNH+1+CUSRES:D:05B:UN:IATA'BGM+962'RFF+ACW:ZZZZZZZZ'UNT+3+1'",
      source: "test",
    });
    expect(unmatched.matched).toBe(false);
    const nak = await applyAcknowledgement({
      body: `UNH+1+CUSRES:D:05B:UN:IATA'BGM+962'RFF+ACW:${row.correlationId}'ERP+2'ERC+108'FTX+AAO+++BAD DOCS'UNT+6+1'`,
      source: "test",
    });
    expect(nak).toMatchObject({
      matched: true,
      disposition: "nak",
      applied: true,
    });
    expect(fixture.rows("apis_transmissions")[0]).toMatchObject({
      status: "rejected",
      acknowledgementCode: "108",
      lastError: "108@2 BAD DOCS",
    });
    // Operator retry of a rejected message gets a fresh interchange reference.
    const retried = await retryTransmission({
      transmissionId: row.id,
      tenantId: null,
      requestedBy: 7,
    });
    expect(retried.correlationId).not.toBe(originalCorrelationId);
    await dispatchDueTransmissions({
      transport,
      now: new Date(now.getTime() + 60_000),
    });
    const current = fixture.rows("apis_transmissions")[0];
    expect(current.status).toBe("sent");
    const ack = await applyAcknowledgement({
      body: `UNH+1+CUSRES:D:05B:UN:IATA'BGM+962'RFF+ACW:${current.correlationId}'UNT+3+1'`,
      source: "test",
    });
    expect(ack).toMatchObject({ matched: true, disposition: "ack" });
    expect(fixture.rows("apis_transmissions")[0].status).toBe("acked");
  });

  it("applies a synchronous acknowledgement returned by the transport", async () => {
    const now = new Date("2026-11-09T12:00:00Z");
    await queueImmediate(now);
    const [{ correlationId }] = fixture.rows("apis_transmissions");
    transport.respondTo(
      correlationId,
      `UNH+1+CUSRES:D:05B:UN:IATA'BGM+962'RFF+ACW:${correlationId}'UNT+3+1'`
    );
    await dispatchDueTransmissions({ transport, now });
    expect(fixture.rows("apis_transmissions")[0].status).toBe("acked");
  });

  it("retries with backoff and dead-letters after the maximum attempts", async () => {
    let now = new Date("2026-11-09T12:00:00Z");
    await queueImmediate(now);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      transport.failNext(new TransportError("bridge unreachable", true));
      const summary = await dispatchDueTransmissions({ transport, now });
      const row = fixture.rows("apis_transmissions")[0];
      expect(row.attempts).toBe(attempt);
      if (attempt < MAX_ATTEMPTS) {
        expect(summary.failed).toBe(1);
        expect(row.status).toBe("failed");
        expect(row.nextAttemptAt.getTime()).toBe(
          now.getTime() + backoffMinutes(attempt) * 60_000
        );
        // Not due yet: nothing happens before nextAttemptAt.
        expect(
          await dispatchDueTransmissions({
            transport,
            now: new Date(now.getTime() + 1000),
          })
        ).toMatchObject({ dispatched: 0, failed: 0 });
        now = new Date(row.nextAttemptAt.getTime());
      } else {
        expect(summary.deadLettered).toBe(1);
        expect(row.status).toBe("dead_letter");
        expect(row.nextAttemptAt).toBeNull();
        expect(row.lastError).toBe("bridge unreachable");
      }
    }
    expect(backoffMinutes(1)).toBe(1);
    expect(backoffMinutes(4)).toBe(60);
    expect(backoffMinutes(9)).toBe(60);
    // Dead letters are not picked up again until an operator retries.
    expect(await dispatchDueTransmissions({ transport, now })).toMatchObject({
      dispatched: 0,
    });
    await retryTransmission({
      transmissionId: 1,
      tenantId: null,
      requestedBy: 7,
    });
    expect(await dispatchDueTransmissions({ transport, now })).toMatchObject({
      dispatched: 1,
    });
    expect(fixture.rows("apis_transmissions")[0].status).toBe("sent");
  });

  it("dead-letters immediately on a non-retryable fault and waits when no transport is configured", async () => {
    const now = new Date("2026-11-09T12:00:00Z");
    await queueImmediate(now);
    expect(
      await dispatchDueTransmissions({ transport: null, now })
    ).toMatchObject({ waiting: 1 });
    expect(fixture.rows("apis_transmissions")[0].status).toBe("queued");
    const summary = await dispatchDueTransmissions({
      transport: new UnconfiguredAuthorityTransport(),
      now,
    });
    expect(summary.deadLettered).toBe(1);
    expect(fixture.rows("apis_transmissions")[0].lastError).toMatch(
      /NPSC technical specification/
    );
    await expect(
      retryTransmission({ transmissionId: 1, tenantId: 2, requestedBy: 7 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("queues scheduled pushes for upcoming flights, dispatches and polls acknowledgements in one run", async () => {
    const now = new Date("2026-11-09T22:30:00Z"); // the -60 push (23:00Z) is still ahead
    const first = await processApisTransmissions({ transport, now });
    expect(first.queued).toBe(2);
    expect(first.dispatched).toBe(0);
    const later = new Date("2026-11-09T23:00:00Z");
    const second = await processApisTransmissions({ transport, now: later });
    expect(second).toMatchObject({ queued: 0, dispatched: 1 });
    const sent = fixture
      .rows("apis_transmissions")
      .find(r => r.status === "sent");
    transport.receive(
      `UNH+1+CUSRES:D:05B:UN:IATA'BGM+962'RFF+ACW:${sent.correlationId}'UNT+3+1'`
    );
    const third = await processApisTransmissions({ transport, now: later });
    expect(third.acknowledgements).toEqual({ received: 1, matched: 1 });
    expect(
      fixture.rows("apis_transmissions").find(r => r.id === sent.id).status
    ).toBe("acked");
  });
});

describe("file-drop transport", () => {
  it("writes the interchange and a metadata sidecar, then consumes inbound acknowledgements", async () => {
    const root = await mkdtemp(join(tmpdir(), "apis-filedrop-"));
    const drop = new FileDropTransport(root);
    const receipt = await drop.send({
      transmissionId: 1,
      messageType: "PNRGOV",
      authorityCode: "XAAUTH",
      correlationId: "ABC123",
      flightId: 4,
      body: "UNB+IATA:1'",
      bodyHash: "0".repeat(64),
    });
    expect(receipt.transportReference).toBe("ABC123.edi");
    expect((await readdir(join(root, "outbound"))).sort()).toEqual([
      "ABC123.edi",
      "ABC123.json",
    ]);
    const meta = JSON.parse(
      await readFile(join(root, "outbound", "ABC123.json"), "utf8")
    );
    expect(meta).toMatchObject({ correlationId: "ABC123", flightId: 4 });
    expect(meta).not.toHaveProperty("body");
    await mkdir(join(root, "inbound"), { recursive: true });
    await writeFile(
      join(root, "inbound", "r1.edi"),
      "UNH+1+CUSRES:D:05B:UN:IATA'UNT+2+1'"
    );
    const inbound = await drop.pollAcknowledgements();
    expect(inbound).toEqual([
      {
        body: "UNH+1+CUSRES:D:05B:UN:IATA'UNT+2+1'",
        source: "filedrop:r1.edi",
      },
    ]);
    expect(await readdir(join(root, "inbound"))).toEqual([]);
    expect(await readdir(join(root, "processed"))).toEqual(["r1.edi"]);
  });

  it("resolves transports from the environment without defaulting to a live one", () => {
    expect(resolveApisTransport({})).toBeNull();
    expect(resolveApisTransport({ APIS_TRANSPORT: "none" })).toBeNull();
    expect(() => resolveApisTransport({ APIS_TRANSPORT: "filedrop" })).toThrow(
      /APIS_FILEDROP_DIR/
    );
    expect(
      resolveApisTransport({
        APIS_TRANSPORT: "filedrop",
        APIS_FILEDROP_DIR: "/x",
      })?.name
    ).toBe("filedrop");
    expect(resolveApisTransport({ APIS_TRANSPORT: "authority" })?.name).toBe(
      "authority-unconfigured"
    );
    expect(() =>
      resolveApisTransport({ APIS_TRANSPORT: "memory", NODE_ENV: "production" })
    ).toThrow(/production/);
    expect(() =>
      resolveApisTransport({ APIS_TRANSPORT: "carrier-pigeon" })
    ).toThrow(/Unknown/);
  });
});
