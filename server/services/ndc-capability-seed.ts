/**
 * Distribution capability matrix: pure data and resolution rules.
 *
 * A single "NDC supported" flag is misleading: Lufthansa Group's published
 * capability matrix shows passenger split and involuntary date change in
 * schema 24.1 but not in 17.2. Every servicing action is therefore gated by
 * the (carrier, seller, channel, schema version, action) combination. This
 * module has no database or framework imports so the documentation generator
 * and tests can load it directly; database-backed lookups live in
 * ndc-capability-matrix.ts.
 */

export const DISTRIBUTION_CHANNELS = ["direct", "ndc", "gds", "ota"] as const;
export type DistributionChannel = (typeof DISTRIBUTION_CHANNELS)[number];

export const DISTRIBUTION_ACTIONS = [
  "shop",
  "price",
  "order_create",
  "pay",
  "order_change_voluntary",
  "order_change_involuntary",
  "passenger_split",
  "seat_move",
  "seat_fee_refund",
  "ancillary_change",
  "refund",
  "reissue",
  "name_correction",
] as const;
export type DistributionAction = (typeof DISTRIBUTION_ACTIONS)[number];

export const CAPABILITY_SUPPORT = [
  "supported",
  "unsupported",
  "partial",
] as const;
export type CapabilitySupport = (typeof CAPABILITY_SUPPORT)[number];

export const CAPABILITY_CONFIRMATION = ["confirmed", "unconfirmed"] as const;
export type CapabilityConfirmation = (typeof CAPABILITY_CONFIRMATION)[number];

/** Wildcard for carrier, seller and the channel-default schema version. */
export const ANY = "*";

/**
 * Schema version of the internal Offer/Order vocabulary. The message names
 * (AirShopping, OfferPrice, OrderCreate, OrderRetrieve, OrderCancel,
 * OrderChange) follow 21.3, but they are exposed over tRPC/OpenAPI JSON only;
 * no schema-conformant 17.2, 21.3 or 24.1 XML/JSON endpoint exists.
 */
export const INTERNAL_NDC_VERSION = "21.3";

export interface CapabilityRow {
  id?: number;
  source: "seed" | "database";
  carrierCode: string;
  sellerId: string;
  channel: DistributionChannel;
  /** Exact ("24.1"), inclusive range ("17.2-21.3") or "*" (channel default). */
  schemaVersion: string;
  action: DistributionAction;
  support: CapabilitySupport;
  confirmation: CapabilityConfirmation;
  evidenceUrl: string | null;
  evidenceNote: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}

export interface CapabilityQuery {
  carrierCode: string;
  sellerId: string;
  channel: DistributionChannel;
  schemaVersion: string;
  action: DistributionAction;
  at?: Date;
}

export type CapabilityPrecedence =
  | "exact_version"
  | "version_range"
  | "channel_default"
  | "none";

export interface CapabilityDecision {
  carrierCode: string;
  sellerId: string;
  channel: DistributionChannel;
  schemaVersion: string;
  action: DistributionAction;
  support: CapabilitySupport | "unknown";
  confirmation: CapabilityConfirmation;
  precedence: CapabilityPrecedence;
  allowed: boolean;
  reason: string;
  evidenceUrl: string | null;
  evidenceNote: string | null;
  rowId: number | null;
  source: CapabilityRow["source"] | null;
}

const versionPattern = /^\d+\.\d+$/;
const rangePattern = /^(\d+\.\d+)-(\d+\.\d+)$/;

function parseVersion(version: string): [number, number] | null {
  if (!versionPattern.test(version)) return null;
  const [major, minor] = version.split(".").map(Number);
  return [major, minor];
}

function compareVersions(a: [number, number], b: [number, number]) {
  return a[0] === b[0] ? a[1] - b[1] : a[0] - b[0];
}

/** Validate a stored schema version expression. */
export function isSchemaVersionExpression(value: string) {
  if (value === ANY) return true;
  if (versionPattern.test(value)) return true;
  const range = value.match(rangePattern);
  if (!range) return false;
  const low = parseVersion(range[1]);
  const high = parseVersion(range[2]);
  return !!low && !!high && compareVersions(low, high) <= 0;
}

function versionMatch(
  rowVersion: string,
  queried: string
): Exclude<CapabilityPrecedence, "none"> | null {
  if (rowVersion === ANY) return "channel_default";
  if (rowVersion === queried) return "exact_version";
  const range = rowVersion.match(rangePattern);
  const wanted = parseVersion(queried);
  if (!range || !wanted) return null;
  const low = parseVersion(range[1]);
  const high = parseVersion(range[2]);
  if (!low || !high) return null;
  return compareVersions(low, wanted) <= 0 && compareVersions(wanted, high) <= 0
    ? "version_range"
    : null;
}

