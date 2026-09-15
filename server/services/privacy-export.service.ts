import { createHash } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as s from "../../drizzle/schema";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";

const PAGE_SIZE = 25;
const CHUNK_BYTES = 64 * 1024;
export const MAX_EXPORT_BYTES = 512 * 1024 * 1024;
type Row = Record<string, unknown>;
type PersonalTable =
  | typeof s.savedPassengers
  | typeof s.wallets
  | typeof s.walletTransactions
  | typeof s.userCredits
  | typeof s.creditUsage
  | typeof s.consentRecords
  | typeof s.consentHistory
  | typeof s.milesTransactions
  | typeof s.favoriteFlights
  | typeof s.flightReviews
  | typeof s.bookingModifications;

/** Keyset pages preserve every row in the transaction's repeatable-read snapshot. */
async function* personalRows(
  db: SettlementTx,
  table: PersonalTable,
  userId: number
): AsyncGenerator<Row> {
  let after = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(table)
      .where(and(eq(table.userId, userId), gt(table.id, after)))
      .orderBy(table.id)
      .limit(PAGE_SIZE);
    for (const row of rows) yield row;
    if (rows.length < PAGE_SIZE) return;
    after = rows[rows.length - 1].id;
  }
}

async function* bookingRows(
  db: SettlementTx,
  userId: number
): AsyncGenerator<Row> {
  let after = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(s.bookings)
      .where(and(eq(s.bookings.userId, userId), gt(s.bookings.id, after)))
      .orderBy(s.bookings.id)
      .limit(PAGE_SIZE);
    for (const booking of rows) {
      const passengers = await db
        .select()
        .from(s.passengers)
        .where(eq(s.passengers.bookingId, booking.id))
        .orderBy(s.passengers.id)
        .limit(10001);
      if (passengers.length > 10000)
        throw new Error(
          "Export exceeds supported passengers per booking; assisted export required"
        );
      yield { ...booking, passengers };
    }
    if (rows.length < PAGE_SIZE) return;
    after = rows[rows.length - 1].id;
  }
}
async function* bookingRelatedRows(
  db: SettlementTx,
  userId: number,
  kind: "payments" | "claims"
): AsyncGenerator<Row> {
  const table = kind === "payments" ? s.payments : s.compensationClaims;
  let after = 0;
  for (;;) {
    const rows =
      kind === "payments"
        ? await db
            .select({
              id: s.payments.id,
              bookingId: s.payments.bookingId,
              amount: s.payments.amount,
              currency: s.payments.currency,
              method: s.payments.method,
              status: s.payments.status,
              createdAt: s.payments.createdAt,
            })
            .from(s.payments)
            .where(
              and(
                gt(s.payments.id, after),
                inArray(
                  s.payments.bookingId,
                  db
                    .select({ id: s.bookings.id })
                    .from(s.bookings)
                    .where(eq(s.bookings.userId, userId))
                )
              )
            )
            .orderBy(s.payments.id)
            .limit(PAGE_SIZE)
        : await db
            .select()
            .from(s.compensationClaims)
            .where(
              and(
                gt(s.compensationClaims.id, after),
                inArray(
                  s.compensationClaims.bookingId,
                  db
                    .select({ id: s.bookings.id })
                    .from(s.bookings)
                    .where(eq(s.bookings.userId, userId))
                )
              )
            )
            .orderBy(table.id)
            .limit(PAGE_SIZE);
    for (const row of rows) yield row;
    if (rows.length < PAGE_SIZE) return;
    after = rows[rows.length - 1].id;
  }
}
async function* invitations(
  db: SettlementTx,
  userId: number
): AsyncGenerator<Row> {
  let after = "";
  for (;;) {
    const rows = await db
      .select()
      .from(s.corporateInvitations)
      .where(
        and(
          eq(s.corporateInvitations.recipientUserId, userId),
          gt(s.corporateInvitations.id, after)
        )
      )
      .orderBy(s.corporateInvitations.id)
      .limit(PAGE_SIZE);
    for (const row of rows) yield row;
    if (rows.length < PAGE_SIZE) return;
    after = rows[rows.length - 1].id;
  }
}

/** The existing subject inventory, streamed without collecting all bookings,
 * all IDs or all financial history in one JavaScript array. */
