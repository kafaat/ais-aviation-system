import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const operationalMessageTypes = [
  "PNL",
  "ADL",
  "LDM",
  "MVT",
  "BSM",
  "BPM",
] as const;
export type OperationalMessageType = (typeof operationalMessageTypes)[number];

const typeBAddress = z.string().regex(/^[A-Z0-9]{7}$/);
const station = z.string().regex(/^[A-Z0-9]{3}$/);
const flightDesignator = z.string().regex(/^[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?$/);
const safeToken = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Z0-9 .,/()-]+$/);

export const operationalRouteSchema = z
  .object({
    originAddress: typeBAddress,
    destinationAddress: typeBAddress,
    stationCode: station,
    transportProfile: z.string().min(1).max(64),
    enabled: z.boolean(),
    acceptedAt: z.iso.datetime().nullable(),
  })
  .strict();

const commonSchema = z.object({
  flightNumber: flightDesignator,
  flightDate: z.iso.date(),
  origin: station,
  destination: station,
});

const passengerSchema = z.object({
  recordLocator: safeToken,
  surname: safeToken,
  givenName: safeToken,
});

const payloadSchemas = {
  PNL: commonSchema.extend({ passengers: z.array(passengerSchema).max(999) }),
  ADL: commonSchema.extend({
    changes: z
      .array(passengerSchema.extend({ action: z.enum(["ADD", "DEL", "CHG"]) }))
      .max(999),
  }),
  LDM: commonSchema.extend({
    registration: safeToken,
    passengerCount: z.number().int().nonnegative(),
    baggageCount: z.number().int().nonnegative(),
    baggageWeightKg: z.number().int().nonnegative(),
    cargoWeightKg: z.number().int().nonnegative(),
  }),
  MVT: commonSchema.extend({
    registration: safeToken,
    event: z.enum(["AD", "AA", "ED", "EA"]),
    eventTimeUtc: z.iso.datetime(),
  }),
  BSM: commonSchema.extend({
    bagTag: z.string().regex(/^\d{10}$/),
    surname: safeToken,
    givenName: safeToken,
  }),
  BPM: commonSchema.extend({
    bagTag: z.string().regex(/^\d{10}$/),
    event: z.enum(["ACCEPTED", "LOADED", "TRANSFERRED", "DELIVERED"]),
    eventTimeUtc: z.iso.datetime(),
    location: safeToken,
  }),
} satisfies Record<OperationalMessageType, z.ZodType>;

export type OperationalDraft = {
  messageType: OperationalMessageType;
  profile: "operator-template-v1";
  originAddress: string;
  destinationAddress: string;
  priority: "QU";
  messageContent: string;
  messageDigest: string;
  requiresExternalAcceptance: true;
};

