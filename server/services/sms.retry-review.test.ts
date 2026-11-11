import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("./production.service", () => ({
  withCircuitBreaker: (_name: string, run: () => Promise<unknown>) => run(),
}));
import { resendSMS } from "./sms.service";
let memory: ReturnType<typeof transactionMemory>;
const request = vi.fn();
beforeEach(() => {
  memory = transactionMemory({
    sms_logs: [
      {
        id: 1,
        userId: null,
        phoneNumber: "+966500000000",
        message: "Synthetic retry",
        type: "system",
        status: "failed",
        retryCount: 0,
        provider: "twilio",
      },
    ],
  });
  state.db = memory.db;
  request.mockReset();
  vi.stubGlobal("fetch", request);
  vi.stubEnv("SMS_PROVIDER", "twilio");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_SYNTHETIC");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "synthetic");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");
  request.mockResolvedValue({
    ok: true,
    json: async () => ({ sid: "SM_SYNTHETIC" }),
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("logical SMS retry lifecycle", () => {
  it("records success on the original message and refuses another resend", async () => {
    await expect(resendSMS(1)).resolves.toMatchObject({ success: true });
    expect(memory.rows("sms_logs")).toHaveLength(1);
    expect(memory.rows("sms_logs")[0]).toMatchObject({
      status: "sent",
      providerMessageId: "SM_SYNTHETIC",
      retryCount: 1,
    });
    await expect(resendSMS(1)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("claims a concurrent retry only once", async () => {
    const results = await Promise.allSettled([resendSMS(1), resendSMS(1)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("keeps an ambiguous transport outcome pending and blocks replay", async () => {
    request.mockRejectedValue(new Error("timeout after acceptance possible"));
    expect((await resendSMS(1)).success).toBe(false);
    expect(memory.rows("sms_logs")[0].status).toBe("pending");
    await expect(resendSMS(1)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("allows retry after an explicit provider rejection", async () => {
    request.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: "Rejected" }),
    });
    expect((await resendSMS(1)).success).toBe(false);
    expect(memory.rows("sms_logs")[0].status).toBe("failed");
    expect((await resendSMS(1)).success).toBe(true);
  });
});
