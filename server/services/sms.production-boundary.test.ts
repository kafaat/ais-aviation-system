import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const boundary = vi.hoisted(() => ({
  writes: [] as { table: string; row: Record<string, unknown> }[],
}));
vi.mock("../db", () => ({
  getDb: () => ({
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (row: Record<string, unknown>) => {
        boundary.writes.push({ table: getTableName(table), row });
        return Promise.resolve([{ insertId: 1 }]);
      },
    }),
  }),
}));
vi.mock("./production.service", () => ({
  withCircuitBreaker: (_name: string, run: () => Promise<unknown>) => run(),
}));
import { sendSMS } from "./sms.service";

const send = () => sendSMS(101, "0500000000", "Synthetic fixture only");
const request = vi.fn();
beforeEach(() => {
  boundary.writes = [];
  request.mockReset();
  vi.stubGlobal("fetch", request);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SMS_PROVIDER", "");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function expectFailedLogs() {
  expect(boundary.writes.map(write => write.table)).toEqual([
    "sms_logs",
    "notification_history",
  ]);
  for (const { row } of boundary.writes) {
    expect(row.status).toBe("failed");
    expect(row.sentAt).toBeUndefined();
    expect(row.providerMessageId).toBeUndefined();
    expect(row.errorMessage).toEqual(expect.any(String));
  }
}

function configureTwilio() {
  vi.stubEnv("SMS_PROVIDER", "twilio");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_SYNTHETIC");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "synthetic-token");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");
}

describe("SMS production boundary", () => {
  it.each([undefined, "", "mock", "unknown"])(
    "fails closed for provider %s, even with demos enabled",
    async provider => {
      vi.stubEnv("SMS_PROVIDER", provider);
      vi.stubEnv("AIS_ENABLE_DEMOS", "true");
      const result = await send();
      expect(result.success).toBe(false);
      expect(result.messageId).toBeUndefined();
      expect(request).not.toHaveBeenCalled();
      expectFailedLogs();
    }
  );

  it.each(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"])(
    "does not fall back to mock when %s is missing",
    async name => {
      configureTwilio();
      vi.stubEnv(name, "");
      await expect(send()).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining("credentials"),
      });
      expect(request).not.toHaveBeenCalled();
      expectFailedLogs();
    }
  );

  it("keeps an explicitly configured provider failure visible in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SMS_PROVIDER", "twilio");
    await expect(send()).resolves.toMatchObject({ success: false });
    expectFailedLogs();
  });

  it("sends through a configured provider and records its confirmation ID", async () => {
    configureTwilio();
    request.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sid: "SM_SYNTHETIC", status: "queued" }),
    });
    await expect(send()).resolves.toEqual({
      success: true,
      messageId: "SM_SYNTHETIC",
    });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC_SYNTHETIC/Messages.json"
    );
    expect(options.method).toBe("POST");
    expect(options.body.get("To")).toBe("+966500000000");
    expect(options.body.get("Body")).toBe("Synthetic fixture only");
    for (const { row } of boundary.writes) {
      expect(row.status).toBe("sent");
      expect(row.providerMessageId).toBe("SM_SYNTHETIC");
    }
  });

  it("rejects an apparent provider success without a message ID", async () => {
    configureTwilio();
    request.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    await expect(send()).resolves.toMatchObject({ success: false });
    expectFailedLogs();
  });

  it("records provider rejection as failure", async () => {
    configureTwilio();
    request.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: "Synthetic rejection" }),
    });
    await expect(send()).resolves.toEqual({
      success: false,
      error: "Synthetic rejection",
    });
    expectFailedLogs();
  });

  it("records transport failure without switching to mock", async () => {
    configureTwilio();
    request.mockRejectedValue(new Error("Synthetic network failure"));
    await expect(send()).resolves.toMatchObject({ success: false });
    expectFailedLogs();
  });

  it("retains mock delivery outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SMS_PROVIDER", "mock");
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    await expect(send()).resolves.toMatchObject({
      success: true,
      messageId: expect.stringMatching(/^mock_/),
    });
    expect(request).not.toHaveBeenCalled();
    expect(boundary.writes[0].row.provider).toBe("mock");
  });
});