function dayMonth(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const month = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ][d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, "0")}${month}`;
}

function line(...parts: Array<string | number>) {
  return parts.join("/");
}

function buildBody(
  messageType: OperationalMessageType,
  value: Record<string, unknown>
) {
  const common = value as z.infer<typeof commonSchema>;
  const flight = `${common.flightNumber}/${dayMonth(common.flightDate)}`;
  const route = `${common.origin}/${common.destination}`;
  if (messageType === "PNL") {
    const payload = value as z.infer<(typeof payloadSchemas)["PNL"]>;
    return [
      "PNL",
      line(flight, route),
      ...payload.passengers.map(
        passenger =>
          `-${passenger.recordLocator}.${passenger.surname}/${passenger.givenName}`
      ),
      "END",
    ];
  }
  if (messageType === "ADL") {
    const payload = value as z.infer<(typeof payloadSchemas)["ADL"]>;
    return [
      "ADL",
      line(flight, route),
      ...payload.changes.map(
        passenger =>
          `${passenger.action} ${passenger.recordLocator}.${passenger.surname}/${passenger.givenName}`
      ),
      "END",
    ];
  }
  if (messageType === "LDM") {
    const payload = value as z.infer<(typeof payloadSchemas)["LDM"]>;
    return [
      "LDM",
      line(flight, route, payload.registration),
      `PAX/${payload.passengerCount}`,
      `BAG/${payload.baggageCount}/${payload.baggageWeightKg}KG`,
      `CGO/${payload.cargoWeightKg}KG`,
      "END",
    ];
  }
  if (messageType === "MVT") {
    const payload = value as z.infer<(typeof payloadSchemas)["MVT"]>;
    const event = new Date(payload.eventTimeUtc)
      .toISOString()
      .slice(8, 16)
      .replace(/[T:]/g, "");
    return [
      "MVT",
      line(flight, route, payload.registration),
      `${payload.event}${event}Z`,
      "END",
    ];
  }
  if (messageType === "BSM") {
    const payload = value as z.infer<(typeof payloadSchemas)["BSM"]>;
    return [
      "BSM",
      ".V/1",
      `.F/${flight}/${route}`,
      `.N/${payload.bagTag}`,
      `.P/1${payload.surname}/${payload.givenName}`,
      "END",
    ];
  }
  const payload = value as z.infer<(typeof payloadSchemas)["BPM"]>;
  return [
    "BPM",
    ".V/1",
    `.F/${flight}/${route}`,
    `.N/${payload.bagTag}`,
    `.E/${payload.event}/${payload.eventTimeUtc}/${payload.location}`,
    "END",
  ];
}

/**
 * Generates a deterministic operator-template draft. The message body must be
 * validated against the contracted handler profile before transport is enabled.
 */
export function generateOperationalDraft(input: {
  messageType: OperationalMessageType;
  route: z.input<typeof operationalRouteSchema>;
  payload: unknown;
}): OperationalDraft {
  const route = operationalRouteSchema.parse(input.route);
  const payload = payloadSchemas[input.messageType].parse(
    input.payload
  ) as Record<string, unknown>;
  const body = buildBody(input.messageType, payload);
  const messageContent = [
    `QU ${route.destinationAddress}`,
    `.${route.originAddress}`,
    ...body,
  ].join("\n");
  return {
    messageType: input.messageType,
    profile: "operator-template-v1",
    originAddress: route.originAddress,
    destinationAddress: route.destinationAddress,
    priority: "QU",
    messageContent,
    messageDigest: createHash("sha256").update(messageContent).digest("hex"),
    requiresExternalAcceptance: true,
  };
}

export function parseOperationalDraft(content: string) {
  if (content.length > 250_000 || /[\0\r]/.test(content))
    throw new Error("Invalid operational message envelope");
  const lines = content.split("\n");
  const destinationAddress = lines[0]?.match(/^QU ([A-Z0-9]{7})$/)?.[1];
  const originAddress = lines[1]?.match(/^\.([A-Z0-9]{7})$/)?.[1];
  const messageType = lines[2] as OperationalMessageType;
  if (
    !destinationAddress ||
    !originAddress ||
    !operationalMessageTypes.includes(messageType) ||
    lines.at(-1) !== "END"
  )
    throw new Error("Unsupported operational message profile");
  return {
    destinationAddress,
    originAddress,
    messageType,
    lines: lines.slice(3, -1),
    messageDigest: createHash("sha256").update(content).digest("hex"),
  };
}

export type TransmissionStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "received"
  | "acknowledged"
  | "rejected"
  | "retry_scheduled"
  | "failed";

const transitions: Record<TransmissionStatus, readonly TransmissionStatus[]> = {
  draft: ["queued"],
  queued: ["sending", "failed"],
  sending: ["sent", "retry_scheduled", "failed"],
  sent: ["received", "acknowledged", "rejected", "retry_scheduled"],
  received: ["acknowledged", "rejected", "retry_scheduled"],
  acknowledged: [],
  rejected: [],
  retry_scheduled: ["sending", "failed"],
  failed: [],
};

export function assertTransmissionTransition(
  current: TransmissionStatus,
  next: TransmissionStatus
) {
  if (!transitions[current].includes(next))
    throw new Error(`Invalid transmission transition ${current} -> ${next}`);
}

export function requireAcceptedOperationalRoute(
  route: z.input<typeof operationalRouteSchema>
) {
  const parsed = operationalRouteSchema.parse(route);
  if (
    process.env.AIS_TYPE_B_TRANSPORT_ENABLED !== "true" ||
    !parsed.enabled ||
    !parsed.acceptedAt
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Operational messaging transport requires an enabled, accepted station route and AIS_TYPE_B_TRANSPORT_ENABLED=true",
    });
  return parsed;
}
