import { beforeEach, expect, it, vi } from "vitest";
import { prepareRedemption } from "./redemption-intent";

beforeEach(() => sessionStorage.clear());
it("recovers a lost response after reload even if the debit already reduced the balance", () => {
  const first = prepareRedemption(sessionStorage, 7, 100, 100)!;
  const retry = prepareRedemption(sessionStorage, 7, 100, 0)!;
  expect(retry.key).toBe(first.key);
  retry.acknowledge();
  expect(prepareRedemption(sessionStorage, 7, 100, 0)).toBeNull();
  const next = prepareRedemption(sessionStorage, 7, 100, 200)!;
  expect(next.key).not.toBe(first.key);
  first.acknowledge();
  expect(prepareRedemption(sessionStorage, 7, 100, 0)?.key).toBe(next.key);
});
it("isolates different accounts and amounts and never invents a key for a damaged pending entry", () => {
  const first = prepareRedemption(sessionStorage, 7, 100, 500)!;
  expect(prepareRedemption(sessionStorage, 8, 100, 500)?.key).not.toBe(
    first.key
  );
  expect(prepareRedemption(sessionStorage, 7, 200, 500)?.key).not.toBe(
    first.key
  );
  sessionStorage.setItem("ais:loyalty:redeem:7:100", "corrupted");
  expect(() => prepareRedemption(sessionStorage, 7, 100, 500)).toThrow();
  expect(sessionStorage.getItem("ais:loyalty:redeem:7:100")).toBe("corrupted");
});
it("refuses to start an unrecorded command when storage is unavailable", () => {
  const storage = {
    getItem: () => null,
    setItem: vi.fn(() => {
      throw new Error("Storage blocked");
    }),
  } as unknown as Storage;
  expect(() => prepareRedemption(storage, 7, 100, 500)).toThrow(
    "Storage blocked"
  );
});
