import { expect, it, vi } from "vitest";
import { responseContracts } from "../contracts/kiosk";
import { getKioskAnalytics } from "./kiosk.service";

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("../db", () => ({ getDb: () => ({ select }) }));

it.each([false, true])(
  "reports session counts separately from print receipts (devices=%s)",
  async devices => {
    const kiosks = [
      {
        id: 1,
        kioskCode: "TEST1",
        location: "Desk",
        terminal: "T1",
        status: "offline",
      },
    ];
    select.mockReturnValueOnce({
      from: () => ({ where: () => (devices ? kiosks : []) }),
    });
    if (devices) {
      select.mockReturnValueOnce({
        from: () => ({
          where: () => ({
            groupBy: () => [
              {
                kioskId: 1,
                totalSessions: 5,
                completedSessions: 1,
                errorSessions: 4,
                checkInSessions: "2",
                bagTagSessions: "3",
              },
            ],
          }),
        }),
      });
    }
    const now = new Date();
    const analytics = responseContracts.getAnalytics.parse(
      await getKioskAnalytics(1, { from: now, to: now })
    );
    expect(analytics.totals).toMatchObject({
      checkInSessions: devices ? 2 : 0,
      bagTagSessions: devices ? 3 : 0,
      printConfirmationAvailable: false,
      boardingPassesPrinted: 0,
      bagTagsPrinted: 0,
    });
  }
);
