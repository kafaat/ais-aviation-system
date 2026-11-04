import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  reportTemplateInputSchema,
  responseContracts,
} from "../contracts/standard-reports";
import type { standardReportTemplates } from "../../drizzle/schema";

const state = vi.hoisted(() => ({
  db: null as unknown,
  read: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("./standard-reports-ops.service", () => ({
  operationsReportDefinitions: [
    {
      id: 5,
      title: "Flight Load",
      category: "operations",
      availability: "available",
      description: "Recorded load",
      limitations: [],
      filters: ["startDate", "endDate"],
    },
  ],
  getOperationsStandardReport: state.read,
}));
vi.mock("./standard-reports-finance.service", () => ({
  financeReportDefinitions: [],
  getFinanceStandardReport: vi.fn(),
}));
vi.mock("./standard-reports-commercial.service", () => ({
  commercialReportDefinitions: [],
  getCommercialStandardReport: vi.fn(),
}));
import {
  listStandardReportTemplates,
  saveStandardReportTemplate,
  setStandardReportTemplateEnabled,
} from "./standard-report-schedules.service";

type Template = typeof standardReportTemplates.$inferSelect;
type Rows = Record<string, unknown>[];
interface ReadQuery extends PromiseLike<Rows> {
  from: () => ReadQuery;
  where: () => ReadQuery;
  orderBy: () => ReadQuery;
  limit: () => Promise<Rows>;
}
let reads: Rows[];
const owner = {
  id: 11,
  tenantId: 101,
  role: "ops",
  email: "owner@example.test",
};
const input = () =>
  reportTemplateInputSchema.parse({
    reportId: 5,
    name: "Daily load",
    filters: { startDate: "2026-11-04", endDate: "2026-11-04" },
    columns: ["quantity", "record"],
    format: "csv",
  });
const publicTemplate = () => ({
  ...input(),
  id: 71,
  nextRunAt: null,
  createdAt: new Date("2026-11-04T08:00:00Z"),
  updatedAt: new Date("2026-11-04T08:00:00Z"),
});
const persistedTemplate = (changes: Partial<Template> = {}): Template => ({
  ...publicTemplate(),
  columns: input().columns ?? null,
  createdBy: owner.id,
  tenantId: owner.tenantId,
  ...changes,
});

beforeEach(() => {
  vi.clearAllMocks();
  reads = [];
  state.read.mockResolvedValue({
    columns: [
      { key: "record", label: "Record", type: "text" },
      { key: "quantity", label: "Quantity", type: "number" },
    ],
    rows: [{ record: "tenant-101", quantity: 0 }],
    notes: [],
  });
  state.insert.mockResolvedValue([{ insertId: 71 }]);
  state.update.mockImplementation(() => ({
    where: async () => ({ affectedRows: 1 }),
  }));
  state.db = {
    select: () => {
      const rows = reads.shift();
      if (!rows) throw new Error("Unexpected database read");
      const promise = Promise.resolve(rows);
      const query: ReadQuery = {
        from: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => promise,
        then: promise.then.bind(promise),
      };
      return query;
    },
    insert: () => ({ values: state.insert }),
    update: () => ({ set: state.update }),
  };
});

/** Real service + strict transport contracts; only database I/O and report source are substituted. */
describe("saved report template response boundaries", () => {
  it("creates a template whose full stored row is accepted as a public response without ownership fields", async () => {
    reads = [[{ total: 0 }], [persistedTemplate()]];
    const saved = await saveStandardReportTemplate(owner, 101, input());
    expect(responseContracts.saveTemplate.parse(saved)).toEqual(
      publicTemplate()
    );
    expect(saved).not.toHaveProperty("createdBy");
    expect(saved).not.toHaveProperty("tenantId");
    expect(state.insert).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: 11, tenantId: 101 })
    );
    expect(
      reportTemplateInputSchema.safeParse({
        ...input(),
        createdBy: 22,
        tenantId: 202,
      }).success
    ).toBe(false);
    expect(
      responseContracts.saveTemplate.safeParse(persistedTemplate()).success
    ).toBe(false);
  });

  it("lists only the current scope and projects each row through the strict public contract", async () => {
    reads = [
      [persistedTemplate(), persistedTemplate({ id: 72, tenantId: 202 })],
    ];
    const listed = await listStandardReportTemplates(owner, 101);
    expect(responseContracts.templates.parse(listed)).toEqual([
      publicTemplate(),
    ]);
    expect(listed[0]).not.toHaveProperty("createdBy");
    expect(listed[0]).not.toHaveProperty("tenantId");
  });

  it("updates a template without returning the stored ownership metadata", async () => {
    reads = [
      [persistedTemplate()],
      [persistedTemplate({ format: "xml", name: "Updated load" })],
    ];
    const saved = await saveStandardReportTemplate(
      owner,
      101,
      { ...input(), format: "xml", name: "Updated load" },
      71
    );
    expect(responseContracts.saveTemplate.parse(saved)).toEqual({
      ...publicTemplate(),
      format: "xml",
      name: "Updated load",
    });
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 101, format: "xml" })
    );
  });

  it.each([false, true])(
    "returns an accepted template when automatic runs become %s",
    async enabled => {
      const nextRunAt = enabled ? new Date("2026-11-05T08:00:00Z") : null;
      reads = [
        [persistedTemplate({ cadence: "daily", enabled: !enabled })],
        [persistedTemplate({ cadence: "daily", enabled, nextRunAt })],
      ];
      const saved = await setStandardReportTemplateEnabled(
        owner,
        101,
        71,
        enabled
      );
      expect(responseContracts.setTemplateEnabled.parse(saved)).toEqual({
        ...publicTemplate(),
        cadence: "daily",
        enabled,
        nextRunAt,
      });
      expect(saved).not.toHaveProperty("createdBy");
      expect(saved).not.toHaveProperty("tenantId");
      expect(state.read).toHaveBeenCalledTimes(enabled ? 1 : 0);
    }
  );
});