const precedenceRank: Record<CapabilityPrecedence, number> = {
  exact_version: 3,
  version_range: 2,
  channel_default: 1,
  none: 0,
};

export function capabilityKey(row: {
  carrierCode: string;
  sellerId: string;
  channel: string;
  schemaVersion: string;
  action: string;
}) {
  return [
    row.carrierCode.toUpperCase(),
    row.sellerId,
    row.channel,
    row.schemaVersion,
    row.action,
  ].join("|");
}

export function describeCombination(query: {
  carrierCode: string;
  sellerId: string;
  channel: string;
  schemaVersion: string;
}) {
  return `carrier ${query.carrierCode.toUpperCase()}, seller ${query.sellerId}, channel ${query.channel}, schema ${query.schemaVersion}`;
}

/** Database rows replace seed rows with the same combination key. */
export function mergeCapabilityRows(
  seeds: readonly CapabilityRow[],
  stored: readonly CapabilityRow[]
) {
  const merged = new Map<string, CapabilityRow>();
  for (const row of seeds) merged.set(capabilityKey(row), row);
  for (const row of stored) merged.set(capabilityKey(row), row);
  return [...merged.values()];
}

/**
 * Resolve one combination. Precedence: exact schema version, then a version
 * range containing the queried version, then the channel default ("*");
 * within the same level an exact carrier beats the wildcard and an exact
 * seller beats the wildcard. Only a confirmed row with support "supported" or
 * "partial" authorizes the action; unknown combinations fail closed.
 */
export function resolveCapability(
  rows: readonly CapabilityRow[],
  query: CapabilityQuery
): CapabilityDecision {
  const at = query.at ?? new Date();
  const carrier = query.carrierCode.toUpperCase();
  let best: {
    row: CapabilityRow;
    score: number;
    level: CapabilityPrecedence;
  } | null = null;
  for (const row of rows) {
    if (row.action !== query.action || row.channel !== query.channel) continue;
    if (row.carrierCode !== ANY && row.carrierCode.toUpperCase() !== carrier)
      continue;
    if (row.sellerId !== ANY && row.sellerId !== query.sellerId) continue;
    if (row.effectiveFrom && row.effectiveFrom > at) continue;
    if (row.effectiveTo && row.effectiveTo < at) continue;
    const level = versionMatch(row.schemaVersion, query.schemaVersion);
    if (!level) continue;
    const score =
      precedenceRank[level] * 100 +
      (row.carrierCode === ANY ? 0 : 10) +
      (row.sellerId === ANY ? 0 : 1) +
      (row.source === "database" ? 0.5 : 0);
    if (!best || score > best.score) best = { row, score, level };
  }
  const base = {
    carrierCode: carrier,
    sellerId: query.sellerId,
    channel: query.channel,
    schemaVersion: query.schemaVersion,
    action: query.action,
  };
  const combination = describeCombination(base);
  if (!best)
    return {
      ...base,
      support: "unknown",
      confirmation: "unconfirmed",
      precedence: "none",
      allowed: false,
      reason: `No distribution capability is recorded for ${query.action} on ${combination}; operator confirmation is required before this action is offered`,
      evidenceUrl: null,
      evidenceNote: null,
      rowId: null,
      source: null,
    };
  const { row, level } = best;
  const usable = row.support === "supported" || row.support === "partial";
  const allowed = usable && row.confirmation === "confirmed";
  const reason = allowed
    ? `${query.action} is ${row.support} on ${combination} (${level.replace("_", " ")})`
    : row.confirmation !== "confirmed"
      ? `${query.action} is recorded as ${row.support} but unconfirmed on ${combination}; operator confirmation is required`
      : `${query.action} is unsupported on ${combination} (${level.replace("_", " ")})`;
  return {
    ...base,
    support: row.support,
    confirmation: row.confirmation,
    precedence: level,
    allowed,
    reason,
    evidenceUrl: row.evidenceUrl,
    evidenceNote: row.evidenceNote,
    rowId: row.id ?? null,
    source: row.source,
  };
}

type SeedInput = Partial<Omit<CapabilityRow, "source" | "id">> &
  Pick<CapabilityRow, "channel" | "action" | "support">;

function seed(input: SeedInput): CapabilityRow {
  return {
    source: "seed",
    carrierCode: ANY,
    sellerId: ANY,
    schemaVersion: ANY,
    confirmation: "unconfirmed",
    evidenceUrl: null,
    evidenceNote: null,
    effectiveFrom: null,
    effectiveTo: null,
    ...input,
  };
}

const repo = (path: string) =>
  `https://github.com/kafaat/ais-aviation-system/blob/main/${path}`;

