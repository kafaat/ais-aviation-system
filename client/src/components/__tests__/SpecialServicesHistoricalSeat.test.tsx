import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SpecialServicesRequest from "../SpecialServicesRequest";
import en from "@/i18n/locales/en.json";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key.split(".").reduce((value, part) => value?.[part], en as any) ?? key,
  }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    specialServices: {
      getAvailableServices: {
        useQuery: () => ({
          data: {
            meal: [{ code: "VGML", name: "Vegetarian meal" }],
            extra_legroom: [],
          },
        }),
      },
      getBookingServices: {
        useQuery: () => ({
          data: [
            {
              id: 8,
              serviceType: "extra_legroom",
              serviceCode: "EXST",
              status: "confirmed",
              passengerName: "Synthetic Passenger",
            },
          ],
        }),
      },
      requestService: { useMutation: () => ({}) },
      cancelService: { useMutation: () => ({}) },
    },
  },
}));
it("keeps the historical record visible without offering EXST or promising a seat", () => {
  render(<SpecialServicesRequest bookingId={1} passengers={[]} />);
  const history = screen.getByRole("button", { name: /Extra Legroom/ });
  fireEvent.click(history);
  expect(screen.getByText(en.specialServices.legacyExst)).toBeVisible();
  const catalog = screen.getByText(
    en.specialServices.availableTypes
  ).parentElement!;
  expect(within(catalog).queryByText("Extra Legroom")).not.toBeInTheDocument();
  expect(
    within(catalog).getByText(en.specialServices.legroomGuidance)
  ).toBeVisible();
});
