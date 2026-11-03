import { expect, it, vi } from "vitest";
import { getUserDisruptions } from "./disruption.service";

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("../db", () => ({ getDb: () => ({ select }) }));

it("labels the same disruption for every affected owned booking once", async () => {
  const bookingRows = [
    { bookingId: 1, bookingReference: "PNR1", flightId: 5 },
    { bookingId: 2, bookingReference: "PNR2", flightId: 4 },
    { bookingId: 3, bookingReference: "PNR3", flightId: 4 },
  ];
  const legRows = [
    { bookingId: 2, flightId: 5, status: "confirmed" },
    { bookingId: 2, flightId: 5, status: "pending" },
    { bookingId: 3, flightId: 5, status: "cancelled" },
  ];
  const disruption = { id: 8, flightId: 5 };
  select
    .mockReturnValueOnce({ from: () => ({ where: () => bookingRows }) })
    .mockReturnValueOnce({ from: () => ({ where: () => legRows }) })
    .mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({ where: () => ({ orderBy: () => [disruption] }) }),
      }),
    });
  expect(await getUserDisruptions(11)).toEqual([
    { ...disruption, bookingId: 1, bookingReference: "PNR1" },
    { ...disruption, bookingId: 2, bookingReference: "PNR2" },
  ]);
});
