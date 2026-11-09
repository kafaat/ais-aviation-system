import { randomBytes } from "node:crypto";
import { eq, getTableName } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";
import { apisData, apisSubmissions } from "../../drizzle/operations-schema";
import type { TrpcContext } from "../_core/context";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { apisRouter } from "../routers/apis";
import { seatMapRouter } from "../routers/seat-map";
import { boardingPassRouter } from "../routers/boarding-pass";
import { eticketRouter } from "../routers/eticket";
import {
  collectPassengerInfo,
  flagIncompletePassengers,
  getFlightSubmissions,
  validateAPISData,
} from "../services/apis.service";
import { verifyBoardingPass } from "../services/boarding-pass.service";

const tables = [
  schema.users,
  schema.airlines,
  schema.airports,
  schema.flights,
  schema.bookings,
  schema.bookingSegments,
  schema.passengers,
  schema.seatMaps,
  schema.seatInventory,
  schema.paymentReceipts,
  schema.ordinaryBookingRefunds,
  schema.dcsFlightOperations,
  schema.dcsPassengerStates,
  schema.dcsOperationEvents,
  schema.ticketCoupons,
  schema.baggageItems,
  schema.baggageCustodyEvents,
  schema.outbox,
  schema.airportGates,
  schema.gateAssignments,
  apisData,
  apisSubmissions,
];
const allowed =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = allowed ? describe : describe.skip;
const now = new Date("2030-11-20T12:00:00Z");
const departure = new Date("2030-11-21T12:00:00Z");

