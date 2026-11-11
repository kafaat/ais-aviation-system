import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntelligenceContext } from "./types";
const state = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  economics: vi.fn(),
  fraud: vi.fn(),
  operations: vi.fn(),
}));
vi.mock("../cache.service", () => ({
  cacheService: {
    get: async (key: string) => state.cache.get(key),
    set: async (key: string, value: unknown) => {
      state.cache.set(key, value);
    },
  },
}));
vi.mock("./economics.agent", () => ({
  economicsAgent: { analyze: state.economics },
}));
vi.mock("./fraud.agent", () => ({
  fraudAgent: { getOverview: state.fraud, assessBooking: state.fraud },
}));
vi.mock("./operations.agent", () => ({
  operationsAgent: {
    getOperationalHealth: state.operations,
    predictDelay: state.operations,
    forecastDisruptions: state.operations,
  },
}));
vi.mock("./gateway", () => ({ aiGateway: {} }));
import { IntelligenceKernel } from "./kernel";
const context = (ids = [11]): IntelligenceContext => ({
  requestId: "test",
  userId: 1,
  timestamp: new Date(),
  timeHorizon: "short_term",
  scope: { flightIds: ids },
});
const result = (data: object) => ({
  data,
  status: "completed",
  recommendations: [],
});
beforeEach(() => {
  state.cache.clear();
  vi.clearAllMocks();
  state.economics.mockImplementation(async (ctx: IntelligenceContext) =>
    result({ netMargin: ctx.scope.flightIds?.[0] })
  );
  state.fraud.mockResolvedValue(result({}));
  state.operations.mockResolvedValue(result({ otp: 90 }));
});
describe("briefing scope and agent execution controls", () => {
  it("does not reuse another flight or date or principal scope", async () => {
    const kernel = new IntelligenceKernel();
    expect(
      (await kernel.generateBriefing(context([11]))).economics.profitMargin
    ).toBe(11);
    expect(
      (await kernel.generateBriefing(context([22]))).economics.profitMargin
    ).toBe(22);
    await kernel.generateBriefing({ ...context([22]), userId: 2 });
    await kernel.generateBriefing({
      ...context([22]),
      scope: {
        flightIds: [22],
        dateRange: {
          start: new Date("2026-01-01Z"),
          end: new Date("2026-02-01Z"),
        },
      },
    });
    expect(state.economics).toHaveBeenCalledTimes(4);
  });
  it("reuses equivalent set filters", async () => {
    const kernel = new IntelligenceKernel();
    await kernel.generateBriefing(context([11, 22]));
    await kernel.generateBriefing(context([22, 11, 11]));
    expect(state.economics).toHaveBeenCalledTimes(1);
  });
  it("disabled agents neither execute nor return an old enabled briefing", async () => {
    const kernel = new IntelligenceKernel();
    await kernel.generateBriefing(context());
    const config = kernel.getConfig();
    Object.values(config.agents).forEach(agent => {
      agent.enabled = false;
    });
    kernel.updateConfig(config);
    const briefing = await kernel.generateBriefing(context());
    expect(briefing.agentResults).toEqual([]);
    expect(state.economics).toHaveBeenCalledTimes(1);
    expect(state.fraud).toHaveBeenCalledTimes(1);
    expect(state.operations).toHaveBeenCalledTimes(1);
    expect(briefing.pricing.summary).toMatch(/disabled/i);
    config.agents.economics.enabled = true;
    kernel.updateConfig(config);
    await kernel.generateBriefing(context());
    expect(state.economics).toHaveBeenCalledTimes(2);
  });
  it("disabled agents reject direct kernel entry points too", () => {
    const kernel = new IntelligenceKernel();
    const config = kernel.getConfig();
    Object.values(config.agents).forEach(agent => {
      agent.enabled = false;
    });
    kernel.updateConfig(config);
    expect(() => kernel.getEconomicsAnalysis(context())).toThrow(/disabled/);
    expect(() => kernel.assessBookingFraud(1, 1, context())).toThrow(
      /disabled/
    );
    expect(() => kernel.predictFlightDelay(1, context())).toThrow(/disabled/);
    expect(() => kernel.getDisruptionForecast(context())).toThrow(/disabled/);
    expect(state.economics).not.toHaveBeenCalled();
    expect(state.fraud).not.toHaveBeenCalled();
    expect(state.operations).not.toHaveBeenCalled();
  });
  it("obeys the configured concurrency limit", async () => {
    const kernel = new IntelligenceKernel({ maxConcurrentAgents: 1 });
    let active = 0;
    let maxActive = 0;
    const run = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      return result({});
    };
    state.economics.mockImplementation(run);
    state.fraud.mockImplementation(run);
    state.operations.mockImplementation(run);
    await kernel.generateBriefing(context());
    expect(maxActive).toBe(1);
  });
  it("labels the requested period", async () => {
    const kernel = new IntelligenceKernel();
    const ctx = context();
    ctx.scope.dateRange = {
      start: new Date("2026-01-01Z"),
      end: new Date("2026-02-01Z"),
    };
    expect((await kernel.generateBriefing(ctx)).period).toContain("2026-01-01");
  });
});
