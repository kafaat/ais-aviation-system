import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: state.getDb }));
import { issueEmd, refundEmd } from "../services/emd.service";
import {
  generateBSPReport,
  generateAHCReport,
} from "../services/bsp-reporting.service";
it("F10 cannot issue or refund an EMD without an accepted provider and never reaches storage", async () => {
  await expect(
    issueEmd({
      emdType: "EMD-S",
      issuingAirlineId: 1,
      reasonForIssuance: "other",
      serviceDescription: "Fixture",
      amount: 1000,
    })
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(refundEmd("00000000000000", 500)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  expect(state.getDb).not.toHaveBeenCalled();
});
it("F11 cannot manufacture ticket, tax or BSP settlement receipts from booking totals", async () => {
  for (const generate of [generateBSPReport, generateAHCReport])
    await expect(
      generate(new Date("2026-09-01"), new Date("2026-09-30"))
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(state.getDb).not.toHaveBeenCalled();
});