export async function* privacyDocument(
  db: SettlementTx,
  userId: number,
  format: "json" | "csv"
): AsyncGenerator<string> {
  const [profile] = await db
    .select({
      id: s.users.id,
      name: s.users.name,
      email: s.users.email,
      role: s.users.role,
      createdAt: s.users.createdAt,
      lastSignedIn: s.users.lastSignedIn,
    })
    .from(s.users)
    .where(eq(s.users.id, userId));
  const [preferences] = await db
    .select()
    .from(s.userPreferences)
    .where(eq(s.userPreferences.userId, userId));
  const [consent] = await db
    .select()
    .from(s.userConsents)
    .where(eq(s.userConsents.userId, userId));
  const [loyalty] = await db
    .select()
    .from(s.loyaltyAccounts)
    .where(eq(s.loyaltyAccounts.userId, userId));
  const scalars: Array<[string, unknown]> = [
    ["exportedAt", new Date().toISOString()],
    ["exportVersion", "3.0"],
    ["profile", profile ?? null],
    ["preferences", preferences ?? null],
    ["consent", consent ?? null],
    ["loyalty", loyalty ?? null],
  ];
  const arrays: Array<[string, AsyncIterable<Row>]> = [
    ["savedPassengers", personalRows(db, s.savedPassengers, userId)],
    ["wallet", personalRows(db, s.wallets, userId)],
    ["walletTransactions", personalRows(db, s.walletTransactions, userId)],
    ["credits", personalRows(db, s.userCredits, userId)],
    ["creditUsage", personalRows(db, s.creditUsage, userId)],
    ["corporateInvitations", invitations(db, userId)],
    ["compensationClaims", bookingRelatedRows(db, userId, "claims")],
    ["cookieConsentHistory", personalRows(db, s.consentRecords, userId)],
    ["consentHistory", personalRows(db, s.consentHistory, userId)],
    ["bookings", bookingRows(db, userId)],
    ["payments", bookingRelatedRows(db, userId, "payments")],
    ["milesTransactions", personalRows(db, s.milesTransactions, userId)],
    ["favorites", personalRows(db, s.favoriteFlights, userId)],
    ["reviews", personalRows(db, s.flightReviews, userId)],
    ["bookingModifications", personalRows(db, s.bookingModifications, userId)],
  ];
  const encode = (json: string) =>
    format === "csv" ? json.replaceAll('"', '""') : json;
  let first = true;
  const prefix = (name: string) => {
    const result =
      format === "csv"
        ? `"${name}","`
        : `${first ? "" : ","}${JSON.stringify(name)}:`;
    first = false;
    return result;
  };
  const suffix = format === "csv" ? '"\r\n' : "";
  yield format === "csv" ? "section,data\r\n" : "{";
  for (const [name, value] of scalars)
    yield prefix(name) + encode(JSON.stringify(value)) + suffix;
  for (const [name, rows] of arrays) {
    yield prefix(name) + "[";
    let firstRow = true;
    for await (const row of rows) {
      yield (firstRow ? "" : ",") + encode(JSON.stringify(row));
      firstRow = false;
    }
    yield "]" + suffix;
  }
  if (format === "json") yield "}";
}

export async function storePrivacyDocument(
  tx: SettlementTx,
  requestId: number,
  userId: number,
  format: "json" | "csv",
  expiresAt: Date
) {
  let part = 0,
    size = 0;
  let pending = Buffer.alloc(0);
  const digest = createHash("sha256");
  const write = async (chunk: Buffer) => {
    await tx.insert(s.privacyExportChunks).values({
      requestId,
      part: part++,
      content: chunk.toString("base64"),
      sizeBytes: chunk.length,
      sha256: createHash("sha256").update(chunk).digest("hex"),
      expiresAt,
    });
  };
  for await (const text of privacyDocument(tx, userId, format)) {
    const bytes = Buffer.from(text, "utf8");
    size += bytes.length;
    if (size > MAX_EXPORT_BYTES)
      throw new Error(
        "Export exceeds supported archive size; assisted export required"
      );
    digest.update(bytes);
    let offset = 0;
    while (offset < bytes.length) {
      const length = Math.min(
        CHUNK_BYTES - pending.length,
        bytes.length - offset
      );
      pending = Buffer.concat([
        pending,
        bytes.subarray(offset, offset + length),
      ]);
      offset += length;
      if (pending.length === CHUNK_BYTES) {
        await write(pending);
        pending = Buffer.alloc(0);
      }
    }
  }
  if (pending.length) await write(pending);
  await tx.insert(s.privacyExportArtifacts).values({
    requestId,
    userId,
    content: "",
    chunkCount: part,
    contentType: format === "csv" ? "text/csv" : "application/json",
    sha256: digest.digest("hex"),
    expiresAt,
  });
  return size;
}

export async function openPrivacyDownload(userId: number, requestId: number) {
  const database = getDb();
  if (!database) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const db = database;
  const [row] = await db
    .select({
      artifact: s.privacyExportArtifacts,
      size: s.dataExportRequests.fileSizeBytes,
    })
    .from(s.privacyExportArtifacts)
    .innerJoin(
      s.dataExportRequests,
      eq(s.dataExportRequests.id, s.privacyExportArtifacts.requestId)
    )
    .where(
      and(
        eq(s.privacyExportArtifacts.requestId, requestId),
        eq(s.privacyExportArtifacts.userId, userId),
        eq(s.dataExportRequests.userId, userId),
        eq(s.dataExportRequests.status, "completed")
      )
    );
  if (!row || row.artifact.expiresAt <= new Date())
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Export not found or expired",
    });
  const { artifact } = row;
  async function* content(): AsyncGenerator<Buffer> {
    const digest = createHash("sha256");
    let size = 0;
    if (artifact.chunkCount === 0) {
      const bytes = Buffer.from(artifact.content);
      digest.update(bytes);
      size += bytes.length;
      yield bytes;
    } else {
      for (let part = 0; part < artifact.chunkCount; part++) {
        const [chunk] = await db
          .select()
          .from(s.privacyExportChunks)
          .where(
            and(
              eq(s.privacyExportChunks.requestId, requestId),
              eq(s.privacyExportChunks.part, part)
            )
          );
        if (!chunk) throw new Error("Privacy archive incomplete");
        const bytes = Buffer.from(chunk.content, "base64");
        if (
          bytes.length !== chunk.sizeBytes ||
          createHash("sha256").update(bytes).digest("hex") !== chunk.sha256
        )
          throw new Error("Privacy archive integrity failed");
        digest.update(bytes);
        size += bytes.length;
        yield bytes;
      }
    }
    if (digest.digest("hex") !== artifact.sha256 || size !== row.size)
      throw new Error("Privacy archive integrity failed");
  }
  return { contentType: artifact.contentType, size: row.size, content };
}
