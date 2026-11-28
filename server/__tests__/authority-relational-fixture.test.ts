import { expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { chatConversations } from "../../drizzle/schema";
import { authorityRelationalFixture } from "./helpers/authority-relational-fixture";

it("executes the millisecond DB clock independently of worker time with the native result shape", async () => {
  const fixture = authorityRelationalFixture([]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
  try {
    const [[clock]] = (await fixture.db.execute(
      sql`SELECT CURRENT_TIMESTAMP(3) AS now`
    )) as unknown as [[{ now: string }], unknown];
    expect(clock.now).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(clock.now.startsWith("2000-")).toBe(false);
  } finally {
    vi.useRealTimers();
    fixture.close();
  }
});

it("preserves each tuple's defaults and distinct bound values in a multirow insert", async () => {
  const fixture = authorityRelationalFixture([chatConversations]);
  try {
    await fixture.db.insert(chatConversations).values([
      {
        userId: 11,
        sessionId: "default, (?) العربية",
        context: { preferences: { note: "first, (default)" } },
      },
      {
        userId: 22,
        status: "completed",
        messageCount: 8,
        context: { passengers: 3 },
      },
      { userId: 33, sessionId: "third", messageCount: 0 },
    ]);
    const rows = fixture.rows(chatConversations);
    expect(rows).toMatchObject([
      {
        id: 1,
        userId: 11,
        status: "active",
        messageCount: 0,
        sessionId: "default, (?) العربية",
        bookingId: null,
      },
      {
        id: 2,
        userId: 22,
        status: "completed",
        messageCount: 8,
        sessionId: null,
        bookingId: null,
      },
      {
        id: 3,
        userId: 33,
        status: "active",
        messageCount: 0,
        sessionId: "third",
        bookingId: null,
      },
    ]);
    expect(rows).toHaveLength(3);
    expect(JSON.parse(rows[0].context as string)).toEqual({
      preferences: { note: "first, (default)" },
    });
    expect(JSON.parse(rows[1].context as string)).toEqual({ passengers: 3 });
    expect(rows[2].context).toBeNull();
    for (const row of rows) {
      expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} /);
      expect(row.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} /);
    }
  } finally {
    fixture.close();
  }
});
