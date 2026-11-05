import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express, { type RequestHandler } from "express";
import type { Server } from "node:http";
import { TRPCError } from "@trpc/server";
import type { User } from "../../drizzle/schema";
import type {
  StandardReportDefinition,
  StandardReportResult,
} from "../../shared/standard-reports";
import type { TrpcContext } from "../_core/context";

const state = vi.hoisted(() => ({
  actor: null as Pick<User, "id" | "role" | "tenantId"> | null,
  tenantId: null as number | null,
  contextError: null as Error | null,
  limited: false,
  definition: {
    id: 44,
    title: "Load Factors",
    category: "operations",
    availability: "available",
    description: "Recorded sold inventory divided by physical capacity.",
    limitations: ["Booked inventory is not flown passenger evidence."],
    filters: [
      "startDate",
      "endDate",
      "flightId",
      "origin",
      "destination",
      "status",
    ],
  } as StandardReportDefinition,
  readOps: vi.fn(),
  readFinance: vi.fn(),
  readCommercial: vi.fn(),
  sendEmail: vi.fn(),
  schedules: {
    listStandardReportTemplates: vi.fn(),
    saveStandardReportTemplate: vi.fn(),
    deleteStandardReportTemplate: vi.fn(),
    setStandardReportTemplateEnabled: vi.fn(),
    runStandardReportTemplate: vi.fn(),
    listStandardReportRuns: vi.fn(),
    downloadStandardReportRun: vi.fn(),
  },
}));

// Keep the actual report router, validators, role/tenant authorization, output
// contract and report service. Only the data/provider boundaries are fixtures.
vi.mock("../services/standard-reports-ops.service", () => ({
  operationsReportDefinitions: [state.definition],
  getOperationsStandardReport: state.readOps,
}));
vi.mock("../services/standard-reports-finance.service", () => ({
  financeReportDefinitions: [],
  getFinanceStandardReport: state.readFinance,
}));
vi.mock("../services/standard-reports-commercial.service", () => ({
  commercialReportDefinitions: [],
  getCommercialStandardReport: state.readCommercial,
}));
vi.mock("../services/standard-report-schedules.service", () => state.schedules);
vi.mock("../services/email.service", () => ({
  sendEmail: state.sendEmail,
  sendEmailWithReceipt: state.sendEmail,
}));
vi.mock("../services/rate-limit.service", () => ({
  rateLimitService: {
    checkStrictRateLimit: vi.fn(),
    getRateLimitHeaders: vi.fn(),
  },
}));

import { standardReportsRouter } from "../routers/standard-reports";
import { createReportPreviewRouter } from "../routes/report-preview";

type PreviewOptions = Parameters<typeof createReportPreviewRouter>[0];
const createContext = vi.fn<PreviewOptions["createContext"]>(({ req, res }) => {
  if (state.contextError) throw state.contextError;
  return {
    req,
    res,
    user: state.actor as User | null,
    tenantId: state.tenantId,
    authMethod: state.actor ? "bearer" : null,
  } satisfies TrpcContext;
});
const runReport = vi.fn<PreviewOptions["runReport"]>((input, ctx) =>
  standardReportsRouter.createCaller(ctx).run(input)
);
const rateLimit = vi.fn<RequestHandler>((_req, res, next) => {
  if (state.limited) {
    res
      .status(429)
      .setHeader("Retry-After", "60")
      .json({ code: "TOO_MANY_REQUESTS" });
    return;
  }
  next();
});

const actor = { id: 11, role: "ops", tenantId: 101 } as const;
const filters = { startDate: "2026-11-03", endDate: "2026-11-03" };
const validInput = {
  reportId: 44,
  filters,
  columns: ["loadFactor", "sold", "flightNumber"],
};
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  // Match production ordering: this endpoint owns its media-type and size
  // checks before any general JSON parser can consume its body.
  app.use(
    "/api/rest",
    createReportPreviewRouter({ createContext, runReport, rateLimit })
  );
  app.use(express.json({ limit: "1mb" }));
  app.post("/api/rest/legacy", (req, res) => res.json(req.body));
  app.use((_req, res) => res.status(404).json({ code: "NOT_FOUND" }));
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Report preview test listener unavailable");
  base = `http://127.0.0.1:${address.port}/api/rest`;
});

