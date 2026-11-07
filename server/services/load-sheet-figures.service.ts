/**
 * Stable read model of persisted load sheet editions.
 *
 * Downstream producers (Type B LDM/CPM generation, dispatch displays) read the
 * signed final figures through `getFinalLoadSheetFigures`. The shape is fixed
 * by `LoadSheetRecord` and the `loadSheetFiguresContract` zod schema in
 * server/contracts/weight-balance.ts; `figures.schemaVersion` is bumped on
 * incompatible changes. Only persisted, digest-verified rows are returned, so
 * this module is not behind the development gate: nothing can exist here that
 * the gated service did not record.
 */
import { createHash } from "node:crypto";
import { desc, eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { loadSheets, type LoadSheet } from "../../drizzle/schema";
import type {
  LmcEntry,
  LoadSheetFigures,
  StandardMassRuleSet,
} from "./weight-balance-engine";
import { capabilityCatalog } from "./capability-catalog.service";

export type LoadSheetFlightHeader = {
  flightId: number;
  flightNumber: string;
  airlineId: number;
  date: string;
  departureTime: string;
  origin: string;
  destination: string;
  crew: { cockpit: number; cabin: number } | null;
};

export type ApprovalSnapshot = {
  registrationApproval: "draft" | "operator_approved" | "withdrawn";
  typeApproval: "draft" | "operator_approved" | "withdrawn";
  operatorApproved: boolean;
  ruleSetConfirmation: StandardMassRuleSet["confirmation"];
};

/** What the `load_sheets.figures` JSON column stores. */
export type StoredLoadSheet = {
  flight: LoadSheetFlightHeader;
  figures: LoadSheetFigures;
  approval: ApprovalSnapshot;
  remarks: string[];
};

export type LoadSheetRecord = {
  id: number;
  flightId: number;
  registrationId: number;
  balanceDataId: number;
  edition: number;
  basis: LoadSheet["basis"];
  status: LoadSheet["status"];
  baseEditionId: number | null;
  /** False until the capability catalog records operator dispatch acceptance. */
  dispatchApproved: boolean;
  flight: LoadSheetFlightHeader;
  figures: LoadSheetFigures;
  approval: ApprovalSnapshot;
  remarks: string[];
  lmcList: LmcEntry[];
  digest: string;
  preparedBy: number;
  preparedAt: Date;
  signedBy: number | null;
  signedByName: string | null;
  signedAt: Date | null;
  supersededAt: Date | null;
};

export const ACTIVE_LOAD_SHEET_STATUSES = ["preliminary", "final"] as const;

export function isDispatchAccepted() {
  // The catalog is a readonly literal; widen so the check survives status edits.
  const status: string | undefined = capabilityCatalog.find(
    c => c.id === "weightBalance"
  )?.implementation;
  return status === "implemented";
}

export function loadSheetDigest(stored: StoredLoadSheet, lmcList: LmcEntry[]) {
  return createHash("sha256")
    .update(JSON.stringify({ stored, lmcList }))
    .digest("hex");
}

export function toLoadSheetRecord(row: LoadSheet): LoadSheetRecord {
  const stored = row.figures as unknown as StoredLoadSheet;
  const lmcList = row.lmcList as unknown as LmcEntry[];
  if (loadSheetDigest(stored, lmcList) !== row.digest)
    throw new TRPCError({
      code: "CONFLICT",
      message: `Load sheet ${row.id} content does not match its recorded digest`,
    });
  return {
    id: row.id,
    flightId: row.flightId,
    registrationId: row.registrationId,
    balanceDataId: row.balanceDataId,
    edition: row.edition,
    basis: row.basis,
    status: row.status,
    baseEditionId: row.baseEditionId,
    dispatchApproved: row.dispatchApproved,
    flight: stored.flight,
    figures: stored.figures,
    approval: stored.approval,
    remarks: stored.remarks,
    lmcList,
    digest: row.digest,
    preparedBy: row.preparedBy,
    preparedAt: row.preparedAt,
    signedBy: row.signedBy,
    signedByName: row.signedByName,
    signedAt: row.signedAt,
    supersededAt: row.supersededAt,
  };
}

/**
 * Final (signed) load sheet figures for a flight, or null when no signed
 * edition is current. Superseded editions, including those invalidated by an
 * aircraft change, are never returned. Consumers must still honour
 * `dispatchApproved`: a false value means the figures may be displayed and
 * exercised but not sent as an operational message.
 */
export async function getFinalLoadSheetFigures(
  flightId: number
): Promise<LoadSheetRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(loadSheets)
    .where(
      and(eq(loadSheets.flightId, flightId), eq(loadSheets.status, "final"))
    )
    .orderBy(desc(loadSheets.edition))
    .limit(1);
  return row ? toLoadSheetRecord(row) : null;
}
