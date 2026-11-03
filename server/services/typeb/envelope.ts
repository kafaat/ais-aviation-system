/**
 * Type B addressing and message envelope.
 *
 * A Type B message is:
 *
 *   QU LHRKKBA LHRKPBA            priority code + up to 32 seven-character addresses
 *   .RUHKKXY 031205               origin address + DDHHMM (UTC)
 *   MVT                           text (the message body produced by a generator)
 *   ...
 *                                 trailer: blank line + signature line(s)
 *
 * Addresses are seven characters: three-letter city/airport, two-letter
 * department/function and two-character airline/company code (IATA Type B
 * whitepaper v2.5, "7-character ATA/IATA addressing"). The priority codes
 * accepted here are QU (urgent, the default for operational traffic) and QD
 * (deferred). Other codes exist on the network but this gateway refuses to
 * send them until the handler exchange confirms which ones the counterpart
 * accepts.
 *
 * ASSUMPTION (needs handler confirmation): the trailer repeats the origin
 * signature on two consecutive lines ("double signature") because several
 * legacy switches use it as the end-of-text marker. Both the presence and the
 * doubling of the signature are options so the station file can switch them off.
 */
import {
  MAX_LINE_LENGTH,
  MAX_MESSAGE_LENGTH,
  TYPEB_TEXT,
  assertLine,
  ddhhmm,
} from "./text";
import {
  TYPEB_MESSAGE_TYPES,
  TypeBFormatError,
  type TypeBMessageType,
} from "./model";

export const TYPEB_ADDRESS = /^[A-Z]{3}[A-Z]{2}[A-Z0-9]{2}$/;
export const TYPEB_PRIORITIES = ["QU", "QD"] as const;
export type TypeBPriority = (typeof TYPEB_PRIORITIES)[number];
/** Switch limit on destination addresses per message. */
export const MAX_ADDRESSES = 32;
/** Eight addresses per priority line keeps the line within 69 characters. */
const ADDRESSES_PER_LINE = 8;

export interface ParsedAddress {
  address: string;
  station: string;
  department: string;
  company: string;
}

export function parseAddress(value: string): ParsedAddress {
  const address = value.trim().toUpperCase();
  if (!TYPEB_ADDRESS.test(address))
    throw new TypeBFormatError(
      `Invalid Type B address (expected 7 characters CCCDDAA): ${value}`,
      "address"
    );
  return {
    address,
    station: address.slice(0, 3),
    department: address.slice(3, 5),
    company: address.slice(5, 7),
  };
}

export function isTypeBAddress(value: string): boolean {
  return TYPEB_ADDRESS.test(value);
}

export interface EnvelopeOptions {
  priority?: TypeBPriority;
  addresses: string[];
  origin: string;
  /** Date-time group for the origin line; defaults to now. */
  sentAt?: Date;
  /** Optional message identity line placed between origin line and text. */
  identity?: string;
  trailer?: { signature?: string; double?: boolean } | false;
}

export function buildHeader(options: EnvelopeOptions): string[] {
  const priority = options.priority ?? "QU";
  if (!TYPEB_PRIORITIES.includes(priority))
    throw new TypeBFormatError(
      `Unsupported priority code: ${priority}`,
      "priority"
    );
  const addresses = [
    ...new Set(options.addresses.map(a => parseAddress(a).address)),
  ];
  if (addresses.length === 0)
    throw new TypeBFormatError("At least one address is required", "address");
  if (addresses.length > MAX_ADDRESSES)
    throw new TypeBFormatError(
      `Too many addresses (${addresses.length} > ${MAX_ADDRESSES})`,
      "address"
    );
  const lines: string[] = [];
  for (let i = 0; i < addresses.length; i += ADDRESSES_PER_LINE)
    lines.push(
      `${priority} ${addresses.slice(i, i + ADDRESSES_PER_LINE).join(" ")}`
    );
  const origin = parseAddress(options.origin).address;
  lines.push(`.${origin} ${ddhhmm(options.sentAt ?? new Date())}`);
  if (options.identity)
    lines.push(assertLine(options.identity, 32, "identity"));
  return lines;
}

export function buildTrailer(
  options: EnvelopeOptions,
  defaultSignature: string
): string[] {
  if (options.trailer === false) return [];
  const signature = (options.trailer?.signature ?? defaultSignature)
    .toUpperCase()
    .trim();
  if (!signature) return [];
  assertLine(signature, MAX_LINE_LENGTH, "signature");
  const double = options.trailer?.double ?? true;
  return ["", signature, ...(double ? [signature] : [])];
}

