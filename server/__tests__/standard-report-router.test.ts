import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import { reportTemplateInputSchema } from "../contracts/standard-reports";

const state = vi.hoisted(() => ({
  readOps: vi.fn(),
  readFinance: vi.fn(),
  readCommercial: vi.fn(),
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
vi.mock("../services/standard-reports-ops.service", () => ({
  operationsReportDefinitions: [
    {
      id: 5,
      title: "Load",
      category: "operations",
      availability: "available",
      description: "Recorded load",
      limitations: [],
      filters: ["startDate", "endDate"],
    },
    {
      id: 18,
      title: "External dispatch",
      category: "operations",
      availability: "blocked",
      description: "External evidence",
      limitations: ["Provider acceptance required"],
      filters: [],
    },
  ],
  getOperationsStandardReport: state.readOps,
}));
vi.mock("../services/standard-reports-finance.service", () => ({
  financeReportDefinitions: [
    {
      id: 55,
      title: "Payments",
      category: "finance",
      availability: "partial",
      description: "Recorded payments",
      limitations: ["Local evidence only"],
      filters: ["startDate", "endDate"],
    },
  ],
  getFinanceStandardReport: state.readFinance,
}));
vi.mock("../services/standard-reports-commercial.service", () => ({
  commercialReportDefinitions: [
    {
      id: 66,
      title: "Sales",
      category: "commercial",
      availability: "available",
      description: "Recorded sales",
      limitations: [],
      filters: ["startDate", "endDate"],
    },
  ],
  getCommercialStandardReport: state.readCommercial,
}));
vi.mock("../services/standard-report-schedules.service", () => state.schedules);
vi.mock("../services/rate-limit.service", () => ({
  rateLimitService: {
    checkStrictRateLimit: vi.fn(),
    getRateLimitHeaders: vi.fn(),
  },
}));
import { standardReportsRouter } from "../routers/standard-reports";

const owner = {
  id: 11,
  role: "ops",
  tenantId: 101,
  email: "report-owner@example.test",
};
const filters = { startDate: "2026-11-03", endDate: "2026-11-03" };
const requestId = "fb05995d-a209-4c33-84b8-19a2899e678f";
const input = reportTemplateInputSchema.parse({
  reportId: 5,
  name: "Daily load",
  filters,
  columns: ["quantity", "record"],
  format: "csv",
});
const saved = {
  ...input,
  id: 71,
  createdAt: new Date("2026-11-04T08:00:00Z"),
  updatedAt: new Date("2026-11-04T08:00:00Z"),
  nextRunAt: null,
};
const run = {
  id: 81,
  templateId: 71,
  reportId: 5,
  name: input.name,
  format: "csv",
  status: "ready",
  recordCount: 1,
  checksum: "a".repeat(64),
  deliveryStatus: "none",
  emailReceiptId: null,
  emailAcceptedAt: null,
  createdAt: new Date(),
  completedAt: new Date(),
  errorMessage: null,
};
const output = {
  filename: "load.csv",
  contentType: "text/csv",
  content: "quantity,record\n0,local",
  checksum: "a".repeat(64),
  recordCount: 1,
};

function caller(
  user: typeof owner | null = owner,
  tenantId: number | null = user?.tenantId ?? null
) {
  return standardReportsRouter.createCaller({
    user: user as User | null,
    tenantId,
    authMethod: user ? "bearer" : null,
    req: undefined as unknown as TrpcContext["req"],
    res: undefined as unknown as TrpcContext["res"],
  });
}
const allRequests = (client: ReturnType<typeof caller>) => [
  () => client.catalog(),
  () => client.run({ reportId: 5, filters }),
  () => client.export({ reportId: 5, filters, format: "csv" }),
  () => client.templates(),
  () => client.saveTemplate({ template: input }),
  () => client.deleteTemplate({ id: 71 }),
  () => client.setTemplateEnabled({ id: 71, enabled: false }),
  () => client.runTemplate({ id: 71, requestId }),
  () => client.runs({ beforeId: 90 }),
  () => client.downloadRun({ id: 81 }),
];

beforeEach(() => {
  vi.resetAllMocks();
  const source = {
    columns: [
      { key: "record", label: "Record", type: "text" },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "unknown", label: "Unknown", type: "text" },
    ],
    rows: [
      {
        record: "=1+2 <script>",
        quantity: 0,
        unknown: null,
        privateColumn: "MUST-NOT-EXPORT",
      },
    ],
    notes: [],
  };
  for (const reader of [state.readOps, state.readFinance, state.readCommercial])
    reader.mockResolvedValue(source);
  state.schedules.listStandardReportTemplates.mockResolvedValue([saved]);
  state.schedules.saveStandardReportTemplate.mockResolvedValue(saved);
  state.schedules.deleteStandardReportTemplate.mockResolvedValue({
    deleted: true,
  });
  state.schedules.setStandardReportTemplateEnabled.mockResolvedValue({
    ...saved,
    enabled: false,
  });
  state.schedules.runStandardReportTemplate.mockResolvedValue(run);
  state.schedules.listStandardReportRuns.mockResolvedValue([run]);
  state.schedules.downloadStandardReportRun.mockResolvedValue(output);
});

describe("standard report router authorization and contracts", () => {
  it.each([
    { user: null, tenant: null, code: "UNAUTHORIZED" },
    { user: { ...owner, role: "user" }, tenant: 101, code: "FORBIDDEN" },
    { user: { ...owner, role: "support" }, tenant: 101, code: "FORBIDDEN" },
    { user: owner, tenant: 202, code: "FORBIDDEN" },
    { user: owner, tenant: null, code: "FORBIDDEN" },
  ])(
    "refuses every operation before data access for $code scope $tenant",
    async ({ user, tenant, code }) => {
      for (const request of allRequests(caller(user, tenant)))
        await expect(request()).rejects.toMatchObject({ code });
      for (const mock of [
        state.readOps,
        state.readFinance,
        state.readCommercial,
        ...Object.values(state.schedules),
      ])
        expect(mock).not.toHaveBeenCalled();
    }
  );

  it("filters the catalog by role and refuses an otherwise valid cross-category request", async () => {
    expect((await caller().catalog()).map(report => report.id)).toEqual([
      5, 18,
    ]);
    const finance = caller({ ...owner, role: "finance" });
    expect((await finance.catalog()).map(report => report.id)).toEqual([55]);
    await expect(finance.run({ reportId: 5, filters })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller().export({ reportId: 55, filters, format: "csv" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.readOps).not.toHaveBeenCalled();
    expect(state.readFinance).not.toHaveBeenCalled();
  });

  it("derives tenant scope from authentication, projects selected columns and preserves zero/unknown", async () => {
    const result = await caller().run({
      reportId: 5,
      filters,
      columns: ["unknown", "quantity"],
    });
    expect(state.readOps).toHaveBeenCalledWith(5, filters, {
      userId: 11,
      tenantId: 101,
    });
    expect(result.rows).toEqual([{ unknown: null, quantity: 0 }]);
    expect(result.columns.map(column => column.key)).toEqual([
      "unknown",
      "quantity",
    ]);
    expect(JSON.stringify(result)).not.toContain("MUST-NOT-EXPORT");
    await expect(
      caller().run({ reportId: 5, filters, tenantId: 202 } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.readOps).toHaveBeenCalledTimes(1);
  });

  it.each(["csv", "html", "xml"] as const)(
    "executes and serializes %s output with a content checksum",
    async format => {
      const result = await caller().export({
        reportId: 5,
        filters,
        columns: ["quantity", "record"],
        format,
      });
      expect(result.recordCount).toBe(1);
      expect(result.checksum).toBe(
        createHash("sha256").update(result.content).digest("hex")
      );
      expect(result.content).not.toContain("MUST-NOT-EXPORT");
      if (format === "csv")
        expect(result.content).toContain("0,'=1+2 <script>");
      else {
        expect(result.content).toContain("&lt;script&gt;");
        expect(result.content).not.toContain("<script>");
      }
    }
  );

  it("retains explicit platform access and blocks unavailable sources before reading", async () => {
    const admin = caller({ ...owner, role: "admin" }, null);
    expect(await admin.catalog()).toHaveLength(4);
    await admin.run({ reportId: 55, filters });
    expect(state.readFinance).toHaveBeenCalledWith(55, filters, {
      userId: 11,
      tenantId: undefined,
    });
    await expect(
      admin.run({ reportId: 18, filters: {} })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(state.readOps).not.toHaveBeenCalled();
  });

  it.each([
    { reportId: 0, filters },
    { reportId: 5.5, filters },
    {
      reportId: 5,
      filters: { startDate: "2026-11-04", endDate: "2026-11-03" },
    },
    { reportId: 5, filters: { tenantId: 202 } },
    { reportId: 5, filters, columns: ["quantity", "quantity"] },
  ])("rejects invalid input before executing a report", async request => {
    await expect(caller().run(request as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(state.readOps).not.toHaveBeenCalled();
  });

  it("returns an explicit failure and no partial export when a source fails", async () => {
    state.readOps.mockRejectedValue(new Error("private database diagnostic"));
    await expect(
      caller().export({ reportId: 5, filters, format: "csv" })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "The report could not be generated. No partial output was published.",
    });
  });

  it("forwards the authenticated owner and scope through every saved-report operation", async () => {
    const client = caller();
    expect(await client.templates()).toEqual([saved]);
    expect(await client.saveTemplate({ template: input })).toEqual(saved);
    await client.saveTemplate({ id: 71, template: input });
    expect(await client.deleteTemplate({ id: 71 })).toEqual({ deleted: true });
    expect(
      (await client.setTemplateEnabled({ id: 71, enabled: false })).enabled
    ).toBe(false);
    expect(await client.runTemplate({ id: 71, requestId })).toEqual(run);
    expect(await client.runs({ beforeId: 90 })).toEqual([run]);
    expect(await client.downloadRun({ id: 81 })).toEqual(output);
    expect(state.schedules.listStandardReportTemplates).toHaveBeenCalledWith(
      owner,
      101
    );
    expect(state.schedules.saveStandardReportTemplate.mock.calls).toEqual([
      [owner, 101, input, undefined],
      [owner, 101, input, 71],
    ]);
    expect(state.schedules.deleteStandardReportTemplate).toHaveBeenCalledWith(
      owner,
      101,
      71
    );
    expect(
      state.schedules.setStandardReportTemplateEnabled
    ).toHaveBeenCalledWith(owner, 101, 71, false);
    expect(state.schedules.runStandardReportTemplate).toHaveBeenCalledWith(
      owner,
      101,
      71,
      requestId
    );
    expect(state.schedules.listStandardReportRuns).toHaveBeenCalledWith(
      owner,
      101,
      90
    );
    expect(state.schedules.downloadStandardReportRun).toHaveBeenCalledWith(
      owner,
      101,
      81
    );
  });

  it("rejects spoofed owner fields and malformed idempotency identities before mutations", async () => {
    await expect(
      caller().saveTemplate({ template: { ...input, createdBy: 22 } } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().setTemplateEnabled({
        id: 71,
        enabled: false,
        tenantId: 202,
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().runTemplate({ id: 71, requestId: "reusable-name" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const mock of Object.values(state.schedules))
      expect(mock).not.toHaveBeenCalled();
  });

  it("applies response contracts to saved templates, runs and downloads", async () => {
    state.schedules.saveStandardReportTemplate.mockResolvedValue({
      ...saved,
      createdBy: 11,
      tenantId: 101,
    });
    await expect(
      caller().saveTemplate({ template: input })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    state.schedules.runStandardReportTemplate.mockResolvedValue({
      ...run,
      status: "complete",
      content: "PRIVATE",
    });
    await expect(
      caller().runTemplate({ id: 71, requestId })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    state.schedules.downloadStandardReportRun.mockResolvedValue({
      ...output,
      recordCount: "one",
    });
    await expect(caller().downloadRun({ id: 81 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});