/** Local implementation of the internal 21.3 vocabulary on the direct channel. */
const directRows: CapabilityRow[] = (
  [
    [
      "shop",
      "supported",
      "server/services/ndc.service.ts",
      "AirShopping over tRPC/OpenAPI JSON (searchOffers); no schema-conformant XML endpoint",
    ],
    [
      "price",
      "supported",
      "server/services/ndc.service.ts",
      "OfferPrice over tRPC/OpenAPI JSON (getOffer); fingerprinted retail offers",
    ],
    [
      "order_create",
      "supported",
      "server/services/ndc.service.ts",
      "OrderCreate with inventory lock and transactional idempotency (createOrder)",
    ],
    [
      "pay",
      "supported",
      "server/services/payment-settlement.service.ts",
      "Stripe checkout with verified webhook settlement only; live sandbox acceptance E01 is still open",
    ],
    [
      "order_change_voluntary",
      "supported",
      "server/__tests__/order-servicing.test.ts",
      "Paid SAR itinerary exchange up to six segments before check-in (order-servicing.service.ts, capability ndcPaidServicing)",
    ],
    [
      "order_change_involuntary",
      "partial",
      "docs/research/2026-11-market-gap-analysis/implementation-status.md",
      "IROPS recovery records the involuntary change on the linked order and leaves issuance pending; no SSIM/ASM import or external reissue receipt (row 18)",
    ],
    [
      "passenger_split",
      "unsupported",
      "docs/research/2026-11-market-gap-analysis/notes/internal_inventory.md",
      "No PNR or order split exists (gap F17); split payments divide funding, not passengers",
    ],
    [
      "seat_move",
      "partial",
      "server/services/seat-exchange.service.ts",
      "An equivalent paid seat is retained on the replacement sector; otherwise the exchange is blocked for manual review",
    ],
    [
      "seat_fee_refund",
      "unsupported",
      "server/services/seat-exchange.service.ts",
      "No refund path exists for a paid seat fee; a seat that cannot be retained blocks the exchange",
    ],
    [
      "ancillary_change",
      "supported",
      "server/services/ndc-unpaid.service.ts",
      "Unpaid invoice ancillaries (ndc-unpaid.service.ts) and paid catalog entitlements (order-servicing.service.ts); no EMD issuance",
    ],
    [
      "refund",
      "supported",
      "server/services/order-refunds.service.ts",
      "Exchange refunds return to the original Stripe payer receipts; wallet or external funding needs its own refund authority",
    ],
    [
      "reissue",
      "partial",
      "server/services/ticket-coupons.service.ts",
      "Local coupon exchange only; 13-digit numbers are local references and external reissue is blocked (capability ndcExternalFulfillment)",
    ],
    [
      "name_correction",
      "partial",
      "server/services/ndc-unpaid.service.ts",
      "Name updates on unpaid invoices via OrderChange passengerUpdates; paid name correction is not implemented",
    ],
  ] as const
).map(([action, support, path, note]) =>
  seed({
    channel: "direct",
    schemaVersion: INTERNAL_NDC_VERSION,
    action,
    support,
    confirmation: "confirmed",
    evidenceUrl: repo(path),
    evidenceNote: note,
  })
);

/**
 * Lufthansa Group NDC API (LH, LX, OS, SN): the published capability matrix
 * lists passenger split and involuntary date change under schema 24.1 and
 * not under 17.2 (owner finding, 3 November 2026). The matrix itself sits
 * behind the partner portal; the programme page is the public reference.
 */
const lufthansaGroupPortal =
  "https://business.lufthansagroup.com/ch/de/program/experts/programs-and-groups/ndc";
const lufthansaGroupRows: CapabilityRow[] = ["LH", "LX", "OS", "SN"].flatMap(
  carrierCode =>
    (["passenger_split", "order_change_involuntary"] as const).flatMap(
      action => [
        seed({
          carrierCode,
          channel: "ndc",
          schemaVersion: "24.1",
          action,
          support: "supported",
          confirmation: "confirmed",
          evidenceUrl: lufthansaGroupPortal,
          evidenceNote:
            "Lufthansa Group NDC capability matrix: available in schema 24.1 (owner finding 2026-11-03); NDC 24.1 hybrid certification required for agencies",
        }),
        seed({
          carrierCode,
          channel: "ndc",
          schemaVersion: "17.2",
          action,
          support: "unsupported",
          confirmation: "confirmed",
          evidenceUrl: lufthansaGroupPortal,
          evidenceNote:
            "Lufthansa Group NDC capability matrix: not available in schema 17.2 (owner finding 2026-11-03)",
        }),
      ]
    )
);