/** Header + text + trailer as lines; throws if the message would exceed the switch limit. */
export function composeMessage(
  options: EnvelopeOptions,
  textLines: string[]
): string[] {
  if (textLines.length === 0)
    throw new TypeBFormatError("Message text is empty");
  for (const line of textLines) assertLine(line);
  const header = buildHeader(options);
  const trailer = buildTrailer(options, parseAddress(options.origin).address);
  const lines = [...header, ...textLines, ...trailer];
  const length = lines.join("\r\n").length;
  if (length > MAX_MESSAGE_LENGTH)
    throw new TypeBFormatError(
      `Message exceeds ${MAX_MESSAGE_LENGTH} characters (${length}); split into parts`
    );
  return lines;
}

/** Render lines with the teletype line ending (CR LF). */
export function renderMessage(lines: string[], eol: "\r\n" | "\n" = "\r\n") {
  return lines.join(eol) + eol;
}

export interface ParsedEnvelope {
  header: {
    priority: string;
    addresses: string[];
    origin: string;
    /** DDHHMM as transmitted; null when the origin line carries no date-time group. */
    dateTime: string | null;
    identity: string | null;
  } | null;
  type: TypeBMessageType;
  /** Text lines from the message-type line to the end of text (trailer removed). */
  textLines: string[];
  /** Trailer lines after the text, if any (signatures). */
  trailerLines: string[];
}

/** Normalise line endings, strip transport framing and trailing whitespace. */
export function splitLines(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/^﻿/, "")
    .split("\n")
    .map(line => line.replace(/\s+$/, ""))
    .filter((line, i, all) => !(i === all.length - 1 && line === ""));
}

export function detectMessageType(line: string): TypeBMessageType | null {
  const token = line.trim().split(/\s+/)[0];
  return (TYPEB_MESSAGE_TYPES as readonly string[]).includes(token)
    ? (token as TypeBMessageType)
    : null;
}

/**
 * Parse an inbound message into header, text and trailer. Messages received
 * without a header (e.g. pasted text) are accepted when the first line is a
 * known message type.
 */
export function parseEnvelope(raw: string): ParsedEnvelope {
  const lines = splitLines(raw).filter(
    (line, i) => !(i === 0 && /^ZCZC/.test(line))
  );
  let i = 0;
  while (i < lines.length && lines[i] === "") i += 1;
  if (i >= lines.length) throw new TypeBFormatError("Empty message");
  let header: ParsedEnvelope["header"] = null;
  const priorityMatch = /^([A-Z]{2})((?:\s+[A-Z0-9]{7})+)$/.exec(lines[i]);
  if (priorityMatch) {
    const priority = priorityMatch[1];
    const addresses: string[] = [];
    while (i < lines.length) {
      const m = new RegExp(`^${priority}((?:\\s+[A-Z0-9]{7})+)$`).exec(
        lines[i]
      );
      if (!m) break;
      for (const address of m[1].trim().split(/\s+/))
        addresses.push(parseAddress(address).address);
      i += 1;
    }
    const originLine = /^\.([A-Z0-9]{7})(?:\s+(\d{6}))?$/.exec(lines[i] ?? "");
    if (!originLine)
      throw new TypeBFormatError(
        "Origin line (.ADDRESS DDHHMM) missing after addresses",
        "origin"
      );
    i += 1;
    let identity: string | null = null;
    if (i < lines.length && lines[i] !== "" && !detectMessageType(lines[i])) {
      identity = lines[i];
      i += 1;
    }
    header = {
      priority,
      addresses,
      origin: parseAddress(originLine[1]).address,
      dateTime: originLine[2] ?? null,
      identity,
    };
  }
  while (i < lines.length && lines[i] === "") i += 1;
  const type = i < lines.length ? detectMessageType(lines[i]) : null;
  if (!type)
    throw new TypeBFormatError(
      `Unrecognised message type: ${lines[i] ?? "(none)"}`,
      "type"
    );
  const body = lines.slice(i).filter(line => !/^NNNN$/.test(line));
  // Trailer: everything after the last blank line when the text does not end
  // with an END marker that itself follows the blank line.
  let textEnd = body.length;
  const lastBlank = body.lastIndexOf("");
  if (lastBlank > 0 && lastBlank < body.length - 1) {
    const tail = body.slice(lastBlank + 1);
    if (tail.every(line => /^[A-Z0-9]{7}$/.test(line) || line === ""))
      textEnd = lastBlank;
  }
  const textLines = body.slice(0, textEnd).filter(line => line !== "");
  for (const line of textLines)
    if (!TYPEB_TEXT.test(line))
      throw new TypeBFormatError(
        `Text contains characters outside the Type B set: ${line}`
      );
  return {
    header,
    type,
    textLines,
    trailerLines: body.slice(textEnd).filter(line => line !== ""),
  };
}
