import { expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { transactionMemory } from "./helpers/transaction-memory";

it("supports only the explicit clock scalar without treating absent tables as empty input", async () => {
  // This boundary double shares the test clock. Native and SQLite tests prove
  // production DB time independently of a skewed application Date.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-01-02T03:04:05Z"));
  try {
    const fixture = transactionMemory({});
    expect(
      await fixture.db.execute(sql`SELECT CURRENT_TIMESTAMP(3) AS now`)
    ).toEqual([[{ now: new Date("2030-01-02T03:04:05Z") }], []]);
    await expect(fixture.db.execute(sql`SELECT VERSION()`)).rejects.toThrow(
      "Unsupported scalar"
    );
  } finally {
    vi.useRealTimers();
  }
});
