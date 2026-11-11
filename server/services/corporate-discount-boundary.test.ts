import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
let fixture: ReturnType<typeof transactionMemory>;
vi.mock("../db", () => ({ getDb: () => fixture.db }));
import {
  createCorporateAccount,
  updateCorporateAccount,
} from "./corporate.service";
describe("corporate discount configuration", () => {
  beforeEach(() => {
    fixture = transactionMemory({
      corporate_accounts: [{ id: 1, discountPercent: "5" }],
    });
  });
  it.each([100, 101, 99.999, -1, NaN, Infinity])(
    "rejects unusable discount %s before update",
    async discountPercent => {
      await expect(
        updateCorporateAccount(1, { discountPercent })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fixture.rows("corporate_accounts")[0].discountPercent).toBe("5");
    }
  );
  it.each([100, NaN])(
    "rejects unusable discount %s before creation",
    async discountPercent => {
      await expect(
        createCorporateAccount({
          companyName: "Synthetic",
          taxId: "T",
          contactName: "Test",
          contactEmail: "test@example.test",
          discountPercent,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fixture.rows("corporate_accounts")).toHaveLength(1);
    }
  );
  it.each([0, 99.99])("keeps valid discount %s", async discountPercent => {
    await updateCorporateAccount(1, { discountPercent });
    expect(fixture.rows("corporate_accounts")[0].discountPercent).toBe(
      String(discountPercent)
    );
  });
});
