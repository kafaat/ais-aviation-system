import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AdvancedFilters } from "../AdvancedFilters";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
it("offers only supported direct-stop filtering on direct search", () => {
  render(<AdvancedFilters directOnly onApply={vi.fn()} onReset={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "filters.advancedFilters" })
  );
  expect(screen.getByText("filters.direct")).toBeInTheDocument();
  expect(screen.queryByText("filters.oneStop")).not.toBeInTheDocument();
  expect(screen.queryByText("filters.twoStops")).not.toBeInTheDocument();
});
