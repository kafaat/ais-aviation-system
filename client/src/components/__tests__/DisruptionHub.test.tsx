import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DisruptionHub } from "../DisruptionHub";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    disruptions: {
      myDisruptions: {
        useQuery: () => ({
          data: [
            {
              id: 1,
              flightId: 5,
              bookingId: 2,
              bookingReference: "PAID01",
              type: "delay",
              extrasReviewRequired: true,
            },
            {
              id: 1,
              flightId: 5,
              bookingId: 3,
              bookingReference: "OTHER1",
              type: "delay",
              extrasReviewRequired: false,
            },
          ],
        }),
      },
    },
  },
}));

it("shows the airline servicing referral only for the affected booking", () => {
  render(<DisruptionHub />);
  const paid = screen.getByText("PAID01").closest(".rounded-lg");
  const other = screen.getByText("OTHER1").closest(".rounded-lg");
  expect(within(paid as HTMLElement).getByRole("note")).toHaveTextContent(
    "disruptions.extrasReview"
  );
  expect(within(other as HTMLElement).queryByRole("note")).toBeNull();
});
