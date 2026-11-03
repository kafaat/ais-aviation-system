import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PayoutComparison } from "../PayoutComparison";
import { payoutEvidence } from "@shared/payout-comparison";

const { mutate, reset } = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    bspReporting: {
      comparePayout: {
        useMutation: () => ({ mutate, reset, isPending: false }),
      },
    },
  },
}));
vi.mock("../OperationalReadState", () => ({
  useOperationalLabels: () => (_ar: string, en: string) => en,
}));
afterEach(cleanup);

it("submits only structurally complete, independently referenced statement data", () => {
  render(<PayoutComparison />);
  const field = screen.getByRole("textbox", { name: /Statement evidence/ });
  const submit = screen.getByRole("button", { name: "Compare" });
  const sample = payoutEvidence.parse(
    JSON.parse(screen.getByText(/"po_example",/).textContent!)
  );
  fireEvent.change(field, {
    target: { value: JSON.stringify({ ...sample, bank: undefined }) },
  });
  fireEvent.click(submit);
  expect(screen.getByRole("alert")).toHaveTextContent("Check the format");
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: JSON.stringify(sample) } });
  fireEvent.click(submit);
  expect(mutate).toHaveBeenCalledWith(sample);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
