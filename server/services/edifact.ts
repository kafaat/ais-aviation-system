/**
 * UN/EDIFACT helpers shared by the government-message builders (PAXLST,
 * PNRGOV) and the acknowledgement parser (CUSRES/CONTRL).
 *
 * Character repertoire is UNOA (level A): upper-case letters, digits, space
 * and the characters . , - ( ) / = ' + : ? * . The service separators
 * + : ' and the release character ? are released with a leading "?" when they
 * appear inside data. Anything outside UNOA is refused rather than
 * transliterated, so a name is never silently changed on the way to an
 * authority. This module is owned by the APIS workstream; Type B and other
 * teletype formats keep their own helpers.
 */
import { zoneOffsetMs } from "./civil-day";

export const UNOA_UNSUPPORTED = /[^A-Za-z0-9 .,()=/+'?:*-]/;

export class EdifactFieldError extends Error {
  constructor(
    readonly field: string,
    message = "Field contains unsupported UNOA characters"
  ) {
    super(message);
  }
}

/** Upper-case and release the EDIFACT service characters in a UNOA value. */
export function releaseUnoa(value: string): string {
  return value.toUpperCase().replace(/[?+:'*]/g, "?$&");
}

/** Validate a value against UNOA and release the service characters. */
export function unoaElement(value: string, field = "field"): string {
  if (UNOA_UNSUPPORTED.test(value)) throw new EdifactFieldError(field);
  return releaseUnoa(value);
}

/** CCYYMMDD in UTC. */
export function edifactDate8(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

/** YYMMDD in UTC. */
export function edifactDate6(date: Date): string {
  return edifactDate8(date).slice(2);
}

/** HHMM in UTC. */
export function edifactTime(date: Date): string {
  return date.toISOString().slice(11, 16).replace(":", "");
}

/** Civil date/time components of an instant at an IANA zone. */
export function localCivil(instant: Date, zone: string) {
  const local = new Date(instant.getTime() + zoneOffsetMs(instant, zone));
  const iso = local.toISOString();
  return {
    ccyymmdd: iso.slice(0, 10).replaceAll("-", ""),
    yymmdd: iso.slice(2, 10).replaceAll("-", ""),
    ddmmyy: `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`,
    hhmm: iso.slice(11, 16).replace(":", ""),
    /** DDMMMYY as used in SSR free text (e.g. 12JUL64). */
    ddmmmyy: `${iso.slice(8, 10)}${MONTHS[Number(iso.slice(5, 7)) - 1]}${iso.slice(2, 4)}`,
  };
}

const MONTHS = [
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
];

/** DDMMMYY of a civil date string (YYYY-MM-DD) or Date in UTC. */
export function ddmmmyy(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) throw new EdifactFieldError("date");
  const iso = d.toISOString();
  return `${iso.slice(8, 10)}${MONTHS[Number(iso.slice(5, 7)) - 1]}${iso.slice(2, 4)}`;
}

/** A data element: a simple value or a composite of components. Values must
 * already be released; `undefined`/`null` leave the position empty. */
export type EdifactElement =
  | string
  | number
  | null
  | undefined
  | Array<string | number | null | undefined>;

/** Build one segment, trimming trailing empty elements and components. */
export function segment(tag: string, ...elements: EdifactElement[]): string {
  const rendered = elements.map(element => {
    if (Array.isArray(element)) {
      const parts = element.map(part => (part == null ? "" : String(part)));
      while (parts.length && parts[parts.length - 1] === "") parts.pop();
      return parts.join(":");
    }
    return element == null ? "" : String(element);
  });
  while (rendered.length && rendered[rendered.length - 1] === "")
    rendered.pop();
  return [tag, ...rendered].join("+") + "'";
}

export interface ParsedSegment {
  tag: string;
  /** elements[i][j] is component j of data element i, unreleased. */
  elements: string[][];
}

/** Split an interchange into segments, honouring the "?" release character.
 * Line breaks between segments are ignored. UNA service string advice is
 * accepted only with the default separators. */
export function parseEdifact(message: string): ParsedSegment[] {
  let text = message.replace(/\r?\n/g, "");
  if (text.startsWith("UNA")) {
    if (!text.startsWith("UNA:+.? '"))
      throw new Error("Only default UNA service characters are supported");
    text = text.slice(9);
  }
  const segments: ParsedSegment[] = [];
  let elements: string[][] = [[]];
  let current = "";
  let released = false;
  const closeComponent = () => {
    elements[elements.length - 1].push(current);
    current = "";
  };
  for (const char of text) {
    if (released) {
      current += char;
      released = false;
      continue;
    }
    if (char === "?") released = true;
    else if (char === ":") closeComponent();
    else if (char === "+") {
      closeComponent();
      elements.push([]);
    } else if (char === "'") {
      closeComponent();
      const [tagElement, ...rest] = elements;
      const tag = tagElement[0] ?? "";
      if (tag) segments.push({ tag, elements: rest });
      elements = [[]];
    } else current += char;
  }
  if (released || current || elements.length > 1 || elements[0].length)
    throw new Error("Unterminated EDIFACT segment");
  return segments;
}

/** First component of data element `index` (0-based after the tag). */
export function elementAt(
  seg: ParsedSegment,
  index: number,
  component = 0
): string | undefined {
  return seg.elements[index]?.[component];
}
