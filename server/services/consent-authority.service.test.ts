import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consentHistory,
  consentRecords,
  userConsents,
  users,
} from "../../drizzle/schema";
import { authorityRelationalFixture } from "../__tests__/helpers/authority-relational-fixture";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { writePrivacyConsent } from "./consent-authority.service";

let fixture: ReturnType<typeof authorityRelationalFixture>;
beforeEach(() => {
  fixture = authorityRelationalFixture([
    users,
    userConsents,
    consentHistory,
    consentRecords,
  ]);
  fixture.sqlite.exec(
    "CREATE UNIQUE INDEX consent_owner ON user_consents(userId)"
  );
  state.db = fixture.db;
  for (const id of [7, 8, 9]) fixture.insert(users, { id });
  fixture.insert(userConsents, { id: 1, userId: 7, marketingEmails: 1 });
  fixture.insert(userConsents, {
    id: 2,
    userId: 8,
    analyticsTracking: 1,
    personalizedAds: 1,
  });
  fixture.insert(consentRecords, { id: 4, userId: 7, consentVersion: "1.0" });
  // A larger global revision belongs to another user and must not participate.
  fixture.insert(consentRecords, {
    id: 80,
    userId: 8,
    consentVersion: "1.0",
    analytics: 1,
    marketing: 1,
  });
});
afterEach(() => {
  state.db = null;
  fixture.close();
});

describe("privacy consent transactional authority", () => {
  it("commits the current preferences, changed-field history and cookie revision together for one owner", async () => {
    const foreignPrivacy = fixture.rows(userConsents)[1];
    const foreignCookie = fixture.rows(consentRecords)[1];
    const result = await writePrivacyConsent(
      7,
      {
        marketingEmails: false,
        analyticsTracking: true,
        personalizedAds: true,
        personalizedContent: true,
      },
      { ipAddress: "192.0.2.1", userAgent: "synthetic-consent-client" },
      4,
      true
    );
    expect(result.privacy).toMatchObject({
      userId: 7,
      marketingEmails: false,
      analyticsTracking: true,
      personalizedAds: true,
      personalizedContent: true,
      essentialCookies: true,
    });
    expect(result.cookie).toMatchObject({
      userId: 7,
      essential: true,
      analytics: true,
      marketing: true,
      preferences: true,
      ipAddress: "192.0.2.1",
      userAgent: "synthetic-consent-client",
    });
    expect(
      fixture
        .rows(consentHistory)
        .map(row => [row.consentType, row.previousValue, row.newValue])
    ).toEqual([
      ["marketingEmails", 1, 0],
      ["analyticsTracking", 0, 1],
      ["personalizedAds", 0, 1],
      ["personalizedContent", 0, 1],
    ]);
    expect(fixture.rows(userConsents)[1]).toEqual(foreignPrivacy);
    expect(fixture.rows(consentRecords)[1]).toEqual(foreignCookie);
    const locks = fixture.queries.filter(query =>
      /for update$/i.test(query.sql)
    );
    expect(locks.map(query => query.sql.match(/from `([^`]+)`/)?.[1])).toEqual([
      "users",
      "user_consents",
    ]);
    expect(locks.every(query => query.inTransaction)).toBe(true);
  });

  it("rejects an old or another user's revision before any preference or audit write", async () => {
    const latest = await writePrivacyConsent(
      7,
      { analyticsTracking: true },
      {},
      4,
      true
    );
    const before = [
      fixture.rows(userConsents),
      fixture.rows(consentHistory),
      fixture.rows(consentRecords),
    ];
    for (const revision of [4, 80, null, undefined]) {
      await expect(
        writePrivacyConsent(7, { analyticsTracking: false }, {}, revision, true)
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect([
        fixture.rows(userConsents),
        fixture.rows(consentHistory),
        fixture.rows(consentRecords),
      ]).toEqual(before);
    }
    expect(
      (
        await writePrivacyConsent(
          7,
          { analyticsTracking: false },
          {},
          latest.cookie.id,
          true
        )
      ).cookie.analytics
    ).toBe(false);
  });

  it("uses database defaults for a first consent and records only changed fields", async () => {
    const first = await writePrivacyConsent(
      9,
      { analyticsTracking: true },
      {},
      null,
      true
    );
    expect(first.privacy).toMatchObject({
      userId: 9,
      analyticsTracking: true,
      marketingEmails: false,
      personalizedAds: false,
      essentialCookies: true,
    });
    expect(first.cookie).toMatchObject({
      userId: 9,
      analytics: true,
      essential: true,
      marketing: false,
      preferences: false,
    });
    expect(fixture.rows(consentHistory)).toHaveLength(1);
    await writePrivacyConsent(
      9,
      { analyticsTracking: true },
      {},
      first.cookie.id,
      true
    );
    expect(
      fixture.rows(userConsents).filter(row => row.userId === 9)
    ).toHaveLength(1);
    expect(fixture.rows(consentHistory)).toHaveLength(1);
    expect(
      fixture.rows(consentRecords).filter(row => row.userId === 9)
    ).toHaveLength(2);
  });

  it.each([7, 9])(
    "rolls back every preference and history change if the final revision insert fails for user %s",
    async userId => {
      const before = [
        fixture.rows(userConsents),
        fixture.rows(consentHistory),
        fixture.rows(consentRecords),
      ];
      fixture.sqlite.exec(
        "CREATE TRIGGER failed_cookie_revision BEFORE INSERT ON consent_records BEGIN SELECT RAISE(ABORT, 'synthetic audit write failure'); END"
      );
      await expect(
        writePrivacyConsent(userId, {
          analyticsTracking: true,
          personalizedAds: true,
        })
      ).rejects.toMatchObject({
        // Require the final revision failure: an earlier driver error must not
        // satisfy this rollback regression without reaching the injected fault.
        cause: { message: "synthetic audit write failure" },
      });
      expect([
        fixture.rows(userConsents),
        fixture.rows(consentHistory),
        fixture.rows(consentRecords),
      ]).toEqual(before);
    }
  );

  it("ignores attempts to replace ownership, essential consent or trusted metadata through the update object", async () => {
    const result = await writePrivacyConsent(7, {
      id: 999,
      userId: 8,
      essentialCookies: false,
      consentVersion: "invented-version",
      ipAddressAtConsent: "198.51.100.2",
      userAgentAtConsent: "untrusted-update",
      analyticsTracking: true,
    });
    expect(result.privacy).toMatchObject({
      id: 1,
      userId: 7,
      essentialCookies: true,
      consentVersion: "1.0",
      ipAddressAtConsent: null,
      userAgentAtConsent: null,
      analyticsTracking: true,
    });
    expect(result.cookie).toMatchObject({
      userId: 7,
      essential: true,
      consentVersion: "1.0",
    });
    expect(fixture.rows(consentHistory).map(row => row.consentType)).toEqual([
      "analyticsTracking",
    ]);
    expect(fixture.rows(userConsents)[1]).toMatchObject({
      userId: 8,
      analyticsTracking: 1,
      personalizedAds: 1,
    });
  });

  it("rejects an absent user and unavailable storage without partial records", async () => {
    await expect(
      writePrivacyConsent(404, { analyticsTracking: true })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.rows(consentHistory)).toEqual([]);
    expect(fixture.rows(userConsents)).toHaveLength(2);
    state.db = null;
    await expect(writePrivacyConsent(7, {})).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
