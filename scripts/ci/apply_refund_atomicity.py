from pathlib import Path

p = Path("server/services/refunds.service.ts")
s = p.read_text()
old = '''    await database
      .update(bookings)
      .set({
        paymentStatus: isFullRefund ? "refunded" : "paid",
        status: isFullRefund ? "cancelled" : booking.status,
      })
      .where(eq(bookings.id, input.bookingId));

    if (isFullRefund && booking.status === "confirmed") {
      if (booking.cabinClass === "business") {
        await database
          .update(flights)
          .set({
            businessAvailable: sql`${flights.businessAvailable} + ${booking.numberOfPassengers}`,
          })
          .where(eq(flights.id, booking.flightId));
      } else {
        await database
          .update(flights)
          .set({
            economyAvailable: sql`${flights.economyAvailable} + ${booking.numberOfPassengers}`,
          })
          .where(eq(flights.id, booking.flightId));
      }

      console.info(
        `[Refund] Restored ${booking.numberOfPassengers} ${booking.cabinClass} seat(s) to flight ${booking.flightId}`
      );
    }

    const paymentResult = await database
      .select()
      .from(payments)
      .where(eq(payments.bookingId, input.bookingId))
      .limit(1);

    if (paymentResult[0]) {
      await database
        .update(payments)
        .set({
          status: isFullRefund ? "refunded" : "completed",
        })
        .where(eq(payments.id, paymentResult[0].id));
    }
'''
new = '''    const localReconciliation = await database.transaction(async tx => {
      // Stripe idempotency protects provider money movement. Serialize the
      // corresponding local transition so seat restoration is exactly-once.
      const [lockedBooking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .for("update")
        .limit(1);

      if (!lockedBooking) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found during refund reconciliation",
        });
      }

      const shouldRestoreSeats =
        isFullRefund &&
        lockedBooking.paymentStatus !== "refunded" &&
        lockedBooking.status === "confirmed";

      await tx
        .update(bookings)
        .set({
          paymentStatus: isFullRefund ? "refunded" : "paid",
          status: isFullRefund ? "cancelled" : lockedBooking.status,
        })
        .where(eq(bookings.id, input.bookingId));

      if (shouldRestoreSeats) {
        if (lockedBooking.cabinClass === "business") {
          await tx
            .update(flights)
            .set({
              businessAvailable: sql`${flights.businessAvailable} + ${lockedBooking.numberOfPassengers}`,
            })
            .where(eq(flights.id, lockedBooking.flightId));
        } else {
          await tx
            .update(flights)
            .set({
              economyAvailable: sql`${flights.economyAvailable} + ${lockedBooking.numberOfPassengers}`,
            })
            .where(eq(flights.id, lockedBooking.flightId));
        }
      }

      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.bookingId, input.bookingId))
        .limit(1);

      if (payment) {
        await tx
          .update(payments)
          .set({ status: isFullRefund ? "refunded" : "completed" })
          .where(eq(payments.id, payment.id));
      }

      return { shouldRestoreSeats, lockedBooking };
    });

    if (localReconciliation.shouldRestoreSeats) {
      console.info(
        `[Refund] Restored ${localReconciliation.lockedBooking.numberOfPassengers} ${localReconciliation.lockedBooking.cabinClass} seat(s) to flight ${localReconciliation.lockedBooking.flightId}`
      );
    }
'''
assert s.count(old) == 1, "refund local-write block changed unexpectedly"
p.write_text(s.replace(old, new, 1))

Path("server/services/refunds.atomicity.test.ts").write_text('''import { readFileSync } from "node:fs";\nimport { describe, expect, it } from "vitest";\n\nconst source = readFileSync(new URL("./refunds.service.ts", import.meta.url), "utf8");\n\ndescribe("refund local reconciliation atomicity", () => {\n  it("serializes reconciliation and restores seats only on the first full-refund transition", () => {\n    expect(source).toContain("database.transaction(async tx =>");\n    expect(source).toContain('.for("update")');\n    expect(source).toContain('lockedBooking.paymentStatus !== "refunded"');\n    expect(source).toContain('lockedBooking.status === "confirmed"');\n\n    const start = source.indexOf("const localReconciliation = await database.transaction");\n    const end = source.indexOf("if (localReconciliation.shouldRestoreSeats)");\n    const body = source.slice(start, end);\n    expect(body).toContain(".update(bookings)");\n    expect(body).toContain(".update(flights)");\n    expect(body).toContain(".update(payments)");\n    expect(body).not.toContain("await database\\n          .update(flights)");\n  });\n});\n''')
