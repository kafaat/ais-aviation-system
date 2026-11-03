// Published carrier support is descriptive. Only the local AIS handler can
// authorize a write; no external seller or carrier adapter has been accepted.
export const LOCAL_NDC_VERSION = "21.3";
export const LHG_SOURCE =
  "https://lhgroupairlines.com/ndc/en/about-ndc/capabilities";
export const ndcActions = [
  "exchange",
  "split",
  "involuntaryChange",
  "involuntaryCancel",
  "reassociateAncillary",
  "refundSeat",
  "addAncillary",
  "removeAncillary",
  "updateDetails",
] as const;
export type NdcAction = (typeof ndcActions)[number];

const lhgVersions = {
  "17.2": {
    exchange: "supported",
    split: "unsupported",
    involuntaryChange: "unsupported",
    involuntaryCancel: "unsupported",
    reassociateAncillary: "inProgress",
  },
  "24.1": {
    exchange: "supported",
    split: "supported",
    involuntaryChange: "supported",
    involuntaryCancel: "supported",
    reassociateAncillary: "inProgress",
  },
} as const;

type Context = {
  carrier: string;
  seller: string;
  channel: string;
  version: string;
};
export function ndcCapability(context: Context, action: NdcAction) {
  const { carrier, seller, channel, version } = context;
  if (
    /^[1-9]\d*$/.test(carrier) &&
    seller === "AIS" &&
    channel === "direct" &&
    version === LOCAL_NDC_VERSION
  ) {
    return {
      executable: [
        "exchange",
        "addAncillary",
        "removeAncillary",
        "updateDetails",
      ].includes(action),
      published: "unknown",
      source: null,
    };
  }
  if (
    ["LH", "LX", "OS", "SN", "EN", "4Y"].includes(carrier) &&
    seller === "IATA/ARC" &&
    channel === "lhg_direct_ndc" &&
    (version === "17.2" || version === "24.1")
  ) {
    const row = lhgVersions[version];
    return {
      executable: false,
      published: Object.hasOwn(row, action)
        ? row[action as keyof typeof row]
        : "unknown",
      source: LHG_SOURCE,
    };
  }
  return { executable: false, published: "unknown", source: null };
}

type OrderOrigin = {
  airlineId: number;
  channel: string;
  distributorId?: string | null;
  orderPayload: string;
  currency: string;
  ticketNumbers?: string | null;
  emdNumbers?: string | null;
};
export function canServiceOrder(order: OrderOrigin, action: NdcAction) {
  try {
    const payload: unknown = JSON.parse(order.orderPayload);
    if (
      !payload ||
      typeof payload !== "object" ||
      !("ndcVersion" in payload) ||
      typeof payload.ndcVersion !== "string" ||
      order.currency !== "SAR"
    )
      return false;
    for (const documents of [order.ticketNumbers, order.emdNumbers]) {
      const parsed: unknown = JSON.parse(documents ?? "[]");
      if (!Array.isArray(parsed) || parsed.length) return false;
    }
    // A distributor identifier is always an external identity, including
    // one whose literal name happens to match AIS.
    return ndcCapability(
      {
        carrier: String(order.airlineId),
        seller:
          order.distributorId == null
            ? "AIS"
            : "distributor:" + order.distributorId,
        channel: order.channel,
        version: payload.ndcVersion,
      },
      action
    ).executable;
  } catch {
    return false;
  }
}
