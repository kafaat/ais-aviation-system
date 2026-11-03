import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { WalletBookingPayment } from "../WalletBookingPayment";

const { getBalance, mutate } = vi.hoisted(() => ({
  getBalance: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    wallet: {
      balance: { useQuery: getBalance },
      pay: { useMutation: () => ({ mutate }) },
    },
  },
}));
vi.mock("../OperationalReadState", () => ({
  useOperationalLabels: () => (_ar: string, en: string) => en,
}));

beforeEach(() => {
  getBalance.mockReturnValue({
    data: { status: "active", currency: "SAR", balance: 20000 },
  });
});
it("does not debit on entry; confirms the displayed invoice in minor units", () => {
  render(<WalletBookingPayment bookingId={7} totalAmount={10250} />);
  fireEvent.click(screen.getByRole("button", { name: "Pay with wallet" }));
  expect(screen.getByText(/102\.50 SAR/)).toBeVisible();
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm wallet payment" })
  );
  expect(mutate).toHaveBeenCalledWith({ bookingId: 7, expectedAmount: 10250 });
});
it.each([
  { status: "active", currency: "SAR", balance: 20 },
  { status: "frozen", currency: "SAR", balance: 20000 },
  { status: "active", currency: "USD", balance: 20000 },
])("blocks ineligible wallets in review", data => {
  getBalance.mockReturnValue({ data });
  render(
    <WalletBookingPayment
      bookingId={7}
      totalAmount={10250}
      initiallyReviewing
    />
  );
  expect(
    screen.queryByRole("button", { name: "Confirm wallet payment" })
  ).toBeNull();
  expect(mutate).not.toHaveBeenCalled();
});
