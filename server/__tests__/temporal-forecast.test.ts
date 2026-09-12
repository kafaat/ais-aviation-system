import { describe, expect, it } from "vitest";
import {
  errorMetrics,
  predictFromPast,
  temporalForecast,
} from "../services/pricing/temporal-forecast";
const rows = Array.from({ length: 84 }, (_, i) => ({
  date: new Date(Date.UTC(2025, 0, i + 1)),
  demand: 20 + (i % 7) * 10,
}));
describe("temporal demand validation", () => {
  it("never reads target/future observations when predicting a past point", () => {
    const target = rows[50].date;
    const value = predictFromPast(rows, target, "weekday_mean");
    expect(
      predictFromPast(
        [...rows.slice(0, 50), { date: target, demand: 999999 }],
        target,
        "weekday_mean"
      )
    ).toBe(value);
  });
  it("compares a baseline on an untouched chronological validation window", () => {
    const result = temporalForecast(rows, new Date("2025-04-01"));
    expect(result.evaluation.sampleCount).toBe(14);
    expect(result.evaluation.mae).toBeLessThan(
      result.evaluation.baselineMae ?? 0
    );
    expect(result.trainingCutoff).toEqual(rows[83].date);
    expect(result.lower).toBeLessThanOrEqual(result.predicted);
    expect(result.upper).toBeGreaterThanOrEqual(result.predicted);
  });
  it("returns unknown accuracy for missing observations or undefined zero denominators", () => {
    expect(errorMetrics([])).toMatchObject({
      mae: null,
      rmse: null,
      sampleCount: 0,
    });
    expect(errorMetrics([{ actual: 0, predicted: 10 }])).toMatchObject({
      mae: 10,
      mape: null,
      wape: null,
      r2: null,
    });
    expect(
      errorMetrics([
        { actual: 0, predicted: 10 },
        { actual: 10, predicted: 5 },
      ]).mape
    ).toBe(50);
  });
  it("rejects sparse and corrupt histories instead of inventing confidence", () => {
    expect(() =>
      temporalForecast(rows.slice(0, 20), new Date("2025-04-01"))
    ).toThrow(/42/);
    expect(() =>
      temporalForecast(
        [...rows, { date: new Date("2025-03-30"), demand: NaN }],
        new Date("2025-04-01")
      )
    ).toThrow();
  });
});