afterAll(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  state.actor = actor;
  state.tenantId = actor.tenantId;
  state.contextError = null;
  state.limited = false;
  state.definition.availability = "available";
  state.definition.limitations = [
    "Booked inventory is not flown passenger evidence.",
  ];
  state.readOps.mockReset().mockResolvedValue({
    columns: [
      { key: "flightNumber", label: "Flight", type: "text" },
      { key: "sold", label: "Sold", type: "number" },
      { key: "loadFactor", label: "Load factor", type: "number" },
    ],
    rows: [
      {
        flightNumber: "XT440",
        sold: 0,
        loadFactor: null,
        privatePassengerField: "MUST-NOT-APPEAR",
      },
    ],
    notes: ["Zero-capacity flights have a null load factor."],
  });
});

async function send(
  method: string,
  options: {
    body?: unknown;
    rawBody?: string;
    contentType?: string | null;
    accept?: string;
    query?: string;
  } = {}
) {
  const contentType =
    options.contentType === undefined
      ? "application/json"
      : options.contentType;
  // Bytes prevent Fetch from adding text/plain when testing a missing type.
  const body = Buffer.from(
    options.rawBody ?? JSON.stringify(options.body ?? validInput)
  );
  return fetch(`${base}/reports/preview${options.query ?? ""}`, {
    method,
    headers: {
      ...(contentType ? { "Content-Type": contentType } : {}),
      ...(options.accept ? { Accept: options.accept } : {}),
    },
    ...(["GET", "HEAD", "OPTIONS"].includes(method) ? {} : { body }),
  });
}

function expectDiscovery(response: Response) {
  expect(response.headers.get("accept-query")).toBe("application/json");
  expect(
    response.headers
      .get("allow")
      ?.split(",")
      .map(method => method.trim())
      .sort()
  ).toEqual(["OPTIONS", "POST", "QUERY"]);
  expect(response.headers.get("cache-control")).toBe("no-store");
}

function expectNoProviderWrites() {
  expect(state.sendEmail).not.toHaveBeenCalled();
  for (const write of Object.values(state.schedules))
    expect(write).not.toHaveBeenCalled();
}

function expectNoReads() {
  for (const read of [state.readOps, state.readFinance, state.readCommercial])
    expect(read).not.toHaveBeenCalled();
  expectNoProviderWrites();
}

