import { describe, expect, it } from "vitest";
import { provisionRbd } from "../../scripts/db/provision-rbd";
import { transactionMemory } from "./helpers/transaction-memory";

describe("operator RBD provisioning", () => {
  const row = {
    flightId: 11,
    fareClassId: 41,
    cabin: "economy",
    capacity: 2,
    availableSeats: 2,
    expectedCabinAvailable: 5,
  };
  const manifest = {
    tenantId: 3,
    airlineId: 4,
    reference: "operator-example",
    rows: [row],
  };
  const fixture = () =>
    transactionMemory({
      tenants: [{ id: 3, status: "active" }],
      flights: [11, 12].map(id => ({
        id,
        airlineId: 4,
        tenantId: 3,
        status: "scheduled",
        departureTime: new Date("2035-01-01T00:00:00Z"),
        economySeats: 10,
        economyAvailable: 5,
      })),
      fare_classes: [
        { id: 41, cabinClass: "economy", airlineId: 4, active: true },
      ],
    });
  it("preview creates no inventory; approval binds the plan, and repeat preserves subsequent sales", async () => {
    const f = fixture();
    const preview = await provisionRbd(f.db, manifest);
    expect(f.rows("flight_fare_class_inventory")).toHaveLength(0);
    await expect(
      provisionRbd(
        f.db,
        { ...manifest, rows: [{ ...row, capacity: 3 }] },
        preview.digest
      )
    ).rejects.toThrow("digest");
    await provisionRbd(f.db, manifest, preview.digest);
    f.rows("flight_fare_class_inventory")[0].availableSeats = 0;
    expect(
      (await provisionRbd(f.db, manifest, preview.digest)).rows[0]
    ).toMatchObject({ action: "unchanged", availableSeats: 0 });
  });
  it("rolls back all new rows if a later flight changes between preview and apply", async () => {
    const f = fixture();
    const batch = { ...manifest, rows: [row, { ...row, flightId: 12 }] };
    const preview = await provisionRbd(f.db, batch);
    f.rows("flights")[1].economyAvailable = 4;
    await expect(provisionRbd(f.db, batch, preview.digest)).rejects.toThrow(
      "Cabin inventory changed"
    );
    expect(f.rows("flight_fare_class_inventory")).toHaveLength(0);
  });
  it("refuses ambiguous allocations, wrong operator, missing class or excessive capacity", async () => {
    const f = fixture();
    for (const input of [
      { ...manifest, rows: [row, row] },
      { ...manifest, airlineId: 7 },
      { ...manifest, rows: [{ ...row, fareClassId: 44 }] },
      { ...manifest, rows: [{ ...row, capacity: 30 }] },
    ]) {
      await expect(provisionRbd(f.db, input)).rejects.toThrow();
    }
  });
});
