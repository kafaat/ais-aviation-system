/**
 * Serialisers: one payload model, two wire formats.
 *
 * `typeBSerializer` renders the classic teletype text used by SITA/ARINC
 * Type B today. `bixSerializer` renders the same baggage payloads as a JSON
 * document shaped for IATA BIX (RP 1755 on the Airline Industry Data Model).
 * Producers build a payload and never pick a format; the gateway does.
 */
import { generateBpm, generateBsm } from "./bsm";
import { generateLdm } from "./ldm";
import {
  TypeBFormatError,
  type BpmPayload,
  type BsmPayload,
  type MessageSerializer,
  type SerializedMessage,
  type TypeBMessageType,
  type TypeBPayload,
} from "./model";
import { generateMvt } from "./mvt";
import { generateAdl, generatePnl } from "./pnl-adl";
import { ddmmm, flightCode, hhmm } from "./text";

export const typeBSerializer: MessageSerializer = {
  format: "typeb",
  supports: () => true,
  serialize(payload: TypeBPayload): SerializedMessage {
    switch (payload.type) {
      case "PNL":
        return {
          format: "typeb",
          parts: generatePnl(payload).map(lines => lines.join("\n")),
        };
      case "ADL":
        return {
          format: "typeb",
          parts: generateAdl(payload).map(lines => lines.join("\n")),
        };
      case "LDM":
        return { format: "typeb", parts: [generateLdm(payload).join("\n")] };
      case "MVT":
        return { format: "typeb", parts: [generateMvt(payload).join("\n")] };
      case "BSM":
        return { format: "typeb", parts: [generateBsm(payload).join("\n")] };
      case "BPM":
        return { format: "typeb", parts: [generateBpm(payload).join("\n")] };
    }
  },
};

/**
 * BIX readiness. The RP 1755 schema is licensed and has not been read for
 * this implementation, so this JSON mirrors the AIDM vocabulary at the level
 * of the public BIX guidance document (bag, passenger, segments, status).
 * It is a mapping target, not a certified BIX message. Once the schema is
 * available only this function changes; payload producers stay the same.
 */
export function toBixDocument(payload: BsmPayload | BpmPayload) {
  const segment = (f: {
    flight: { carrier: string; number: string; suffix?: string };
    date: Date;
    station: string;
    classCode?: string;
  }) => ({
    operatingCarrierCode: f.flight.carrier,
    flightNumber: f.flight.number,
    flightSuffix: f.flight.suffix ?? null,
    scheduledDate: f.date.toISOString().slice(0, 10),
    typeBDate: ddmmm(f.date),
    station: f.station,
    cabinClassCode: f.classCode ?? null,
  });
  const common = {
    schema: "urn:ais:bix:rp1755-mapping:v0",
    conformance: "mapping_target_not_certified" as const,
    sourceStandard: "IATA RP 1745 Type B",
    processingStation: payload.version.station,
    processingIndicator: payload.version.indicator,
    bags: payload.licensePlates.map(p => ({
      licencePlate: p.plate,
      consecutiveCount: p.count ?? 1,
    })),
    outboundSegment: segment(payload.outbound),
    passenger: payload.passenger
      ? {
          surname: payload.passenger.surname,
          givenNames: payload.passenger.givenNames ?? null,
        }
      : null,
  };
  if (payload.type === "BSM")
    return {
      ...common,
      messageFunction:
        payload.action === "DEL"
          ? "cancel"
          : payload.action === "CHG"
            ? "update"
            : "create",
      recordLocator: payload.locator ?? null,
      passengerStatus: payload.passengerStatus ?? null,
      baggageWeight: payload.baggage
        ? {
            unit: payload.baggage.unit === "K" ? "KGM" : "LBR",
            pieces: payload.baggage.pieces,
            weight: payload.baggage.weight,
          }
        : null,
      onwardSegment: payload.onward ? segment(payload.onward) : null,
      inboundSegment: payload.inbound ? segment(payload.inbound) : null,
    };
  return {
    ...common,
    messageFunction: "processed",
    processing: {
      indicator: payload.processing.indicator,
      timeUtc: payload.processing.time.toISOString(),
      typeBTime: hhmm(payload.processing.time),
      location: payload.processing.location,
      device: payload.processing.device ?? null,
    },
  };
}

export const bixSerializer: MessageSerializer = {
  format: "bix",
  supports: (type: TypeBMessageType) => type === "BSM" || type === "BPM",
  serialize(payload: TypeBPayload): SerializedMessage {
    if (payload.type !== "BSM" && payload.type !== "BPM")
      throw new TypeBFormatError(
        `BIX covers baggage messages only; ${payload.type} ${flightCode(payload.flight)} stays on Type B`
      );
    return { format: "bix", parts: [JSON.stringify(toBixDocument(payload))] };
  },
};

export const serializers: Record<
  SerializedMessage["format"],
  MessageSerializer
> = {
  typeb: typeBSerializer,
  bix: bixSerializer,
};
