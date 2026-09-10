import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as biometric from "../services/biometric.service";
import * as multiRegion from "../services/multi-region.service";
import * as weightBalance from "../services/weight-balance.service";
import * as loadPlanning from "../services/load-planning.service";
import * as dcs from "../services/dcs.service";

const boundary = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: boundary.getDb }));

// Exercise every exported operation of demo-only services, including readers
// and direct in-process calls that do not pass through tRPC middleware.
const operations = Object.entries({
  biometric,
  multiRegion,
  weightBalance,
  loadPlanning,
  dcs: {
    calculateWeightAndBalance: dcs.calculateWeightAndBalance,
    createLoadPlan: dcs.createLoadPlan,
    getLoadPlan: dcs.getLoadPlan,
    approveLoadPlan: dcs.approveLoadPlan,
    finalizeLoadPlan: dcs.finalizeLoadPlan,
  },
}).flatMap(([service, exports]) =>
  Object.entries(exports)
    .filter(([, operation]) => typeof operation === "function")
    .map(([name, operation]) => ({ name: `${service}.${name}`, operation }))
);

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe.each([
  { environment: "production", demos: undefined },
  { environment: "production", demos: "false" },
  { environment: "production", demos: "true" },
  { environment: "development", demos: undefined },
  { environment: "test", demos: "false" },
])(
  "simulation boundary: $environment, demos=$demos",
  ({ environment, demos }) => {
    it.each(operations)(
      "rejects $name before reading or changing state",
      async ({ operation }) => {
        vi.stubEnv("NODE_ENV", environment);
        vi.stubEnv("AIS_ENABLE_DEMOS", demos);
        // Missing inputs deliberately prove the guard runs before any work or
        // argument dereference; both sync and async operations must fail closed.
        await expect(
          Promise.resolve().then(() => Reflect.apply(operation, undefined, []))
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(boundary.getDb).not.toHaveBeenCalled();
      }
    );
  }
);

it("permits explicitly enabled development fixtures", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AIS_ENABLE_DEMOS", "true");
  expect(multiRegion.getRegions().length).toBeGreaterThan(0);
  expect(weightBalance.calculateFuelWeight(1, 10000).totalFuelWeight).toBe(
    10000
  );
});

it("retains ordinary DCS aircraft reads in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  boundary.getDb.mockResolvedValue({
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  });
  await expect(dcs.getAircraftTypes()).resolves.toEqual([]);
  expect(boundary.getDb).toHaveBeenCalledOnce();
});
