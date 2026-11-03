import { TRPCError } from "@trpc/server";
import { randomBytes } from "node:crypto";
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
  const control = randomBytes(7).toString("hex").toUpperCase();
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
  kind: "ACKRES" | "CONTRL" | "CUSRES";
  status: "received" | "acknowledged" | "rejected";
  responseCode: string;
  errorCodes: string[];
  commonAccessReference: string | null;
};

type Segment = { tag: string; fields: string[][] };

// Interpret releases while tokenizing so an apostrophe in a name or FTX
// cannot introduce a new segment. Only the local default UNA profile is supported.
function ediSegments(content: string, maxBytes: number): Segment[] {
  if (content.length > maxBytes || /[^\x20-\x7e\r\n]/.test(content))
    throw new Error("Invalid authority message envelope");
  const body = content.replace(/^UNA:\+\.\?[ *]'/, "");
  const segments: Segment[] = [];
  let fields: string[][] = [[]];
  let token = "";
  let escaped = false;
  for (const c of body) {
    if (c === "\r" || c === "\n") {
      if (escaped || token || fields.length !== 1 || fields[0].length)
        throw new Error("Unexpected line break inside EDIFACT segment");
      continue;
    }
    if (escaped) {
      token += c;
      escaped = false;
    } else if (c === "?") escaped = true;
    else if (c === "+" || c === ":" || c === "'") {
      fields[fields.length - 1].push(token);
      token = "";
      if (c === "+") fields.push([]);
      if (c === "'") {
        const [tag, ...rest] = fields;
        if (tag.length !== 1 || !/^[A-Z]{3}$/.test(tag[0]))
          throw new Error("Invalid EDIFACT segment tag");
        segments.push({ tag: tag[0], fields: rest });
        fields = [[]];
      }
    } else token += c;
  }
  if (escaped || token || fields.length !== 1 || fields[0].length)
    throw new Error("Unterminated EDIFACT segment");
  return segments;
}

function single(segments: Segment[], tag: string) {
  const matches = segments.filter(s => s.tag === tag);
  if (matches.length !== 1) throw new Error(`Exactly one ${tag} required`);
  return matches[0];
}

function field(segment: Segment, index: number) {
  return segment.fields[index]?.[0] ?? "";
}

function transactionRef(segments: Segment[]) {
  const refs = segments.filter(s => s.tag === "RFF" && field(s, 0) === "TN");
  if (refs.length !== 1 || !refs[0].fields[0][1])
    throw new Error("One transaction reference required");
  return refs[0].fields[0].slice(1);
}

/** With a durable outbound message supplied, require the authority to quote this
 * specific transmission and reverse its sender and recipient in the reply. */
export function parseAuthorityAcknowledgment(
  content: string,
  outbound?: { messageType: string; messageContent: string }
): AcknowledgmentDecision {
  const segments = ediSegments(content, 100_000);
  const unh = single(segments, "UNH");
  const unt = single(segments, "UNT");
  const first = segments.indexOf(unh),
    last = segments.indexOf(unt);
  if (
    !field(unh, 0) ||
    field(unt, 1) !== field(unh, 0) ||
    field(unt, 0) !== String(last - first + 1)
  )
    throw new Error("Invalid authority message trailer");
  const body = segments.slice(first + 1, last);
  const kind = field(unh, 1);
  if (!["ACKRES", "CONTRL", "CUSRES"].includes(kind))
    throw new Error("Unsupported authority response type");
  const uci = kind === "CONTRL" ? single(body, "UCI") : undefined;
  const tn = kind === "CUSRES" ? transactionRef(body) : undefined;
  const reference = uci ? field(uci, 0) : tn ? tn[0] : field(unh, 2);
  if (!reference) throw new Error("Missing original transmission reference");
  if (outbound) {
    const sent = ediSegments(outbound.messageContent, 2_000_000);
    const unb = single(sent, "UNB"),
      original = single(sent, "UNH"),
      reply = single(segments, "UNB");
    const replyTrailer = single(segments, "UNZ");
    if (
      segments[0] !== reply ||
      segments.at(-1) !== replyTrailer ||
      !field(reply, 4) ||
      field(replyTrailer, 1) !== field(reply, 4) ||
      field(replyTrailer, 0) !== "1"
    )
      throw new Error("Invalid authority interchange trailer");
    if (
      !["PAXLST", "PNRGOV"].includes(outbound.messageType) ||
      field(original, 1) !== outbound.messageType ||
      !field(unb, 1) ||
      !field(unb, 2) ||
      JSON.stringify(unb.fields[1]) !== JSON.stringify(reply.fields[2]) ||
      JSON.stringify(unb.fields[2]) !== JSON.stringify(reply.fields[1])
    )
      throw new Error("Authority response does not match outbound envelope");
    const expected = uci
      ? field(unb, 4)
      : tn
        ? transactionRef(sent)[0]
        : field(original, 2);
    if (
      !expected ||
      reference !== expected ||
      (uci &&
        (JSON.stringify(uci.fields[1]) !== JSON.stringify(unb.fields[1]) ||
          JSON.stringify(uci.fields[2]) !== JSON.stringify(unb.fields[2]))) ||
      (tn &&
        (outbound.messageType !== "PAXLST" ||
          JSON.stringify(tn) !== JSON.stringify(transactionRef(sent)))) ||
      (kind === "ACKRES" && outbound.messageType !== "PNRGOV")
    )
      throw new Error(
        "Authority response reference does not match original transmission"
      );
  }
  if (uci) {
    const details = body.filter(s => s.tag === "UCM");
    if (
      details.length > 1 ||
      body.some(s => s.tag === "UCF" || s.tag === "UCS" || s.tag === "UCD")
    )
      throw new Error("Unsupported CONTRL detail profile");
    const detail = details[0];
    if (detail && outbound) {
      const original = single(
        ediSegments(outbound.messageContent, 2_000_000),
        "UNH"
      );
      if (
        field(detail, 0) !== field(original, 0) ||
        JSON.stringify(detail.fields[1]) !== JSON.stringify(original.fields[1])
      )
        throw new Error(
          "CONTRL message reference does not match original transmission"
        );
    }
    const code = field(uci, 3);
    if (!["4", "7", "8"].includes(code))
      throw new Error("Unsupported CONTRL action");
    if (detail && !["4", "7"].includes(field(detail, 2)))
      throw new Error("Unsupported CONTRL message action");
    const rejected = code === "4" || (detail && field(detail, 2) === "4");
    const errors = [field(uci, 4), detail && field(detail, 3)].filter(
      (v): v is string => Boolean(v)
    );
    if (errors.some(e => !/^[A-Z0-9]{1,3}$/.test(e)))
      throw new Error("Invalid CONTRL error code");
    return {
      kind: "CONTRL",
      status: rejected ? "rejected" : "received",
      responseCode: rejected ? "4" : code,
      errorCodes: errors,
      commonAccessReference: reference,
    };
  }
  if (kind === "CUSRES") {
    // IATA MIG section 5.7: a header-level ERC+ACK means receipt only.
    // Passenger-level boarding instructions require a bilateral profile.
    const code = field(single(body, "ERC"), 0);
    if (
      field(single(body, "BGM"), 0) !== "962" ||
      field(single(body, "ERP"), 0) !== "1" ||
      !["ACK", "X"].includes(code)
    )
      throw new Error("Unsupported CUSRES header response");
    return {
      kind,
      status: code === "ACK" ? "received" : "rejected",
      responseCode: code,
      errorCodes: code === "ACK" ? [] : [code],
      commonAccessReference: reference,
    };
  }
  const msg = single(body, "MSG");
  if (!["23", ":23"].includes(msg.fields[0]?.join(":")))
    throw new Error("ACKRES MSG function 23 required");
  const code = field(msg, 1);
  if (!["2", "3", "7", "8"].includes(code))
    throw new Error("Unsupported ACKRES response code");
  const errors = body.filter(s => s.tag === "ERC").map(s => field(s, 0));
  if (errors.some(e => !/^[A-Z0-9_-]{1,16}$/.test(e)))
    throw new Error("Invalid ACKRES error code");
  return {
    kind: "ACKRES",
    status:
      code === "3" ? "acknowledged" : code === "2" ? "received" : "rejected",
    responseCode: code,
    errorCodes: errors,
    commonAccessReference: reference,
  };
}
