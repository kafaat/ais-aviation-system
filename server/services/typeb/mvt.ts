/**
 * MVT — Aircraft Movement Message (IATA AHM 780).
 *
 *   MVT
 *   XY123/03.HZASA.RUH            flight/day . registration . reporting station
 *   AD1205/1218 EA1405 JED        actual departure: off-blocks/airborne, ETA, destination
 *   DL89/41/0015/0010             delay codes then one HHMM duration per code
 *   PX180                         passengers (or PX8/172 per class)
 *   SI DELAYED INBOUND AIRCRAFT   supplementary information (free text)
 *
 *   AA1358/1406                   actual arrival: touchdown/on-blocks
 *   ED1230                        new estimated time of departure
 *   NI1300                        next information at
 *
 * All times are UTC HHMM; the day comes from the flight line. Public
 * references: KIU "MAN_Movement Message" documentation and the Python
 * mvt-parser field list (both cited in the research notes).
 *
 * ASSUMPTION flagged for the handler exchange: when only one of the two AD/AA
 * times is known the single time is transmitted alone (AD1205) and the SI
 * section says which time it is. Some handlers require both.
 */
import {
  TypeBFormatError,
  type DelayElement,
  type MvtMovement,
  type MvtPayload,
} from "./model";
import {
  assertLine,
  assertStation,
  atUtcTime,
  dd,
  durationHhmm,
  flightCode,
  foldText,
  hhmm,
  normalizeRegistration,
  parseFlightCode,
  parseHhmm,
} from "./text";

const DELAY_CODE = /^[0-9A-Z]{2}$/;

export function formatDelays(delays: DelayElement[]): string {
  if (!delays.length)
    throw new TypeBFormatError("DL requires a delay code", "DL");
  if (delays.length > 4)
    throw new TypeBFormatError("DL carries at most four delay codes", "DL");
  for (const d of delays)
    if (!DELAY_CODE.test(d.code.toUpperCase()))
      throw new TypeBFormatError(`Invalid delay code ${d.code}`, "DL");
  return `DL${delays.map(d => d.code.toUpperCase()).join("/")}/${delays
    .map(d => durationHhmm(d.minutes))
    .join("/")}`;
}

function movementLines(m: MvtMovement): string[] {
  const lines: string[] = [];
  switch (m.kind) {
    case "AD": {
      let line = `AD${hhmm(m.offBlocks)}`;
      if (m.airborne) line += `/${hhmm(m.airborne)}`;
      if (m.estimatedArrival) line += ` EA${hhmm(m.estimatedArrival)}`;
      line += ` ${assertStation(m.destination, "destination")}`;
      lines.push(line);
      if (m.delays?.length) lines.push(formatDelays(m.delays));
      if (m.passengers) {
        const px =
          "total" in m.passengers ? [m.passengers.total] : m.passengers.byClass;
        if (!px.length || px.some(n => !Number.isInteger(n) || n < 0))
          throw new TypeBFormatError("Invalid passenger figures", "PX");
        lines.push(`PX${px.join("/")}`);
      }
      break;
    }
    case "AA": {
      lines.push(
        m.touchdown
          ? `AA${hhmm(m.touchdown)}/${hhmm(m.onBlocks)}`
          : `AA${hhmm(m.onBlocks)}`
      );
      break;
    }
    case "ED": {
      lines.push(`ED${hhmm(m.estimatedDeparture)}`);
      if (m.delays?.length) lines.push(formatDelays(m.delays));
      break;
    }
    case "NI": {
      lines.push(`NI${hhmm(m.nextInformation)}`);
      break;
    }
  }
  return lines;
}

export function generateMvt(payload: MvtPayload): string[] {
  if (payload.type !== "MVT")
    throw new TypeBFormatError("Payload is not an MVT");
  const lines = [
    "MVT",
    `${flightCode(payload.flight)}/${dd(payload.date)}.${normalizeRegistration(payload.registration)}.${assertStation(payload.station)}`,
    ...movementLines(payload.movement),
  ];
  const remarks = (payload.remarks ?? []).flatMap(r => foldText(r, 66));
  if (remarks.length) {
    lines.push(`SI ${remarks[0]}`);
    lines.push(...remarks.slice(1));
  }
  return lines.map(line => assertLine(line, 69, "MVT"));
}

