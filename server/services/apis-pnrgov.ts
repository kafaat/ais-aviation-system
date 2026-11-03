import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { zoneOffsetMs } from "./civil-day";

export const PNRGOV_VERSION = "21:1";

class PnrgovFieldError extends Error {
  constructor(readonly field: string) {
    super(`PNRGOV field ${field} contains unsupported characters`);
  }
}

function element(value: string, field: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized || /[^A-Z0-9 .,()=/+'?:*-]/.test(normalized)) {
    throw new PnrgovFieldError(field);
  }
  return normalized.replace(/[?+:'*]/g, "?$&");
}

function localDateTime(instant: Date, zone: string) {
  const local = new Date(instant.getTime() + zoneOffsetMs(instant, zone));
  const iso = local.toISOString();
  return {
    date: `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`,
    time: iso.slice(11, 16).replace(":", ""),
  };
}

function interchangeDateTime(instant: Date) {
  const iso = instant.toISOString();
  return `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}:${iso
    .slice(11, 16)
    .replace(":", "")}`;
}

function documentDate(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "";
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
  ][date.getUTCMonth()];
  return `${String(date.getUTCDate()).padStart(2, "0")}${month}${String(
    date.getUTCFullYear()
  ).slice(2)}`;
}

export type PnrgovDraftInput = {
  generatedAt?: Date;
  authorityRecipient: string;
  flight: {
    id: number;
    flightNumber: string;
    departureTime: Date;
    arrivalTime: Date;
  };
  origin: { code: string; country: string; timezone: string };
  destination: { code: string; country: string; timezone: string };
  airline: { code: string; name: string };
  passengers: Array<{
    passengerId: number;
    firstName: string;
    lastName: string;
    bookingReference: string;
  }>;
  apisMap: Map<number, Record<string, unknown>>;
};

/**
 * Produces a PADIS EDIFACT 21.1 structural draft. Country-specific segment
 * requirements, push timing and recipient identifiers remain bilateral and
 * must be accepted before the message is transmitted.
 */
export function generatePNRGOV(data: PnrgovDraftInput): string {
  const generatedAt = data.generatedAt ?? new Date();
  const sender = element(data.airline.code, "airline.code");
  const recipient = element(data.authorityRecipient, "authorityRecipient");
  const origin = element(data.origin.code, "origin.code");
  const destination = element(data.destination.code, "destination.code");
  const flightNumber = element(
    data.flight.flightNumber.replace(data.airline.code, "").trim(),
    "flight.flightNumber"
  );
  const departure = localDateTime(
    data.flight.departureTime,
    data.origin.timezone
  );
  const arrival = localDateTime(
    data.flight.arrivalTime,
    data.destination.timezone
  );
  const control = createHash("sha256")
    .update(
      `${data.flight.id}:${generatedAt.toISOString()}:${data.passengers.length}`
    )
    .digest("hex")
    .slice(0, 14)
    .toUpperCase();
  const pnrGroups = new Map<string, typeof data.passengers>();
  for (const passenger of data.passengers) {
    const key = passenger.bookingReference.trim().toUpperCase();
    const group = pnrGroups.get(key) ?? [];
    group.push(passenger);
    pnrGroups.set(key, group);
  }

  const lines = [
    "UNA:+.?*'",
    `UNB+IATA:1+${sender}+${recipient}+${interchangeDateTime(
      generatedAt
    )}+${control}++PNRGOV'`,
    `UNG+PNRGOV+${sender}+${recipient}+${interchangeDateTime(
      generatedAt
    )}+${control}+IA+${PNRGOV_VERSION}'`,
    `UNH+${control}+PNRGOV:${PNRGOV_VERSION}:IA+${control}'`,
    "MSG+:22'",
    `ORG+${sender}:LST'`,
    `TVL+${departure.date}:${departure.time}:${arrival.date}:${arrival.time}+${origin}+${destination}+${sender}+${flightNumber}'`,
    `EQN+${pnrGroups.size}'`,
  ];

  const rejected: Array<{ passengerId: number; field: string }> = [];
  for (const [recordLocator, passengers] of pnrGroups) {
    const groupLines = ["SRC'"];
    try {
      groupLines.push(
        `RCI+${sender}:${element(recordLocator, "bookingReference")}'`,
        `ORG+${sender}:LST'`
      );
      for (const passenger of passengers) {
        const apis = data.apisMap.get(passenger.passengerId);
        const surname = element(
          String(apis?.["surname"] ?? passenger.lastName),
          "surname"
        );
        const given = element(
          String(apis?.["given_names"] ?? passenger.firstName),
          "given_names"
        );
        groupLines.push(`TIF+${surname}+${given}:A:${passenger.passengerId}'`);
        if (apis) {
          const documentCodes: Record<string, string> = {
            passport: "P",
            national_id: "I",
            visa: "V",
          };
          const documentType =
            documentCodes[String(apis["document_type"])] ?? "";
          if (!documentType) throw new PnrgovFieldError("document_type");
          const issuing = element(
            String(apis["issuing_country"] ?? ""),
            "issuing_country"
          );
          const documentNumber = element(
            String(apis["document_number"] ?? ""),
            "document_number"
          );
          const nationality = element(
            String(apis["nationality"] ?? ""),
            "nationality"
          );
          const dob = documentDate(apis["date_of_birth"]);
          const expiry = documentDate(apis["expiry_date"]);
          const gender = String(apis["gender"] ?? "U").toUpperCase();
          if (!dob || !expiry || !["M", "F", "U"].includes(gender))
            throw new PnrgovFieldError("document_dates_or_gender");
          groupLines.push(
            `SSR+DOCS:HK:1:${sender}::::/${documentType}/${issuing}/${documentNumber}/${nationality}/${dob}/${gender}/${expiry}/${surname}/${given}'`
          );
        }
      }
      groupLines.push(
        `TVL+${departure.date}:${departure.time}:${arrival.date}:${arrival.time}+${origin}+${destination}+${sender}+${flightNumber}'`,
        `RPI+${passengers.length}+HK'`
      );
      lines.push(...groupLines);
    } catch (error) {
      if (error instanceof PnrgovFieldError) {
        for (const passenger of passengers)
          rejected.push({
            passengerId: passenger.passengerId,
            field: error.field,
          });
      } else throw error;
    }
  }
  if (rejected.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `PNRGOV draft rejected ${rejected.length} passenger record(s); transliterate or correct: ${rejected
        .map(item => `passenger ${item.passengerId} (${item.field})`)
        .join(", ")}`,
    });
  }

  const messageSegmentCount = lines.length - 3 + 1;
  lines.push(
    `UNT+${messageSegmentCount}+${control}'`,
    `UNE+1+${control}'`,
    `UNZ+1+${control}'`
  );
  return lines.join("\n");
}