function context(userId = 9, tenantId: number | null = 3, role = "user") {
  return {
    user: { id: userId, tenantId, role },
    tenantId,
    authMethod: "cookie",
  } as TrpcContext;
}
const owner = () => apisRouter.createCaller(context());
const administrator = () => apisRouter.createCaller(context(1, 3, "admin"));
const seats = () => seatMapRouter.createCaller(context());
const adminSeats = () => seatMapRouter.createCaller(context(1, 3, "admin"));
const passes = () => boardingPassRouter.createCaller(context());
const travelDocument = () => ({
  documentType: "passport" as const,
  documentNumber: "SYN12345",
  issuingCountry: "SA",
  nationality: "SAU",
  dateOfBirth: "1990-01-02",
  gender: "F" as const,
  expiryDate: "2035-01-02",
  givenNames: "Ada",
  surname: "Valid",
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

// This barrier only schedules real SQL calls. Queries, rows, transactions and
// contention still use the isolated native MySQL database.
function holdStatement(
  connection: mysql.Connection,
  match: RegExp,
  phase: "before" | "after" = "before"
) {
  const entered = deferred();
  const released = deferred();
  const query = connection.query.bind(connection);
  let held = false;
  const spy = vi.spyOn(connection, "query").mockImplementation((async (
    ...args: Parameters<typeof connection.query>
  ) => {
    const statement = args[0];
    const text = typeof statement === "string" ? statement : statement.sql;
    const pause = !held && match.test(text);
    if (pause) held = true;
    if (pause && phase === "before") {
      entered.resolve();
      await released.promise;
    }
    const result = await query(...args);
    if (pause && phase === "after") {
      entered.resolve();
      await released.promise;
    }
    return result;
  }) as typeof connection.query);
  return {
    entered: entered.promise,
    release: released.resolve,
    restore: () => spy.mockRestore(),
  };
}

nativeDescribe("APIS and boarding documents on isolated native MySQL", () => {
  let admin: mysql.Connection | null = null;
  let pool: mysql.Pool | null = null;
  let db: MySql2Database<typeof schema>;
  let databaseName = "";
  let created = false;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const sourceDatabase = url.pathname.slice(1);
    if (
      !/^[A-Za-z0-9_]+_test$/.test(sourceDatabase) ||
      !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    )
      throw new Error(
        "APIS/seat fixtures require a loopback disposable _test database"
      );
    const options = {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      timezone: "Z",
    };
    databaseName = "ais_apis_seats_" + randomBytes(6).toString("hex");
    if (!/^ais_apis_seats_[0-9a-f]{12}$/.test(databaseName))
      throw new Error("Invalid APIS/seat fixture identity");
    admin = await mysql.createConnection(options);
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    created = true;
    // Native migrated types, defaults and unique indexes, without touching the
    // source data. LIKE omits foreign keys; migration gates verify those separately.
    for (const table of tables) {
      const name = getTableName(table);
      if (!/^[a-z_]+$/.test(name)) throw new Error("Invalid fixture table");
      await admin.query(
        `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${sourceDatabase}\`.\`${name}\``
      );
    }
    pool = mysql.createPool({
      ...options,
      database: databaseName,
      connectionLimit: 4,
    });
    db = drizzle(pool, { schema, mode: "default" });
    state.db = db;
    const [mode] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT @@SESSION.sql_mode AS sqlMode"
    );
    expect(String(mode[0]?.sqlMode)).toContain("STRICT_TRANS_TABLES");
    const [engines] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT ENGINE FROM information_schema.tables WHERE TABLE_SCHEMA=?",
      [databaseName]
    );
    expect(engines).toHaveLength(tables.length);
    expect(engines.every(row => row.ENGINE === "InnoDB")).toBe(true);
  }, 60000);

  afterAll(async () => {
    state.db = null;
    if (pool) await pool.end();
    if (admin) {
      try {
        if (created) await admin.query(`DROP DATABASE \`${databaseName}\``);
      } finally {
        await admin.end();
      }
    }
  });

  beforeEach(async () => {
    // Only Date is controlled; MySQL I/O and transaction timers remain real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.stubEnv("AIS_PAXLST_DRAFT_RECIPIENT", "SYNTHETIC-DRAFT");
    vi.stubEnv("AIS_PNRGOV_DRAFT_RECIPIENT", "SYNTHETIC-DRAFT");
    vi.stubEnv("BOARDING_PASS_SECRET", "synthetic-native-boarding-secret");
    for (const table of tables)
      await pool!.query(`TRUNCATE TABLE \`${getTableName(table)}\``);
    await db.insert(schema.users).values([
      { id: 9, openId: "apis-seat-owner", role: "user", tenantId: 3 },
      { id: 10, openId: "apis-seat-other", role: "user", tenantId: 3 },
    ]);
    await db
      .insert(schema.airlines)
      .values({ id: 3, code: "SV", name: "Synthetic Airways" });
    await db.insert(schema.airports).values(
      ["RUH", "JED", "DMM"].map((code, index) => ({
        id: index + 1,
        code,
        name: `Synthetic ${code}`,
        city: code,
        country: "SA",
        timezone: "Asia/Riyadh",
      }))
    );
    await db.insert(schema.flights).values(
      [41, 42, 43].map((id, index) => ({
        id,
        tenantId: id === 43 ? 4 : 3,
        airlineId: 3,
        flightNumber: `SV${id}`,
        originId: index === 1 ? 2 : 1,
        destinationId: index === 1 ? 3 : 2,
        departureTime: departure,
        arrivalTime: new Date("2030-11-21T14:00:00Z"),
        aircraftType: "A320",
        economySeats: 3,
        economyAvailable: 1,
        economyPrice: 10000,
        businessSeats: 0,
        businessAvailable: 0,
        businessPrice: 20000,
      }))
    );
    await db.insert(schema.bookings).values(booking(71));
    await db.insert(schema.passengers).values([
      {
        id: 81,
        tenantId: 3,
        bookingId: 71,
        firstName: "Ada",
        lastName: "Valid",
        nationality: "SA",
      },
      {
        id: 82,
        tenantId: 3,
        bookingId: 71,
        firstName: "Mina",
        lastName: "Missing",
        nationality: "SA",
      },
    ]);
    await db.insert(schema.seatMaps).values({
      id: 51,
      airlineId: 3,
      aircraftType: "A320",
      configName: "Synthetic three-seat layout",
      totalSeats: 3,
      economySeats: 3,
      cabinLayout: JSON.stringify({
        rows: [
          {
            row: 1,
            cabinClass: "economy",
            seats: [
              { column: "A", seatType: "window" },
              { column: "B", seatType: "middle" },
              { column: "C", seatType: "aisle", blocked: true },
            ],
          },
        ],
      }),
    });
  }, 30000);

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  function booking(
    id: number,
    overrides = {}
  ): typeof schema.bookings.$inferInsert {
    return {
      id,
      userId: 9,
      tenantId: 3,
      flightId: 41,
      bookingReference: `S${String(id).padStart(5, "0")}`,
      pnr: `S${String(id).padStart(5, "0")}`,
      cabinClass: "economy",
      numberOfPassengers: 2,
      totalAmount: 20000,
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
      ...overrides,
    };
  }

  async function storedDocument() {
    const [document] = await db
      .select()
      .from(apisData)
      .where(eq(apisData.passengerId, 81));
    return document;
  }

  async function assignedSeat() {
    const [seat] = await db
      .select()
      .from(schema.seatInventory)
      .where(eq(schema.seatInventory.passengerId, 81));
    return seat;
  }

  async function checkedInPassenger() {
    await adminSeats().initializeFlightSeats({ flightId: 41, seatMapId: 51 });
    await owner().submitInfo({ passengerId: 81, ...travelDocument() });
    return seats().checkIn({
      bookingId: 71,
      flightId: 41,
      passengerId: 81,
      seatNumber: "1A",
    });
  }

  it("collects and updates a passenger's document through the real route and resets prior validation", async () => {
    const submitted = await owner().submitInfo({
      passengerId: 81,
      ...travelDocument(),
    });
    expect(submitted).toMatchObject({
      passengerId: 81,
      bookingId: 71,
      status: "complete",
    });
    expect(await owner().getMyAPISStatus({ passengerId: 81 })).toMatchObject({
      hasData: true,
      status: "complete",
      missingFields: [],
      data: {
        documentNumber: "SYN12345",
        dateOfBirth: "1990-01-02T00:00:00.000Z",
      },
    });
    expect(
      await administrator().validatePassenger({ passengerId: 81 })
    ).toMatchObject({ valid: true, status: "validated" });
    expect((await storedDocument()).validatedAt).toBeInstanceOf(Date);
    await owner().submitInfo({
      passengerId: 81,
      ...travelDocument(),
      documentNumber: "UPDATED123",
    });
    expect(await storedDocument()).toMatchObject({
      documentNumber: "UPDATED123",
      status: "complete",
      validatedAt: null,
      submittedAt: null,
    });
    expect(await db.select().from(apisData)).toHaveLength(1);
  });

  it.each([
    { label: "another owner", userId: 10, tenantId: 3 },
    { label: "another tenant", userId: 9, tenantId: 4 },
  ])(
    "rejects document reads and writes from $label without changing native rows",
    async ({ userId, tenantId }) => {
      await owner().submitInfo({ passengerId: 81, ...travelDocument() });
      const before = await storedDocument();
      const foreign = apisRouter.createCaller(context(userId, tenantId));
      await expect(
        foreign.submitInfo({
          passengerId: 81,
          ...travelDocument(),
          documentNumber: "FOREIGN123",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        foreign.getMyAPISStatus({ passengerId: 81 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await storedDocument()).toEqual(before);
    }
  );

  it("returns an incomplete passenger without a document and cannot validate a missing record", async () => {
    expect(await owner().getMyAPISStatus({ passengerId: 82 })).toMatchObject({
      hasData: false,
      status: "incomplete",
      completeness: 0,
    });
    await expect(
      administrator().validatePassenger({ passengerId: 82 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(apisData)).toEqual([]);
  });

  it.each([
    { field: "dateOfBirth", value: "not-a-date" },
    { field: "dateOfBirth", value: "2029-02-31" },
    { field: "expiryDate", value: "2031-02-31" },
    { field: "expiryDate", value: "2035-01-02T12:00:00Z" },
  ])(
    "rejects non-calendar $field input $value at the route before writing",
    async ({ field, value }) => {
      await expect(
        owner().submitInfo({
          passengerId: 81,
          ...travelDocument(),
          [field]: value,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await db.select().from(apisData)).toEqual([]);
    }
  );

  it.each([
    {
      label: "missing number",
      change: { documentNumber: "" },
      error: "Document number is required",
    },
    {
      label: "missing surname",
      change: { surname: "" },
      error: "Surname is required",
    },
    {
      label: "blank given names",
      change: { givenNames: "   " },
      error: "Given names is required",
    },
    {
      label: "short number",
      change: { documentNumber: "1234" },
      error: "Document number must be 5-20 alphanumeric characters",
    },
    {
      label: "invalid number",
      change: { documentNumber: "SYN#2345" },
      error: "Document number must be 5-20 alphanumeric characters",
    },
    {
      label: "invalid issuing country",
      change: { issuingCountry: "S1" },
      error:
        "issuing country must be a valid ISO country code (2-3 uppercase letters)",
    },
    {
      label: "invalid nationality",
      change: { nationality: "1AU" },
      error:
        "nationality must be a valid ISO country code (2-3 uppercase letters)",
    },
    {
      label: "invalid residence country",
      change: { residenceCountry: "S1" },
      error:
        "residence country must be a valid ISO country code (2-3 uppercase letters)",
    },
    {
      label: "expired document",
      change: { expiryDate: "2030-11-19" },
      error: "Travel document has expired",
    },
    {
      label: "future birth date",
      change: { dateOfBirth: "2030-11-21" },
      error: "Date of birth cannot be in the future",
    },
  ])(
    "rejects $label and never writes a validated status",
    async ({ change, error }) => {
      // The service validates persisted/imported records too; API form validation
      // alone is not evidence that the validator handles incomplete native rows.
      await collectPassengerInfo(81, { ...travelDocument(), ...change });
      const before = await storedDocument();
      const result = await administrator().validatePassenger({
        passengerId: 81,
      });
      expect(result).toMatchObject({
        valid: false,
        status: "complete",
        validatedAt: null,
      });
      expect(result.errors).toContain(error);
      expect(await storedDocument()).toEqual(before);
    }
  );

  it.each([
    {
      column: "date_of_birth",
      value: "2029-02-31",
      error: "Date of birth must be a valid calendar date",
    },
    {
      column: "expiry_date",
      value: "2031-02-31",
      error: "Document expiry date must be a valid calendar date",
    },
    {
      column: "expiry_date",
      value: "0000-00-00",
      error: "Document expiry date must be a valid calendar date",
    },
  ])(
    "rejects a legacy invalid DATE in $column instead of normalizing or validating it",
    async ({ column, value, error }) => {
      await collectPassengerInfo(81, travelDocument());
      const connection = await pool!.getConnection();
      try {
        const [settings] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT @@SESSION.sql_mode AS sqlMode"
        );
        try {
          // Isolated fixture injection represents old imported rows. Restore the
          // session mode before the production validator gets a connection.
          await connection.query("SET SESSION sql_mode='ALLOW_INVALID_DATES'");
          await connection.execute(
            `UPDATE apis_data SET ${column}=? WHERE passenger_id=81`,
            [value]
          );
        } finally {
          await connection.query("SET SESSION sql_mode=?", [
            settings[0].sqlMode,
          ]);
        }
      } finally {
        connection.release();
      }
      const result = await validateAPISData(81);
      expect(result).toMatchObject({
        valid: false,
        status: "complete",
        validatedAt: null,
      });
      expect(result.errors).toContain(error);
      const [rows] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT status, validated_at FROM apis_data WHERE passenger_id=81"
      );
      expect(rows[0]).toMatchObject({ status: "complete", validated_at: null });
    }
  );

  it.each(["2030-11-20T00:00:00Z", "2030-11-20T23:59:59Z"])(
    "applies date-only boundaries consistently at %s",
    async instant => {
      vi.setSystemTime(new Date(instant));
      await collectPassengerInfo(81, {
        ...travelDocument(),
        dateOfBirth: "2030-11-20",
        expiryDate: "2030-11-20",
      });
      const result = await validateAPISData(81);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(["Travel document has expired"]);
      expect(await storedDocument()).toMatchObject({
        status: "complete",
        validatedAt: null,
      });
      await collectPassengerInfo(81, {
        ...travelDocument(),
        dateOfBirth: "2030-11-20",
        expiryDate: "2030-11-21",
      });
      expect(await validateAPISData(81)).toMatchObject({
        valid: true,
        errors: [],
      });
      await collectPassengerInfo(81, {
        ...travelDocument(),
        dateOfBirth: "2030-11-21",
      });
      expect(await validateAPISData(81)).toMatchObject({
        valid: false,
        errors: ["Date of birth cannot be in the future"],
        validatedAt: null,
      });
      expect(await storedDocument()).toMatchObject({
        status: "complete",
        validatedAt: null,
      });
    }
  );

  it.each(["paxlst", "pnrgov"] as const)(
    "matches mixed multi-sector counts, missing flags and the %s draft",
    async format => {
      await db.insert(schema.bookingSegments).values([
        {
          bookingId: 71,
          flightId: 41,
          segmentOrder: 1,
          departureDate: departure,
          status: "cancelled",
          seatsReserved: false,
        },
        {
          bookingId: 71,
          flightId: 42,
          segmentOrder: 2,
          departureDate: departure,
          status: "confirmed",
          seatsReserved: true,
        },
      ]);
      await db
        .insert(schema.bookings)
        .values(booking(72, { flightId: 42, numberOfPassengers: 1 }));
      await db.insert(schema.passengers).values({
        id: 83,
        bookingId: 72,
        tenantId: 3,
        firstName: "Ghost",
        lastName: "Cancelled",
      });
      await db.insert(schema.bookingSegments).values([
        {
          bookingId: 72,
          flightId: 41,
          segmentOrder: 1,
          departureDate: departure,
          status: "confirmed",
          seatsReserved: true,
        },
        {
          bookingId: 72,
          flightId: 42,
          segmentOrder: 2,
          departureDate: departure,
          status: "cancelled",
          seatsReserved: false,
        },
      ]);
      await owner().submitInfo({ passengerId: 81, ...travelDocument() });
      await administrator().validatePassenger({ passengerId: 81 });
      const status = await administrator().getFlightStatus({ flightId: 42 });
      expect(status).toMatchObject({
        totalPassengers: 2,
        readyForSubmission: false,
        summary: {
          validated: 1,
          incomplete: 1,
          complete: 0,
          submitted: 0,
          rejected: 0,
        },
      });
      expect(
        status.passengerStatuses.map(passenger => passenger.passengerId).sort()
      ).toEqual([81, 82]);
      expect(await flagIncompletePassengers(42)).toMatchObject({
        totalPassengers: 2,
        incompleteCount: 1,
        incompletePassengers: [
          { passengerId: 82, reason: "No APIS data submitted" },
        ],
      });
      const draft = await administrator().generateMessage({
        flightId: 42,
        format,
      });
      expect(draft).toMatchObject({
        passengerCount: 2,
        validatedCount: 1,
        missingCount: 1,
        format,
      });
      expect(draft.messageContent).toContain("SYN12345");
      expect(draft.messageContent).not.toContain("GHOST");
      if (format === "paxlst")
        expect(draft.messageContent).not.toContain("MISSING");
      const foreign = apisRouter.createCaller(context(1, 4, "admin"));
      await expect(
        foreign.generateMessage({ flightId: 42, format })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  );

  it("refuses actual authority submission and leaves no submitted state or invented acknowledgment", async () => {
    await owner().submitInfo({ passengerId: 81, ...travelDocument() });
    await administrator().validatePassenger({ passengerId: 81 });
    const before = await storedDocument();
    expect(await administrator().getSubmissionCapability()).toEqual({
      available: false,
      reason: "authority_transport_unavailable",
    });
    await expect(
      administrator().submitToAuthorities({ flightId: 41, destination: "SA" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.select().from(apisSubmissions)).toEqual([]);
    expect(await getFlightSubmissions(41)).toEqual([]);
    expect(await storedDocument()).toEqual(before);
  });

  it("initializes a layout once, rejects a second initialization and never sells its blocked seat", async () => {
    expect(
      await adminSeats().initializeFlightSeats({ flightId: 41, seatMapId: 51 })
    ).toEqual({ seatsCreated: 3 });
    const initial = await db.select().from(schema.seatInventory);
    await expect(
      adminSeats().initializeFlightSeats({ flightId: 41, seatMapId: 51 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(schema.seatInventory)).toEqual(initial);
    expect(
      new Set(initial.map(seat => `${seat.flightId}:${seat.seatNumber}`)).size
    ).toBe(3);
    await expect(
      seats().selectSeat({
        flightId: 41,
        bookingId: 71,
        passengerId: 81,
        seatNumber: "1C",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(schema.seatInventory)).toEqual(initial);
  });

  it("reads current gate, seat and document state and revokes stale boarding passes without double-counting check-in", async () => {
    const checkIn = await checkedInPassenger();
    const originalNonce = (await assignedSeat()).checkInNonce;
    expect(checkIn.seat).toMatchObject({
      flightId: 41,
      bookingId: 71,
      passengerId: 81,
      seatNumber: "1A",
    });
    const first = await seats().getBoardingPass({
      flightId: 41,
      passengerId: 81,
    });
    expect(first).toMatchObject({
      gate: null,
      boardingTime: null,
      seat: { seatNumber: "1A" },
      passenger: { firstName: "Ada", lastName: "Valid" },
    });
    const signed = verifyBoardingPass(first.barcodeData);
    expect(signed).toMatchObject({
      valid: true,
      data: {
        bookingId: 71,
        passengerId: 81,
        flightId: 41,
        seatNumber: "1A",
        originId: 1,
        destinationId: 2,
      },
    });
    expect(await passes().verify({ token: first.barcodeData })).toMatchObject({
      valid: true,
    });
    expect(await passes().verify({ token: first.bcbp })).toMatchObject({
      valid: true,
      format: "bcbp",
    });

    await db.insert(schema.airportGates).values([
      { id: 91, airportId: 1, gateNumber: "A1" },
      { id: 92, airportId: 1, gateNumber: "B2" },
    ]);
    await db.insert(schema.gateAssignments).values({
      id: 95,
      flightId: 41,
      gateId: 91,
      boardingStartTime: new Date("2030-11-21T11:30:00Z"),
    });
    expect(
      await seats().getBoardingPass({ flightId: 41, passengerId: 81 })
    ).toMatchObject({ gate: "A1" });
    await db
      .update(schema.gateAssignments)
      .set({ gateId: 92, boardingStartTime: new Date("2030-11-21T11:35:00Z") })
      .where(eq(schema.gateAssignments.id, 95));
    expect(
      await seats().getBoardingPass({ flightId: 41, passengerId: 81 })
    ).toMatchObject({
      gate: "B2",
      boardingTime: new Date("2030-11-21T11:35:00Z"),
    });

    await owner().submitInfo({
      passengerId: 81,
      ...travelDocument(),
      documentNumber: "CHANGED123",
    });
    expect(await passes().verify({ token: first.barcodeData })).toMatchObject({
      valid: false,
    });
    expect(await passes().verify({ token: first.bcbp })).toMatchObject({
      valid: false,
    });
    const changedDocument = await seats().getBoardingPass({
      flightId: 41,
      passengerId: 81,
    });
    expect(changedDocument.barcodeData).not.toBe(first.barcodeData);
    expect(
      await passes().verify({ token: changedDocument.barcodeData })
    ).toMatchObject({ valid: true });

    await adminSeats().undoCheckIn({
      flightId: 41,
      bookingId: 71,
      passengerId: 81,
    });
    expect(
      await passes().verify({ token: changedDocument.barcodeData })
    ).toMatchObject({ valid: false });
    await seats().checkIn({
      flightId: 41,
      bookingId: 71,
      passengerId: 81,
      seatNumber: "1B",
    });
    const changedNonce = (await assignedSeat()).checkInNonce;
    await seats().checkIn({
      flightId: 41,
      bookingId: 71,
      passengerId: 81,
      seatNumber: "1B",
    });
    expect((await assignedSeat()).checkInNonce).toBe(changedNonce);
    expect(changedNonce).not.toBe(originalNonce);
    const moved = await seats().getBoardingPass({
      flightId: 41,
      passengerId: 81,
    });
    expect(moved).toMatchObject({ gate: "B2", seat: { seatNumber: "1B" } });
    expect(await passes().verify({ token: moved.barcodeData })).toMatchObject({
      valid: true,
      data: { seatNumber: "1B", passengerId: 81, flightId: 41 },
    });
    expect(await adminSeats().getCheckInStatus({ flightId: 41 })).toMatchObject(
      {
        totalPassengers: 2,
        checkedIn: 1,
        notCheckedIn: 1,
        boardingPassesIssued: 1,
      }
    );
    await adminSeats().undoCheckIn({
      flightId: 41,
      bookingId: 71,
      passengerId: 81,
    });
    expect(await adminSeats().getCheckInStatus({ flightId: 41 })).toMatchObject(
      {
        totalPassengers: 2,
        checkedIn: 0,
        notCheckedIn: 2,
        boardingPassesIssued: 0,
      }
    );
    await expect(
      seats().getBoardingPass({ flightId: 41, passengerId: 81 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await passes().verify({ token: moved.barcodeData })).toMatchObject({
      valid: false,
    });
  });

  it("serializes validation with a competing document update and never validates the replacement from an earlier read", async () => {
    await owner().submitInfo({ passengerId: 81, ...travelDocument() });
    const connection = await pool!.getConnection();
    const validatorDb = drizzle(connection, { schema, mode: "default" });
    const gate = holdStatement(
      connection,
      /^\s*UPDATE apis_data\s+SET status = 'validated'/i
    );
    state.db = validatorDb;
    const validating = administrator().validatePassenger({ passengerId: 81 });
    let updating:
      ReturnType<ReturnType<typeof owner>["submitInfo"]> | undefined;
    let updateSettled = false;
    let nativeWait = false;
    try {
      await Promise.race([
        gate.entered,
        validating.then(() => {
          throw new Error("APIS validation did not reach its write barrier");
        }),
      ]);
      state.db = db;
      updating = owner().submitInfo({
        passengerId: 81,
        ...travelDocument(),
        documentNumber: "SYN67890",
        dateOfBirth: "2031-01-01",
      });
      const updateOutcome = updating.then(
        value => {
          updateSettled = true;
          return { value };
        },
        error => {
          updateSettled = true;
          return { error };
        }
      );
      const deadline = performance.now() + 5000;
      while (!updateSettled && performance.now() < deadline) {
        const [waits] = await admin!.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS count
           FROM performance_schema.data_lock_waits AS waits
           JOIN performance_schema.data_locks AS locks
             ON locks.ENGINE = waits.ENGINE
            AND locks.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
           WHERE locks.OBJECT_SCHEMA = ? AND locks.OBJECT_NAME = 'apis_data'`,
          [databaseName]
        );
        nativeWait = Number(waits[0]?.count) > 0;
        if (nativeWait) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      gate.release();
      await expect(validating).resolves.toMatchObject({
        valid: true,
        status: "validated",
      });
      expect(await updateOutcome).toMatchObject({
        value: { status: "complete" },
      });
      expect(await storedDocument()).toMatchObject({
        documentNumber: "SYN67890",
        status: "complete",
        validatedAt: null,
      });
      expect(
        nativeWait,
        "the replacement waits on the actual APIS row until validation commits"
      ).toBe(true);
      expect(
        await administrator().validatePassenger({ passengerId: 81 })
      ).toMatchObject({
        valid: false,
        errors: expect.arrayContaining([
          "Date of birth cannot be in the future",
        ]),
      });
      expect((await storedDocument()).validatedAt).toBeNull();
    } finally {
      gate.release();
      await Promise.allSettled([validating, updating]);
      gate.restore();
      state.db = db;
      connection.release();
    }
  }, 15000);

  it("binds boarding pass routes to the owner, requested flight and checked-in passenger", async () => {
    await checkedInPassenger();
    const otherOwner = seatMapRouter.createCaller(context(10));
    await expect(
      otherOwner.getBoardingPass({ flightId: 41, passengerId: 81 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      boardingPassRouter
        .createCaller(context(10))
        .issue({ bookingId: 71, passengerId: 81, flightId: 41 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      seats().getBoardingPass({ flightId: 42, passengerId: 81 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      passes().issue({ bookingId: 71, passengerId: 81, flightId: 42 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      seats().getBoardingPass({ flightId: 41, passengerId: 82 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      passes().issue({ bookingId: 71, passengerId: 82, flightId: 41 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("refuses a stale boarding sequence after a concurrent undo and check-in, then returns a consistent fresh document", async () => {
    await checkedInPassenger();
    await owner().submitInfo({ passengerId: 82, ...travelDocument() });
    await seats().checkIn({
      bookingId: 71,
      flightId: 41,
      passengerId: 82,
      seatNumber: "1B",
    });
    const before = await assignedSeat();
    const connection = await pool!.getConnection();
    const readerDb = drizzle(connection, { schema, mode: "default" });
    const gate = holdStatement(
      connection,
      /^select .*`boardingSequence`.* from `seat_inventory`/i,
      "after"
    );
    state.db = readerDb;
    const reading = seats().getBoardingPass({ flightId: 41, passengerId: 81 });
    try {
      await Promise.race([
        gate.entered,
        reading.then(() => {
          throw new Error(
            "Boarding reader did not reach its seat-read barrier"
          );
        }),
      ]);
      state.db = db;
      await adminSeats().undoCheckIn({
        bookingId: 71,
        flightId: 41,
        passengerId: 81,
      });
      await seats().checkIn({
        bookingId: 71,
        flightId: 41,
        passengerId: 81,
        seatNumber: "1A",
      });
      const current = await assignedSeat();
      expect(current.seatNumber).toBe(before.seatNumber);
      expect(current.boardingSequence).toBe(3);
      expect(current.boardingSequence).not.toBe(before.boardingSequence);
      expect(current.checkInNonce).not.toBe(before.checkInNonce);
      gate.release();
      await expect(reading).rejects.toThrow(
        "Boarding document changed during generation; retry"
      );

      const fresh = await seats().getBoardingPass({
        flightId: 41,
        passengerId: 81,
      });
      expect(fresh.seat.boardingSequence).toBe(current.boardingSequence);
      expect(verifyBoardingPass(fresh.barcodeData)).toMatchObject({
        valid: true,
        data: {
          sequence: fresh.seat.boardingSequence,
          checkInNonce: current.checkInNonce,
        },
      });
      expect(await passes().verify({ token: fresh.bcbp })).toMatchObject({
        valid: true,
        data: { sequence: fresh.seat.boardingSequence },
      });
    } finally {
      gate.release();
      await Promise.allSettled([reading]);
      gate.restore();
      state.db = db;
      connection.release();
    }
  });

  it("refuses a stale seat release after a competing owner claims the seat", async () => {
    await adminSeats().initializeFlightSeats({ flightId: 41, seatMapId: 51 });
    await seats().selectSeat({
      flightId: 41,
      seatNumber: "1A",
      bookingId: 71,
      passengerId: 81,
    });
    await db.insert(schema.bookings).values(
      booking(72, {
        userId: 10,
        numberOfPassengers: 1,
      })
    );
    await db.insert(schema.passengers).values({
      id: 83,
      bookingId: 72,
      tenantId: 3,
      firstName: "Synthetic",
      lastName: "Replacement",
      type: "adult",
    });

    const connection = await pool!.getConnection();
    const readerDb = drizzle(connection, { schema, mode: "default" });
    // Hold the real router preflight result after SQL has read owner 9's seat.
    // A competing owner completes release/selection before that result resumes.
    const gate = holdStatement(
      connection,
      /^select .*`bookingId`.*`passengerId`.* from `seat_inventory`/i,
      "after"
    );
    state.db = readerDb;
    const releasing = seats().releaseSeat({ flightId: 41, seatNumber: "1A" });
    try {
      await Promise.race([
        gate.entered,
        releasing.then(() => {
          throw new Error("Seat release did not reach its preflight barrier");
        }),
      ]);
      state.db = db;
      await seats().releaseSeat({ flightId: 41, seatNumber: "1A" });
      await seatMapRouter.createCaller(context(10)).selectSeat({
        flightId: 41,
        seatNumber: "1A",
        bookingId: 72,
        passengerId: 83,
      });
      const replacementSeats = await db.select().from(schema.seatInventory);
      const replacementPassengers = await db.select().from(schema.passengers);
      expect(
        replacementSeats.find(row => row.seatNumber === "1A")
      ).toMatchObject({
        bookingId: 72,
        passengerId: 83,
        status: "occupied",
      });
      expect(replacementPassengers.find(row => row.id === 83)).toMatchObject({
        seatNumber: "1A",
      });

      gate.release();
      await expect(releasing).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Seat assignment changed; refresh and retry",
      });
      expect(await db.select().from(schema.seatInventory)).toEqual(
        replacementSeats
      );
      expect(await db.select().from(schema.passengers)).toEqual(
        replacementPassengers
      );
    } finally {
      gate.release();
      await releasing.catch(() => undefined);
      gate.restore();
      state.db = db;
      connection.release();
    }
  });

  it("waits for a competing booking owner transfer and reauthorizes the locked booking", async () => {
    await adminSeats().initializeFlightSeats({ flightId: 41, seatMapId: 51 });
    await seats().selectSeat({
      flightId: 41,
      seatNumber: "1A",
      bookingId: 71,
      passengerId: 81,
    });
    const beforeSeats = await db.select().from(schema.seatInventory);
    const beforePassengers = await db.select().from(schema.passengers);
    const connection = await pool!.getConnection();
    const transfer = await pool!.getConnection();
    const releaserDb = drizzle(connection, { schema, mode: "default" });
    const gate = holdStatement(
      connection,
      /^select .* from `bookings`.* for update$/i
    );
    state.db = releaserDb;
    const releasing = seats().releaseSeat({ flightId: 41, seatNumber: "1A" });
    let settled = false;
    const outcome = releasing.then(
      value => {
        settled = true;
        return { value };
      },
      error => {
        settled = true;
        return { error };
      }
    );
    let nativeWait = false;
    try {
      await Promise.race([
        gate.entered,
        outcome.then(() => {
          throw new Error(
            "Seat release did not reach its booking-lock barrier"
          );
        }),
      ]);
      await transfer.beginTransaction();
      await transfer.query(
        "UPDATE bookings SET userId = ? WHERE id = ?",
        [10, 71]
      );
      gate.release();

      const deadline = performance.now() + 5000;
      while (!settled && performance.now() < deadline) {
        const [waits] = await admin!.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS count
           FROM performance_schema.data_lock_waits AS waits
           JOIN performance_schema.data_locks AS locks
             ON locks.ENGINE = waits.ENGINE
            AND locks.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
           WHERE locks.OBJECT_SCHEMA = ? AND locks.OBJECT_NAME = 'bookings'`,
          [databaseName]
        );
        nativeWait = Number(waits[0]?.count) > 0;
        if (nativeWait) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(nativeWait).toBe(true);
      expect(settled).toBe(false);
      await transfer.commit();
      await expect(releasing).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await db.select().from(schema.seatInventory)).toEqual(beforeSeats);
      expect(await db.select().from(schema.passengers)).toEqual(
        beforePassengers
      );
      expect(
        (
          await db
            .select()
            .from(schema.bookings)
            .where(eq(schema.bookings.id, 71))
        )[0].userId
      ).toBe(10);
    } finally {
      gate.release();
      await transfer.rollback();
      await outcome;
      gate.restore();
      state.db = db;
      connection.release();
      transfer.release();
    }
  });

  it("refuses cross-tenant seat release without clearing the native assignment", async () => {
    await adminSeats().initializeFlightSeats({ flightId: 41, seatMapId: 51 });
    await seats().selectSeat({
      flightId: 41,
      seatNumber: "1A",
      bookingId: 71,
      passengerId: 81,
    });
    const beforeSeats = await db.select().from(schema.seatInventory);
    const beforePassengers = await db.select().from(schema.passengers);
    await expect(
      seatMapRouter.createCaller(context(9, 4)).releaseSeat({
        flightId: 41,
        seatNumber: "1A",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.select().from(schema.seatInventory)).toEqual(beforeSeats);
    expect(await db.select().from(schema.passengers)).toEqual(beforePassengers);
  });

  it.each(["reader", "issuer", "pdf"] as const)(
    "rejects the same owner's cross-tenant boarding pass $0 route",
    async route => {
      await checkedInPassenger();
      const request =
        route === "reader"
          ? seatMapRouter
              .createCaller(context(9, 4))
              .getBoardingPass({ flightId: 41, passengerId: 81 })
          : route === "issuer"
            ? boardingPassRouter
                .createCaller(context(9, 4))
                .issue({ bookingId: 71, passengerId: 81, flightId: 41 })
            : eticketRouter.createCaller(context(9, 4)).generateBoardingPass({
                bookingId: 71,
                passengerId: 81,
                flightId: 41,
              });
      await expect(request).rejects.toMatchObject({ code: "FORBIDDEN" });
      const [seat] = await db
        .select()
        .from(schema.seatInventory)
        .where(eq(schema.seatInventory.passengerId, 81));
      expect(seat.boardingPassIssued).toBe(false);
    }
  );

  it.each(["admin", "super_admin"] as const)(
    "allows an owning %s to generate a current PDF without an airline context",
    async role => {
      await checkedInPassenger();
      await db
        .update(schema.users)
        .set({ role, tenantId: null })
        .where(eq(schema.users.id, 9));

      const document = await eticketRouter
        .createCaller(context(9, null, role))
        .generateBoardingPass({
          bookingId: 71,
          passengerId: 81,
          flightId: 41,
        });

      expect(
        Buffer.from(document.pdf, "base64").subarray(0, 5).toString()
      ).toBe("%PDF-");
      expect(document.filename).toBe("boarding_71_81_41.pdf");
      expect(document.ticketNumber).toMatch(/^\d{13}$/);
      expect((await assignedSeat()).boardingPassIssued).toBe(true);
      expect(await passes().verify({ token: document.bcbp })).toMatchObject({
        valid: true,
        data: { bookingId: 71, passengerId: 81, flightId: 41 },
      });
    }
  );

  it.each(["admin", "super_admin"] as const)(
    "keeps the PDF owner-only for a non-owning %s before issuance",
    async role => {
      await checkedInPassenger();
      await db
        .update(schema.users)
        .set({ role, tenantId: null })
        .where(eq(schema.users.id, 10));
      const before = await assignedSeat();

      await expect(
        eticketRouter
          .createCaller(context(10, null, role))
          .generateBoardingPass({
            bookingId: 71,
            passengerId: 81,
            flightId: 41,
          })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(await assignedSeat()).toEqual(before);
      const [passenger] = await db
        .select()
        .from(schema.passengers)
        .where(eq(schema.passengers.id, 81));
      expect(passenger.ticketNumber).toBeNull();
      expect(await db.select().from(schema.ticketCoupons)).toHaveLength(0);
    }
  );

  it.each(["passenger", "flight"] as const)(
    "rejects a changed %s tenant under the issuance locks",
    async resource => {
      await checkedInPassenger();
      if (resource === "passenger") {
        await db
          .update(schema.passengers)
          .set({ tenantId: 4 })
          .where(eq(schema.passengers.id, 81));
      } else {
        await db
          .update(schema.flights)
          .set({ tenantId: 4 })
          .where(eq(schema.flights.id, 41));
      }
      await expect(
        passes().issue({ bookingId: 71, passengerId: 81, flightId: 41 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        seats().getBoardingPass({ passengerId: 81, flightId: 41 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await assignedSeat()).boardingPassIssued).toBe(false);
    }
  );

  it("rejects an absent airline context on an assigned booking", async () => {
    await checkedInPassenger();
    await expect(
      boardingPassRouter
        .createCaller(context(9, null))
        .issue({ bookingId: 71, passengerId: 81, flightId: 41 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await assignedSeat()).boardingPassIssued).toBe(false);
  });
});
