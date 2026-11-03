import { expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SupplierFinanceControl } from "../SupplierFinanceControl";
const mocks = vi.hoisted(() => ({ review: vi.fn(), record: vi.fn() }));
vi.mock("../OperationalReadState", () => ({
  useOperationalLabels: () => (_ar: string, en: string) => en,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ supplierFinance: { review: { fetch: mocks.review } } }),
    supplierFinance: {
      record: {
        useMutation: () => ({ isPending: false, mutateAsync: mocks.record }),
      },
    },
  },
}));
it("approves the reviewed version and amount, replaying the same instruction after a lost response", async () => {
  const supplier = "ce935099-bba9-43a1-b392-3209815b1157",
    invoice = "2339444e-c48e-437c-b445-5a7855d209d2";
  mocks.review.mockResolvedValue({
    bankVersion: 3,
    lastFour: "0111",
    bankFingerprint: "abcd",
    bankApproved: true,
    invoice: { status: "requested", amountMinor: 13865, bankVersion: 3 },
    history: [],
  });
  mocks.record
    .mockRejectedValueOnce(new Error("Connection interrupted"))
    .mockResolvedValueOnce({ receiptId: 18 });
  render(<SupplierFinanceControl />);
  fireEvent.change(screen.getByLabelText("Supplier UUID"), {
    target: { value: supplier },
  });
  fireEvent.change(screen.getByLabelText("Invoice UUID for payout"), {
    target: { value: invoice },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review bank version" }));
  fireEvent.change(await screen.findByLabelText("Decision"), {
    target: { value: "payout_approved" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
  const retry = await screen.findByRole("button", {
    name: "Retry same request",
  });
  expect(screen.getByLabelText("Decision")).toBeDisabled();
  fireEvent.click(retry);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Internal receipt 18")
  );
  const [first, second] = mocks.record.mock.calls;
  expect(first[0]).toMatchObject({
    supplierRef: supplier,
    invoiceRef: invoice,
    action: "payout_approved",
    bankVersion: 3,
    amountMinor: 13865,
  });
  expect(second[0]).toEqual(first[0]);
});