export interface ParsedMvt {
  type: "MVT";
  flight: { carrier: string; number: string; suffix?: string };
  day: number;
  registration: string;
  station: string;
  departure?: {
    offBlocks: string;
    airborne: string | null;
    estimatedArrival: string | null;
    destination: string | null;
  };
  arrival?: { touchdown: string | null; onBlocks: string };
  estimatedDeparture?: string;
  nextInformation?: string;
  delays: DelayElement[];
  passengers: number[] | null;
  remarks: string[];
  /** Resolved UTC instants when a reference month is known. */
  times?: Record<string, string>;
}

export function parseDelays(line: string): DelayElement[] {
  const tokens = line.slice(2).split("/");
  const codes = tokens.filter(
    t => /^[0-9A-Z]{2}$/.test(t) && !/^\d{4}$/.test(t)
  );
  const durations = tokens.filter(t => /^\d{4}$/.test(t));
  if (
    !codes.length ||
    codes.length !== durations.length ||
    codes.length + durations.length !== tokens.length
  )
    throw new TypeBFormatError(`Invalid delay element: ${line}`, "DL");
  return codes.map((code, i) => {
    const d = durations[i];
    return { code, minutes: Number(d.slice(0, 2)) * 60 + Number(d.slice(2)) };
  });
}

/** Parse MVT text lines (without envelope). */
export function parseMvt(lines: string[], reference?: Date): ParsedMvt {
  const text = lines.map(l => l.trim()).filter(Boolean);
  if (text[0] !== "MVT") throw new TypeBFormatError("Not an MVT", "type");
  const flight =
    /^([A-Z0-9]{2,3}\d{1,4}[A-Z]?)\/(\d{2})\.([A-Z0-9]{3,8})\.([A-Z]{3})$/.exec(
      text[1] ?? ""
    );
  if (!flight)
    throw new TypeBFormatError(`Invalid MVT flight line: ${text[1]}`, "flight");
  const result: ParsedMvt = {
    type: "MVT",
    flight: parseFlightCode(flight[1]),
    day: Number(flight[2]),
    registration: flight[3],
    station: flight[4],
    delays: [],
    passengers: null,
    remarks: [],
  };
  const time = (value: string) => {
    parseHhmm(value);
    return value;
  };
  let i = 2;
  for (; i < text.length; i += 1) {
    const line = text[i];
    let m: RegExpExecArray | null;
    if (
      (m = /^AD(\d{4})(?:\/(\d{4}))?(?:\s+EA(\d{4}))?(?:\s+([A-Z]{3}))?$/.exec(
        line
      ))
    ) {
      result.departure = {
        offBlocks: time(m[1]),
        airborne: m[2] ? time(m[2]) : null,
        estimatedArrival: m[3] ? time(m[3]) : null,
        destination: m[4] ?? null,
      };
    } else if ((m = /^AA(\d{4})(?:\/(\d{4}))?$/.exec(line))) {
      result.arrival = m[2]
        ? { touchdown: time(m[1]), onBlocks: time(m[2]) }
        : { touchdown: null, onBlocks: time(m[1]) };
    } else if ((m = /^ED(\d{4})$/.exec(line))) {
      result.estimatedDeparture = time(m[1]);
    } else if ((m = /^NI(\d{4})$/.exec(line))) {
      result.nextInformation = time(m[1]);
    } else if (/^DL/.test(line)) {
      result.delays = parseDelays(line);
    } else if ((m = /^PX\s?(\d{1,3}(?:\/\d{1,3})*)$/.exec(line))) {
      result.passengers = m[1].split("/").map(Number);
    } else if ((m = /^SI\s?(.*)$/.exec(line))) {
      if (m[1]) result.remarks.push(m[1]);
      result.remarks.push(...text.slice(i + 1));
      break;
    } else {
      throw new TypeBFormatError(`Unknown MVT element: ${line}`, line);
    }
  }
  if (
    !result.departure &&
    !result.arrival &&
    !result.estimatedDeparture &&
    !result.nextInformation
  )
    throw new TypeBFormatError("MVT carries no movement element", "movement");
  if (reference) {
    const day = new Date(
      Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), result.day)
    );
    const times: Record<string, string> = {};
    const put = (key: string, value: string | null | undefined) => {
      if (value) times[key] = atUtcTime(day, value).toISOString();
    };
    put("offBlocks", result.departure?.offBlocks);
    put("airborne", result.departure?.airborne);
    put("estimatedArrival", result.departure?.estimatedArrival);
    put("touchdown", result.arrival?.touchdown);
    put("onBlocks", result.arrival?.onBlocks);
    put("estimatedDeparture", result.estimatedDeparture);
    put("nextInformation", result.nextInformation);
    result.times = times;
  }
  return result;
}
