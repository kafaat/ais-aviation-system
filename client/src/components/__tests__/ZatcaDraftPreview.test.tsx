import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ZatcaDraftPreview } from "../ZatcaDraftPreview";

const api = vi.hoisted(() => ({
  availability: vi.fn(),
  mutation: vi.fn(),
  mutate: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    revenueAccounting: {
      zatcaDraftAvailability: { useQuery: api.availability },
      prepareZatcaDraft: { useMutation: api.mutation },
    },
  },
}));
vi.mock("../OperationalReadState", async importOriginal => ({
  ...(await importOriginal<typeof import("../OperationalReadState")>()),
  useOperationalLabels: () => (_ar: string, en: string) => en,
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: async () => "data:image/png;base64,AA==" },
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  api.availability.mockReturnValue({ data: "available" });
  api.mutation.mockReturnValue({
    mutate: api.mutate,
    reset: api.reset,
    isPending: false,
  });
});
function open() {
  render(<ZatcaDraftPreview />);
  fireEvent.click(
    screen.getByRole("button", { name: "Local ZATCA invoice preview" })
  );
}
it.each([
  ["tenant_required", /airline tenant is required/],
  ["disabled", /disabled in this environment/],
  ["acceptance_required", /acceptance evidence is required/],
])("does not expose submission for status %s", (data, message) => {
  api.availability.mockReturnValue({ data });
  open();
  expect(screen.getByText(message as RegExp)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Save and preview/ })).toBeNull();
});
it("submits stable UTC dates and no client-supplied tenant or amounts", () => {
  open();
  for (const [label, value] of [
    ["Booking ID", "7"],
    ["Invoice number", "INV-7"],
    ["Seller name", "Test Seller"],
    ["Seller VAT number", "310000000000003"],
    ["Issue time (UTC)", "2030-01-02T03:04"],
    ["Supply time (UTC)", "2030-01-01T05:06"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /Save and preview/ }));
  expect(api.mutate).toHaveBeenCalledWith({
    bookingId: 7,
    invoiceNumber: "INV-7",
    sellerName: "Test Seller",
    sellerVatNumber: "310000000000003",
    issueTimestamp: new Date("2030-01-02T03:04Z"),
    supplyTimestamp: new Date("2030-01-01T05:06Z"),
  });
});
it("shows stored totals and generates the draft QR locally", async () => {
  api.mutation.mockReturnValue({
    data: {
      invoiceNumber: "INV-7",
      totalAmount: 5750,
      taxAmount: 750,
      previewQrPayload: "payload",
    },
  });
  open();
  expect(screen.getByText("Total 57.50 SAR")).toBeInTheDocument();
  expect(screen.getByText("VAT 7.50 SAR")).toBeInTheDocument();
  expect(screen.getByLabelText("Draft QR payload")).toHaveValue("payload");
  expect(
    await screen.findByRole("img", { name: "Draft QR code" })
  ).toHaveAttribute("src", "data:image/png;base64,AA==");
});