describe("report preview HTTP QUERY pilot", () => {
  it("returns the same authorized report for QUERY, POST and a repeated QUERY", async () => {
    const reports: StandardReportResult[] = [];
    for (const method of ["QUERY", "POST", "QUERY"]) {
      const response = await send(method);
      expect(response.status).toBe(200);
      expectDiscovery(response);
      expect(response.headers.get("content-type")).toContain(
        "application/json"
      );
      const report = (await response.json()) as StandardReportResult;
      expect(Number.isFinite(Date.parse(report.generatedAt))).toBe(true);
      reports.push(report);
    }
    // Safe/idempotent does not promise identical generation timestamps.
    const comparable = reports.map(
      ({ generatedAt: _generatedAt, ...data }) => data
    );
    expect(comparable[1]).toEqual(comparable[0]);
    expect(comparable[2]).toEqual(comparable[0]);
    expect(comparable[0]).toMatchObject({
      reportId: 44,
      filters,
      total: 1,
      rows: [{ loadFactor: null, sold: 0, flightNumber: "XT440" }],
    });
    expect(reports[0].columns.map(column => column.key)).toEqual(
      validInput.columns
    );
    expect(JSON.stringify(reports)).not.toContain("MUST-NOT-APPEAR");
    expect(state.readOps).toHaveBeenCalledTimes(3);
    for (const call of state.readOps.mock.calls)
      expect(call).toEqual([44, filters, { userId: 11, tenantId: 101 }]);
    expectNoProviderWrites();
  });

  it("accepts omitted optional filters and a JSON UTF-8 media-type parameter", async () => {
    const response = await send("QUERY", {
      body: { reportId: 44 },
      contentType: "application/json; charset=utf-8",
    });
    expect(response.status).toBe(200);
    expect(state.readOps).toHaveBeenCalledExactlyOnceWith(
      44,
      {},
      {
        userId: 11,
        tenantId: 101,
      }
    );
    expectNoProviderWrites();
  });

  it("advertises support through OPTIONS without creating auth context or reading data", async () => {
    state.actor = null;
    state.tenantId = null;
    state.limited = true;
    const response = await send("OPTIONS", { contentType: null });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expectDiscovery(response);
    expect(createContext).not.toHaveBeenCalled();
    expect(runReport).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
    expectNoReads();
  });

  it("retains discovery and Retry-After when the HTTP limiter refuses a preview", async () => {
    state.limited = true;
    for (const method of ["QUERY", "POST"]) {
      const response = await send(method);
      expect(response.status).toBe(429);
      expectDiscovery(response);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(await response.json()).toEqual({ code: "TOO_MANY_REQUESTS" });
    }
    expect(rateLimit).toHaveBeenCalledTimes(2);
    expect(createContext).not.toHaveBeenCalled();
    expect(runReport).not.toHaveBeenCalled();
    expectNoReads();
  });

  it.each(["GET", "HEAD", "PUT", "PATCH", "DELETE"])(
    "rejects %s with 405 and discovery headers before execution",
    async method => {
      const response = await send(method);
      expect(response.status).toBe(405);
      expectDiscovery(response);
      if (method === "HEAD") expect(await response.text()).toBe("");
      else await response.text();
      expect(createContext).not.toHaveBeenCalled();
      expect(runReport).not.toHaveBeenCalled();
      expectNoReads();
    }
  );

  it.each([
    { label: "anonymous", actor: null, tenantId: null, status: 401 },
    {
      label: "ordinary customer",
      actor: { ...actor, role: "user" },
      tenantId: 101,
      status: 403,
    },
    {
      label: "support staff",
      actor: { ...actor, role: "support" },
      tenantId: 101,
      status: 403,
    },
    {
      label: "finance outside operations category",
      actor: { ...actor, role: "finance" },
      tenantId: 101,
      status: 403,
    },
    { label: "mismatched tenant", actor, tenantId: 202, status: 403 },
    { label: "missing tenant", actor, tenantId: null, status: 403 },
  ])(
    "preserves actual report authorization for $label on both transports",
    async ({ actor: currentActor, tenantId, status }) => {
      state.actor = currentActor as typeof state.actor;
      state.tenantId = tenantId;
      for (const method of ["QUERY", "POST"]) {
        const response = await send(method);
        expect(response.status).toBe(status);
        expectDiscovery(response);
        await response.text();
      }
      expectNoReads();
    }
  );

  it("returns 406 when the client excludes the JSON response representation", async () => {
    for (const method of ["QUERY", "POST"]) {
      const response = await send(method, { accept: "text/csv" });
      expect(response.status).toBe(406);
      expectDiscovery(response);
      await response.text();
    }
    expect(runReport).not.toHaveBeenCalled();
    expectNoReads();
  });

  it("preserves explicit platform administrator scope without inventing a tenant", async () => {
    state.actor = { ...actor, role: "admin", tenantId: null };
    state.tenantId = null;
    const response = await send("QUERY");
    expect(response.status).toBe(200);
    expect(state.readOps).toHaveBeenCalledExactlyOnceWith(44, filters, {
      userId: 11,
      tenantId: undefined,
    });
    expectNoProviderWrites();
  });

  it.each([
    { label: "another report", body: { ...validInput, reportId: 45 } },
    { label: "string report ID", body: { ...validInput, reportId: "44" } },
    { label: "caller tenant", body: { ...validInput, tenantId: 202 } },
    {
      label: "nested caller tenant",
      body: { ...validInput, filters: { tenantId: 202 } },
    },
    {
      label: "query text",
      body: { ...validInput, sql: "SELECT * FROM users" },
    },
    { label: "delivery request", body: { ...validInput, emailToOwner: true } },
    { label: "schedule request", body: { ...validInput, cadence: "daily" } },
    { label: "export request", body: { ...validInput, format: "csv" } },
    {
      label: "reversed date range",
      body: {
        ...validInput,
        filters: { startDate: "2026-11-04", endDate: "2026-11-03" },
      },
    },
    {
      label: "duplicate columns",
      body: { ...validInput, columns: ["sold", "sold"] },
    },
    { label: "array body", body: [validInput] },
  ])("rejects $label before invoking the report", async ({ body }) => {
    for (const method of ["QUERY", "POST"]) {
      const response = await send(method, { body });
      expect(response.status).toBe(400);
      expectDiscovery(response);
      await response.text();
    }
    expect(runReport).not.toHaveBeenCalled();
    expectNoReads();
  });

  it.each([
    { label: "missing type", contentType: null, status: 400 },
    { label: "plain text", contentType: "text/plain", status: 415 },
    {
      label: "undeclared JSON format",
      contentType: "application/sql",
      status: 415,
    },
  ])(
    "rejects $label without inferring a supported JSON content type",
    async ({ contentType, status }) => {
      for (const method of ["QUERY", "POST"]) {
        const response = await send(method, { contentType });
        expect(response.status).toBe(status);
        expectDiscovery(response);
        await response.text();
      }
      expect(runReport).not.toHaveBeenCalled();
      expectNoReads();
    }
  );

  it.each(["QUERY", "POST"])(
    "rejects malformed JSON and mixed URL/body inputs on %s before execution",
    async method => {
      for (const options of [
        { rawBody: '{"reportId":44,' },
        { rawBody: "" },
        { rawBody: "null" },
        { query: "?reportId=44" },
        { query: "?tenantId=202" },
      ]) {
        const response = await send(method, options);
        expect(response.status).toBe(400);
        expectDiscovery(response);
        const text = await response.text();
        expect(text).not.toContain("SyntaxError");
      }
      expect(runReport).not.toHaveBeenCalled();
      expectNoReads();
    }
  );

  it.each(["QUERY", "POST"])(
    "bounds the %s request body at one MiB before report execution",
    async method => {
      const response = await send(method, {
        rawBody: JSON.stringify({
          reportId: 44,
          filters: { status: "x".repeat(1024 * 1024) },
        }),
      });
      expect(response.status).toBe(413);
      expectDiscovery(response);
      const text = await response.text();
      expect(text).not.toContain("PayloadTooLargeError");
      expect(runReport).not.toHaveBeenCalled();
      expectNoReads();
    }
  );

  it("keeps report-specific filter validation and prevents blocked source reads", async () => {
    const unsupported = await send("QUERY", {
      body: { reportId: 44, filters: { bookingReference: "ABC123" } },
    });
    expect(unsupported.status).toBe(400);
    expectNoReads();

    state.definition.availability = "blocked";
    state.definition.limitations = ["Provider acceptance required"];
    for (const method of ["QUERY", "POST"]) {
      const response = await send(method);
      expect(response.status).toBe(412);
      expectDiscovery(response);
      expect(await response.json()).toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "Provider acceptance required",
      });
    }
    expectNoReads();
  });

  it.each([
    { code: "TOO_MANY_REQUESTS" as const, status: 429 },
    { code: "SERVICE_UNAVAILABLE" as const, status: 503 },
  ])(
    "preserves $status from the original report boundary",
    async ({ code, status }) => {
      state.readOps.mockRejectedValue(
        new TRPCError({ code, message: "Try later" })
      );
      for (const method of ["QUERY", "POST"]) {
        const response = await send(method);
        expect(response.status).toBe(status);
        expectDiscovery(response);
        expect(await response.json()).toMatchObject({ code });
      }
      expectNoProviderWrites();
    }
  );

  it("masks unexpected authentication failures and report internals", async () => {
    state.contextError = new Error("private auth key: MUST-NOT-APPEAR");
    const authentication = await send("QUERY");
    expect(authentication.status).toBe(500);
    expectDiscovery(authentication);
    expect(await authentication.text()).not.toContain("MUST-NOT-APPEAR");
    expectNoReads();

    state.contextError = null;
    state.readOps.mockRejectedValue(
      new Error("private database DSN: MUST-NOT-APPEAR")
    );
    const reader = await send("QUERY");
    expect(reader.status).toBe(500);
    expectDiscovery(reader);
    expect(await reader.text()).not.toContain("MUST-NOT-APPEAR");
    expectNoProviderWrites();
  });

  it("leaves existing REST routes and their JSON parsing untouched", async () => {
    const response = await fetch(`${base}/legacy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "existing REST" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: "existing REST" });
    expect(response.headers.get("accept-query")).toBeNull();
    expect(createContext).not.toHaveBeenCalled();
    expect(runReport).not.toHaveBeenCalled();
    expectNoReads();
  });
});