export type AcknowledgmentDecision = {
  kind: "ACKRES" | "CONTRL";
  status: "received" | "acknowledged" | "rejected";
  responseCode: string;
  errorCodes: string[];
  commonAccessReference: string | null;
};

/** Parses the small ACK/NAK surface needed by the durable state machine. */
export function parseAuthorityAcknowledgment(
  content: string
): AcknowledgmentDecision {
  if (content.length > 100_000 || /[\0\r]/.test(content))
    throw new Error("Invalid authority response envelope");
  const segments = content
    .split("'")
    .map(segment => segment.trim())
    .filter(Boolean);
  const unh = segments.find(segment => segment.startsWith("UNH+"));
  const messageType = unh?.match(/\+(ACKRES|CONTRL):/)?.[1];
  if (!messageType) throw new Error("ACKRES or CONTRL response required");
  const errors = segments
    .filter(segment => segment.startsWith("ERC+"))
    .map(segment => segment.slice(4).split(/[+:]/)[0])
    .filter(Boolean);
  if (messageType === "CONTRL") {
    const uci = segments.find(segment => segment.startsWith("UCI+"));
    if (!uci) throw new Error("CONTRL response missing UCI");
    const code = uci.split("+").at(-1) ?? "";
    return {
      kind: "CONTRL",
      status: code === "7" ? "received" : "rejected",
      responseCode: code,
      errorCodes: errors,
      commonAccessReference: null,
    };
  }
  const msg = segments.find(segment => segment.startsWith("MSG+"));
  const fields = msg?.split("+") ?? [];
  if (fields[1]?.replace(/^:/, "") !== "23")
    throw new Error("ACKRES MSG function 23 required");
  const code = fields[2] ?? "";
  if (!["2", "3", "7", "8"].includes(code))
    throw new Error("Unsupported ACKRES response code");
  return {
    kind: "ACKRES",
    status:
      code === "3" ? "acknowledged" : code === "2" ? "received" : "rejected",
    responseCode: code,
    errorCodes: errors,
    commonAccessReference: unh?.split("+")[3] ?? null,
  };
}