/** Secondary research sources; unconfirmed until the operator verifies them. */
const researchRows: CapabilityRow[] = [
  ...(["shop", "price", "order_create"] as const).map(action =>
    seed({
      carrierCode: "AY",
      channel: "ndc",
      schemaVersion: "21.3",
      action,
      support: "supported",
      evidenceUrl:
        "https://tragento.com/en/latest-news-and-trends-2024-2025-in-ndc-distribution/",
      evidenceNote:
        "Finnair published the migration of its NDC system to 21.3 in July 2025 (trade press, secondary)",
    })
  ),
  ...(["shop", "price"] as const).map(action =>
    seed({
      carrierCode: "IB",
      channel: "ndc",
      schemaVersion: "24.1",
      action,
      support: "supported",
      evidenceUrl:
        "https://transform.atlassian.net/wiki/spaces/NDCDOC/pages/6350012424/Version+24.1",
      evidenceNote:
        "Iberia developer documentation: 24.1 API based on the IATA 24.1 standard with Branded Fares",
    })
  ),
];

/** Channel defaults: no contracted seller exists, so every action fails closed. */
const channelDefaultRows: CapabilityRow[] = (
  ["ndc", "gds", "ota"] as const
).flatMap(channel =>
  DISTRIBUTION_ACTIONS.map(action =>
    seed({
      channel,
      action,
      support: "unsupported",
      evidenceUrl: repo("docs/audits/2026-09-15-audit-closure.md"),
      evidenceNote: `No contracted ${channel.toUpperCase()} seller or counterparty test (external acceptance E03 open); operator confirmation required`,
    })
  )
);

export const seedDistributionCapabilities: readonly CapabilityRow[] = [
  ...directRows,
  ...lufthansaGroupRows,
  ...researchRows,
  ...channelDefaultRows,
];

const escapeCell = (value: string) =>
  value.replaceAll("|", "\\|").replaceAll("\n", " ");
const formatDate = (value: Date | null) =>
  value ? value.toISOString().slice(0, 10) : "";

export function sortCapabilityRows<T extends CapabilityRow>(
  rows: readonly T[]
) {
  const channelRank = (c: string) => DISTRIBUTION_CHANNELS.indexOf(c as never);
  const actionRank = (a: string) => DISTRIBUTION_ACTIONS.indexOf(a as never);
  return [...rows].sort(
    (a, b) =>
      channelRank(a.channel) - channelRank(b.channel) ||
      a.carrierCode.localeCompare(b.carrierCode) ||
      a.sellerId.localeCompare(b.sellerId) ||
      a.schemaVersion.localeCompare(b.schemaVersion) ||
      actionRank(a.action) - actionRank(b.action)
  );
}

/** Markdown export used by scripts/generate-ndc-capability-matrix.ts and its drift test. */
export function renderCapabilityMatrixMarkdown(rows: readonly CapabilityRow[]) {
  const table = sortCapabilityRows(rows).map(row =>
    [
      row.carrierCode,
      row.sellerId,
      row.channel,
      row.schemaVersion,
      row.action,
      row.support,
      row.confirmation,
      [formatDate(row.effectiveFrom), formatDate(row.effectiveTo)]
        .filter(Boolean)
        .join(" → ") || "open",
      row.evidenceUrl
        ? `[${escapeCell(row.evidenceNote ?? "source")}](${row.evidenceUrl})`
        : escapeCell(row.evidenceNote ?? ""),
    ].join(" | ")
  );
  return [
    "# NDC distribution capability matrix",
    "",
    "<!-- Generated by scripts/generate-ndc-capability-matrix.ts from server/services/ndc-capability-seed.ts. Do not edit by hand. -->",
    "",
    'A single "NDC supported" flag is misleading: the same carrier can support passenger split or involuntary date change in schema 24.1 and not in 17.2. Every servicing action is gated by `capabilityFor(carrier, seller, channel, version, action)` in `server/services/ndc-capability-matrix.ts`.',
    "",
    "## Rules",
    "",
    "- Precedence: exact schema version, then an inclusive version range (`17.2-21.3`), then the channel default (`*`). At the same level an exact carrier beats `*` and an exact seller beats `*`.",
    "- Only a **confirmed** row with support `supported` or `partial` authorizes an action. Unconfirmed rows and unknown combinations fail closed and the error names the combination.",
    "- Rows stored in `distribution_capabilities` (admin CRUD under `ndc.capabilities`) replace the seeded row with the same combination key. This document lists the seeded baseline only.",
    `- Internal vocabulary version: ${INTERNAL_NDC_VERSION} message names over tRPC/OpenAPI JSON; no schema-conformant 17.2, 21.3 or 24.1 XML/JSON endpoint, seller authentication or IATA ARM registration exists.`,
    "",
    "## Seeded rows",
    "",
    "<!-- prettier-ignore -->",
    "| Carrier | Seller | Channel | Schema | Action | Support | Confirmation | Effective | Evidence |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...table.map(row => `| ${row} |`),
    "",
  ].join("\n");
}
