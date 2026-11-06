import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/mysql2";
import { createConnection } from "mysql2/promise";
import * as schema from "../../drizzle/schema";
import {
  applyWalletFundingMaintenance,
  previewWalletFundingMaintenance,
  walletFundingMaintenanceScope,
} from "../../server/services/wallet-funding-maintenance.service";

export const usage =
  "Usage: reconcile-wallet-funding <scope.json> [--apply=<preview digest> --approval-reference=<reference>]";

/** Strict parsing happens before connecting. Missing, partial or unknown flags
 * never select apply mode. The scope always names an existing actor and owner. */
export function parseWalletFundingMaintenanceArgs(args: string[]) {
  const [path, ...options] = args;
  if (!path || path.startsWith("--")) throw new Error(usage);
  let approvedDigest: string | undefined;
  let approvalReference: string | undefined;
  for (const option of options) {
    if (option.startsWith("--apply=") && approvedDigest === undefined) {
      approvedDigest = option.slice("--apply=".length);
      if (!/^[a-f0-9]{64}$/.test(approvedDigest)) throw new Error(usage);
    } else if (
      option.startsWith("--approval-reference=") &&
      approvalReference === undefined
    ) {
      approvalReference = option.slice("--approval-reference=".length).trim();
      if (approvalReference.length < 3 || approvalReference.length > 200)
        throw new Error(usage);
    } else throw new Error(usage);
  }
  if ((approvedDigest === undefined) !== (approvalReference === undefined))
    throw new Error(usage);
  return {
    path,
    approval:
      approvedDigest && approvalReference
        ? { approvedDigest, approvalReference }
        : undefined,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = parseWalletFundingMaintenanceArgs(process.argv.slice(2));
  const file = await readFile(options.path, "utf8");
  if (Buffer.byteLength(file, "utf8") > 16384)
    throw new Error("Scope file exceeds 16 KiB");
  const scope = walletFundingMaintenanceScope.parse(JSON.parse(file));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const connection = await createConnection({
    uri: databaseUrl,
    timezone: "Z",
  });
  try {
    await connection.query("SET SESSION time_zone = '+00:00'");
    const db = drizzle(connection, { schema, mode: "default" });
    const result = options.approval
      ? await applyWalletFundingMaintenance(db, scope, options.approval)
      : await previewWalletFundingMaintenance(db, scope);
    console.info(JSON.stringify(result, null, 2));
  } finally {
    await connection.end();
  }
}
