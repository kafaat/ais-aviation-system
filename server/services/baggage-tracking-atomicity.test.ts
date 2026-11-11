import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import {
  markBaggageFound,
  reportLostBaggage,
  updateBaggageStatus,
} from "./baggage.service";

let fixture: ReturnType<typeof transactionMemory>;
vi.mock("../db", () => ({ getDb: () => fixture.db }));

function seed(status = "checked_in", returned = false) {
  fixture = transactionMemory({
    baggage_items: [
      {
        id: 1,
        tagNumber: "0650000001",
        status,
        lastLocation: "Counter",
        returnEventId: returned ? 9 : null,
        returnEvidenceId: returned ? 10 : null,
      },
    ],
    baggage_tracking: [],
  });
}

describe("tracking state and custody history commit together", () => {
  beforeEach(() => seed());

  const commands = [
    {
      name: "scan",
      before: "checked_in",
      after: "security_screening",
      run: () =>
        updateBaggageStatus({
          tagNumber: "0650000001",
          location: "Screening",
          status: "security_screening",
        }),
    },
    {
      name: "lost report",
      before: "checked_in",
      after: "lost",
      run: () =>
        reportLostBaggage({ tagNumber: "0650000001", description: "Missing" }),
    },
    {
      name: "found report",
      before: "lost",
      after: "found",
      run: () =>
        markBaggageFound({ tagNumber: "0650000001", foundLocation: "Store" }),
    },
  ];

  for (const command of commands) {
    it(`rolls back ${command.name} when the tracking insert fails and permits retry`, async () => {
      seed(command.before);
      const before = structuredClone(fixture.rows("baggage_items")[0]);
      fixture.failInsert("baggage_tracking");
      await expect(command.run()).rejects.toThrow("Injected insert failure");
      expect(fixture.rows("baggage_items")[0]).toEqual(before);
      expect(fixture.rows("baggage_tracking")).toEqual([]);
      fixture.failInsert("");
      await command.run();
      expect(fixture.rows("baggage_items")[0].status).toBe(command.after);
      expect(fixture.rows("baggage_tracking")).toHaveLength(1);
      expect(fixture.rows("baggage_tracking")[0].status).toBe(command.after);
    });

    it(`preserves signed handback during ${command.name}`, async () => {
      seed(command.before, true);
      await expect(command.run()).rejects.toMatchObject({ code: "CONFLICT" });
      expect(fixture.rows("baggage_items")[0]).toMatchObject({
        status: command.before,
        returnEventId: 9,
        returnEvidenceId: 10,
      });
      expect(fixture.rows("baggage_tracking")).toEqual([]);
    });
  }
});
