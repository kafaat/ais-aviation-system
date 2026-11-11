import { beforeEach, describe, it, expect, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { checkPriceAlertsAndNotify } from "./favorites.service";
let memory: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  memory = transactionMemory({
    favorite_flights: [
      {
        id: 1,
        userId: 1,
        originId: 1,
        destinationId: 2,
        cabinClass: "economy",
        maxPrice: 40000,
        enablePriceAlert: true,
        lastAlertSent: null,
      },
    ],
    flights: [
      {
        id: 10,
        originId: 1,
        destinationId: 2,
        economyPrice: 30000,
        businessPrice: 60000,
        status: "scheduled",
        departureTime: new Date(Date.now() + 86400000),
      },
    ],
    price_alert_history: [],
    favorite_price_observations: [],
  });
  state.db = memory.db;
});
describe("favorite price observation baseline", () => {
  it("seeds without notifying, then reports exactly one drop", async () => {
    expect((await checkPriceAlertsAndNotify()).alertsFound).toBe(0);
    expect(memory.rows("price_alert_history")).toHaveLength(0);
    memory.rows("flights")[0].economyPrice = 20000;
    expect(await checkPriceAlertsAndNotify()).toMatchObject({
      alertsFound: 1,
      alerts: [{ previousPrice: 30000, newPrice: 20000 }],
    });
    expect((await checkPriceAlertsAndNotify()).alertsFound).toBe(0);
    expect(memory.rows("price_alert_history")).toHaveLength(1);
    expect(memory.rows("favorite_flights")[0].lastAlertSent).toBeNull();
  });
  it("observes prices above threshold before a qualifying drop", async () => {
    memory.rows("flights")[0].economyPrice = 50000;
    await checkPriceAlertsAndNotify();
    memory.rows("flights")[0].economyPrice = 35000;
    expect((await checkPriceAlertsAndNotify()).alerts[0]).toMatchObject({
      previousPrice: 50000,
      newPrice: 35000,
    });
  });
  it("rolls back the observation when creating the alert fails", async () => {
    await checkPriceAlertsAndNotify();
    memory.rows("flights")[0].economyPrice = 20000;
    memory.failInsert("price_alert_history");
    await expect(checkPriceAlertsAndNotify()).rejects.toThrow();
    expect(memory.rows("favorite_price_observations")[0].price).toBe(30000);
    expect(memory.rows("price_alert_history")).toHaveLength(0);
  });
  it("does not compare a newly observed flight or cabin to another one", async () => {
    await checkPriceAlertsAndNotify();
    memory.rows("flights")[0].id = 11;
    memory.rows("flights")[0].economyPrice = 10000;
    expect((await checkPriceAlertsAndNotify()).alertsFound).toBe(0);
    memory.rows("favorite_flights")[0].cabinClass = "business";
    memory.rows("flights")[0].businessPrice = 5000;
    expect((await checkPriceAlertsAndNotify()).alertsFound).toBe(0);
  });
});
