import { createTRPCClient, httpLink } from "@trpc/client";
import type { Page } from "@playwright/test";
import superjson from "superjson";
import mysql, {
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { randomUUID } from "node:crypto";
import type { AppRouter } from "../../server/routers";
import { disposableDatabaseUrl } from "../disposable-database";
import { useBrowserSession } from "./browser-session";

export function rpc(page: Page) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url:
          (process.env.E2E_BASE_URL ?? "http://localhost:3000") + "/api/trpc",
        transformer: superjson,
        fetch: async (url, init) => {
          const result = await page.request.fetch(String(url), {
            method: init?.method,
            data: init?.body as string | undefined,
            headers: Object.fromEntries(
              new Headers(init?.headers as HeadersInit)
            ),
          });
          return new Response(new Uint8Array(await result.body()), {
            status: result.status(),
            headers: result.headers(),
          });
        },
      }),
    ],
  });
}
export async function sqlRows<T extends RowDataPacket>(
  sql: string,
  params: (number | string)[] = []
) {
  const db = await mysql.createConnection(disposableDatabaseUrl());
  try {
    return (await db.execute<T[]>(sql, params))[0];
  } finally {
    await db.end();
  }
}
export async function fixtureFlight() {
  const db = await mysql.createConnection(disposableDatabaseUrl());
  try {
    const [flight] = await db.execute<ResultSetHeader>(
      "INSERT INTO flights (flightNumber, airlineId, originId, destinationId, departureTime, arrivalTime, aircraftType, economySeats, businessSeats, economyPrice, businessPrice, economyAvailable, businessAvailable) SELECT ?, airlineId, originId, destinationId, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY)+INTERVAL 2 HOUR, 'B737', 10, 2, 10000, 20000, 10, 2 FROM flights ORDER BY id LIMIT 1",
      ["H" + randomUUID().replaceAll("-", "").slice(0, 8)]
    );
    if (!flight.affectedRows) throw new Error("Seed flight missing");
    return flight.insertId;
  } finally {
    await db.end();
  }
}
export async function ownedBooking(page: Page, funded = false) {
  await useBrowserSession(page, "regular");
  const client = rpc(page),
    flightId = await fixtureFlight();
  const user = await client.auth.me.query();
  if (!user) throw new Error("Authentication failed");
  const command = {
    flightId,
    cabinClass: "economy" as const,
    sessionId: randomUUID(),
    idempotencyKey: randomUUID(),
    passengers: [
      { firstName: "Synthetic", lastName: "Journey", type: "adult" as const },
    ],
  };
  const booking = await client.bookings.create.mutate(command);
  const db = await mysql.createConnection(disposableDatabaseUrl());
  try {
    await db.execute(
      "INSERT INTO user_credits (userId, amount, source) VALUES (?, ?, 'promo')",
      [user.id, booking.totalAmount]
    );
  } finally {
    await db.end();
  }
  if (funded)
    await client.vouchers.useCredits.mutate({
      bookingId: booking.bookingId,
      amount: booking.totalAmount,
    });
  return { booking, flightId, userId: user.id, command };
}
