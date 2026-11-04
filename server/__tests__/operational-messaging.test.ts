import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertTransmissionTransition,
  generateOperationalDraft,
  parseOperationalDraft,
  requireAcceptedOperationalRoute,
} from "../services/operational-messaging.service";

const route = {
  originAddress: "RUHSVXX",
  destinationAddress: "LHRGHXX",
  stationCode: "LHR",
  transportProfile: "handler-contract-v1",
  enabled: false,
  acceptedAt: null,
};
const common = {
  flightNumber: "SV123",
  flightDate: "2026-11-03",
  origin: "RUH",
  destination: "LHR",
};

afterEach(() => vi.unstubAllEnvs());

describe("operational message drafts", () => {
  it("generates and parses deterministic PNL and baggage envelopes", () => {
    const pnl = generateOperationalDraft({
      messageType: "PNL",
      route,
      payload: {
        ...common,
        passengers: [
          { recordLocator: "ABC123", surname: "SALEH", givenName: "ALI" },
        ],
      },
    });
    expect(pnl.messageContent).toBe(
      "QU LHRGHXX\n.RUHSVXX\nPNL\nSV123/03NOV/RUH/LHR\n-ABC123.SALEH/ALI\nEND"
    );
    expect(parseOperationalDraft(pnl.messageContent)).toMatchObject({
      messageType: "PNL",
      originAddress: "RUHSVXX",
      destinationAddress: "LHRGHXX",
      messageDigest: pnl.messageDigest,
    });

    const bsm = generateOperationalDraft({
      messageType: "BSM",
      route,
      payload: {
        ...common,
        bagTag: "0123456789",
        surname: "SALEH",
        givenName: "ALI",
      },
    });
    expect(bsm.messageContent).toContain(".N/0123456789");
    expect(bsm.requiresExternalAcceptance).toBe(true);
  });

  it("carries a changed seat in the operator ADL and rejects seat data on a deletion", () => {
    const passenger = {
      recordLocator: "ABC123",
      surname: "SALEH",
      givenName: "ALI",
    };
    const draft = (action: string, seatNumber?: string) =>
      generateOperationalDraft({
        messageType: "ADL",
        route,
        payload: {
          ...common,
          changes: [{ ...passenger, action, seatNumber }],
        },
      });
    expect(
      parseOperationalDraft(draft("CHG", "12A").messageContent).lines.slice(1)
    ).toEqual(["CHG ABC123.SALEH/ALI", ".SEAT/12A"]);
    expect(
      parseOperationalDraft(draft("DEL").messageContent).lines.at(-1)
    ).toBe("DEL ABC123.SALEH/ALI");
    expect(() => draft("DEL", "12A")).toThrow();
    expect(() => draft("CHG", "1A\nEND")).toThrow();
  });

  it("emits UTC MVT time and validates the four local baggage events", () => {
    const mvt = generateOperationalDraft({
      messageType: "MVT",
      route,
      payload: {
        ...common,
        registration: "HZ-A1",
        event: "AD",
        eventTimeUtc: "2026-11-03T22:15:00.000Z",
      },
    });
    expect(mvt.messageContent).toContain("AD032215Z");
    for (const event of ["ACCEPTED", "LOADED", "TRANSFERRED", "DELIVERED"])
      expect(() =>
        generateOperationalDraft({
          messageType: "BPM",
          route,
          payload: {
            ...common,
            bagTag: "0123456789",
            event,
            eventTimeUtc: "2026-11-03T22:15:00.000Z",
            location: "LHR T2",
          },
        })
      ).not.toThrow();
  });

  it("rejects line injection and invalid bag tags", () => {
    expect(() =>
      generateOperationalDraft({
        messageType: "BSM",
        route,
        payload: {
          ...common,
          bagTag: "123",
          surname: "SALEH\nEND",
          givenName: "ALI",
        },
      })
    ).toThrow();
  });

  it("keeps transport closed until both deployment and route acceptance exist", () => {
    expect(() => requireAcceptedOperationalRoute(route)).toThrow(
      /requires an enabled, accepted/
    );
    vi.stubEnv("AIS_TYPE_B_TRANSPORT_ENABLED", "true");
    expect(() =>
      requireAcceptedOperationalRoute({
        ...route,
        enabled: true,
        acceptedAt: "2026-11-03T00:00:00.000Z",
      })
    ).not.toThrow();
  });

  it("allows retries and ACK/NAK states without reopening terminal outcomes", () => {
    expect(() =>
      assertTransmissionTransition("sending", "retry_scheduled")
    ).not.toThrow();
    expect(() =>
      assertTransmissionTransition("sent", "acknowledged")
    ).not.toThrow();
    expect(() =>
      assertTransmissionTransition("sent", "rejected")
    ).not.toThrow();
    expect(() =>
      assertTransmissionTransition("acknowledged", "queued")
    ).toThrow();
  });
});
