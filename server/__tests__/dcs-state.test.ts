import { expect, it } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import {
  assertDcsCheckInOpen,
  assertDcsPassengerCanAcceptBaggage,
  assertDcsPassengerCanBoard,
  assertDcsPassengerMutable,
  departureState,
  writeDcsPassengerState,
} from "../services/dcs-state.service";

const key = { bookingId: 3, passengerId: 5, flightId: 7 };

it("keeps a closed flight closed for both check-in and baggage acceptance", async () => {
  const fixture = transactionMemory({});
  await expect(assertDcsCheckInOpen(fixture.db, 7)).resolves.toBeUndefined();
  const closed = transactionMemory({
    dcs_flight_operations: [{ id: 1, flightId: 7, checkInState: "closed" }],
  });
  await expect(assertDcsCheckInOpen(closed.db, 7)).rejects.toThrow("closed");
  await expect(
    assertDcsPassengerCanAcceptBaggage(closed.db, key)
  ).rejects.toThrow("closed");
});

it("keeps denial independent of offload and scopes it to the passenger's exact flight", async () => {
  const fixture = transactionMemory({});
  await writeDcsPassengerState(fixture.db, key, "checked_in", true);
  await writeDcsPassengerState(fixture.db, key, "offloaded");
  const [state] = fixture.rows("dcs_passenger_states");
  expect(state).toMatchObject({ state: "offloaded", boardingDenied: true });
  expect(departureState(state, false)).toBe("boarding_denied");
  await expect(assertDcsPassengerMutable(fixture.db, key)).rejects.toThrow(
    "denied"
  );
  await expect(
    assertDcsPassengerCanAcceptBaggage(fixture.db, key)
  ).rejects.toThrow("denied");
  await expect(
    assertDcsPassengerMutable(fixture.db, { ...key, flightId: 8 })
  ).resolves.toBeNull();
});

it("requires deplane before edits and a new check-in after offload", async () => {
  const fixture = transactionMemory({});
  await writeDcsPassengerState(fixture.db, key, "boarded");
  await expect(assertDcsPassengerMutable(fixture.db, key)).rejects.toThrow(
    "deplane"
  );
  await writeDcsPassengerState(fixture.db, key, "offloaded");
  await expect(assertDcsPassengerCanBoard(fixture.db, key)).rejects.toThrow(
    "check in again"
  );
  await expect(
    assertDcsPassengerMutable(fixture.db, key)
  ).resolves.toMatchObject({ state: "offloaded" });
  await writeDcsPassengerState(fixture.db, key, "checked_in");
  await expect(
    assertDcsPassengerCanBoard(fixture.db, key)
  ).resolves.toMatchObject({ state: "checked_in" });
});
