import { describe, expect, it } from "vitest";
import { canServiceOrder, ndcCapability } from "../services/ndc-capabilities";

const context = {
  carrier: "LH",
  seller: "IATA/ARC",
  channel: "lhg_direct_ndc",
  version: "24.1",
};
describe("NDC servicing matrix", () => {
  it("distinguishes the published version, seller class, carrier and action from an accepted handler", () => {
    expect(ndcCapability(context, "split")).toMatchObject({
      published: "supported",
      executable: false,
    });
    expect(
      ndcCapability({ ...context, version: "17.2" }, "split").published
    ).toBe("unsupported");
    expect(ndcCapability(context, "reassociateAncillary").published).toBe(
      "inProgress"
    );
    expect(ndcCapability(context, "refundSeat").published).toBe("unknown");
    for (const changes of [
      { seller: "agency-100" },
      { carrier: "BA" },
      { channel: "gds" },
      { version: "21.3" },
    ])
      expect(
        ndcCapability({ ...context, ...changes }, "exchange")
      ).toMatchObject({ published: "unknown", executable: false });
  });
  it("accepts direct local orders only on an implemented action and known version", () => {
    const order = {
      airlineId: 7,
      currency: "SAR",
      channel: "direct",
      orderPayload: JSON.stringify({ ndcVersion: "21.3" }),
    };
    expect(canServiceOrder(order, "exchange")).toBe(true);
    expect(canServiceOrder(order, "split")).toBe(false);
    for (const changes of [
      { airlineId: 0 },
      { currency: "EUR" },
      { distributorId: "AIS" },
      { channel: "gds" },
      { orderPayload: "{" },
      { orderPayload: "{}" },
      { orderPayload: '{"ndcVersion":"24.1"}' },
      { ticketNumbers: "{}" },
      { emdNumbers: '["issued"]' },
    ])
      expect(canServiceOrder({ ...order, ...changes }, "exchange")).toBe(false);
  });
});
