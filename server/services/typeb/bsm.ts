/**
 * BSM — Baggage Source Message and BPM — Baggage Processed Message
 * (IATA RP 1745, the Type B baggage messaging that BIX/RP 1755 replaces).
 *
 *   BSM
 *   CHG                       optional: CHG or DEL updates an earlier BSM
 *   .V/1LRUH                  version: 1 + processing indicator (L local, T transfer) + station
 *   .F/XY0123/03NOV/JED/Y     outbound flight, date, destination, class
 *   .N/0065123456001          10-digit licence plate + 3-digit consecutive count
 *   .S/Y/14A/C/074            passenger status: checked-in, seat, class, sequence
 *   .P/SMITH/JOHN             passenger name
 *   .L/ABC123                 record locator
 *   .W/K/1/23                 weight: unit, pieces, total
 *   .O/XY0456/03NOV/DXB/Y     onward flight
 *   .I/XY0789/03NOV/DMM/Y     inbound flight (transfer bags)
 *   ENDBSM
 *
 *   BPM
 *   .V/1LRUH
 *   .J/L/1015/RUH             processing: indicator, HHMM, location[/device]
 *   .F/XY0123/03NOV/JED
 *   .N/0065123456001
 *   ENDBPM
 *
 * Licence plates are the ten-digit IATA Res. 740 form (leading digit, 3-digit
 * airline accounting code, 6-digit serial). Tags in another form are rejected
 * rather than padded, because the sortation system keys on the plate.
 *
 * ASSUMPTIONS flagged for the handler exchange: the field order inside .S/
 * and the .J/ indicator vocabulary (S scanned, L loaded, U unloaded, R
 * reconciled) follow public examples, not the licensed RP text.
 */
import {
  TypeBFormatError,
  type BaggageFlightElement,
  type BpmPayload,
  type BsmPayload,
  type LicensePlate,
} from "./model";
import {
  assertLine,
  assertStation,
  ddmmm,
  hhmm,
  nameLetters,
  paddedFlightCode,
  parseDdmmm,
  parseFlightCode,
  parseHhmm,
} from "./text";

export const LICENSE_PLATE = /^\d{10}$/;

export function assertLicensePlate(plate: string): string {
  if (!LICENSE_PLATE.test(plate))
    throw new TypeBFormatError(
      `Licence plate must be 10 digits (IATA Res. 740): ${plate}`,
      ".N/"
    );
  return plate;
}

/** Build a licence plate from the airline accounting code and a serial. */
export function buildLicensePlate(
  airlineAccountingCode: string,
  serial: number,
  leadingDigit = 0
): string {
  if (!/^\d{3}$/.test(airlineAccountingCode))
    throw new TypeBFormatError("Airline accounting code must be 3 digits");
  if (!Number.isInteger(serial) || serial < 0 || serial > 999999)
    throw new TypeBFormatError("Serial must be 0-999999");
  if (!Number.isInteger(leadingDigit) || leadingDigit < 0 || leadingDigit > 9)
    throw new TypeBFormatError("Leading digit must be 0-9");
  return `${leadingDigit}${airlineAccountingCode}${String(serial).padStart(6, "0")}`;
}

function plateElement(p: LicensePlate): string {
  const count = p.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 999)
    throw new TypeBFormatError(`Invalid tag count ${count}`, ".N/");
  return `.N/${assertLicensePlate(p.plate)}${String(count).padStart(3, "0")}`;
}

function flightElement(prefix: string, f: BaggageFlightElement): string {
  const parts = [
    paddedFlightCode(f.flight),
    ddmmm(f.date),
    assertStation(f.station, prefix),
  ];
  if (f.classCode) {
    const code = f.classCode.toUpperCase();
    if (!/^[A-Z]$/.test(code))
      throw new TypeBFormatError(`Invalid class code ${f.classCode}`, prefix);
    parts.push(code);
  }
  return `${prefix}${parts.join("/")}`;
}

function versionElement(v: { indicator: "L" | "T"; station: string }): string {
  return `.V/1${v.indicator}${assertStation(v.station, ".V/")}`;
}

function nameElement(p: { surname: string; givenNames?: string }): string {
  const given = p.givenNames ? `/${nameLetters(p.givenNames)}` : "";
  return `.P/${nameLetters(p.surname)}${given}`;
}

export function generateBsm(payload: BsmPayload): string[] {
  if (payload.type !== "BSM")
    throw new TypeBFormatError("Payload is not a BSM");
  if (!payload.licensePlates.length)
    throw new TypeBFormatError(
      "BSM requires at least one licence plate",
      ".N/"
    );
  const lines = ["BSM"];
  if (payload.action) lines.push(payload.action);
  lines.push(versionElement(payload.version));
  lines.push(flightElement(".F/", payload.outbound));
  for (const plate of payload.licensePlates) lines.push(plateElement(plate));
  if (payload.passengerStatus) {
    const s = payload.passengerStatus;
    const fields = [s.checkedIn ? "Y" : "N"];
    if (s.seat) {
      if (!/^\d{1,3}[A-K]$/.test(s.seat.toUpperCase()))
        throw new TypeBFormatError(`Invalid seat ${s.seat}`, ".S/");
      fields.push(s.seat.toUpperCase());
    }
    if (s.cabinClass) {
      if (!/^[A-Z]$/.test(s.cabinClass.toUpperCase()))
        throw new TypeBFormatError(`Invalid class ${s.cabinClass}`, ".S/");
      fields.push(s.cabinClass.toUpperCase());
    }
    if (s.sequence !== undefined) {
      if (!Number.isInteger(s.sequence) || s.sequence < 1 || s.sequence > 999)
        throw new TypeBFormatError(`Invalid sequence ${s.sequence}`, ".S/");
      fields.push(String(s.sequence).padStart(3, "0"));
    }
    lines.push(`.S/${fields.join("/")}`);
  }
  if (payload.passenger) lines.push(nameElement(payload.passenger));
  if (payload.locator) {
    const loc = payload.locator.toUpperCase();
    if (!/^[A-Z0-9]{5,6}$/.test(loc))
      throw new TypeBFormatError(`Invalid locator ${payload.locator}`, ".L/");
    lines.push(`.L/${loc}`);
  }
  if (payload.baggage) {
    const b = payload.baggage;
    if (
      !Number.isInteger(b.pieces) ||
      b.pieces < 1 ||
      !Number.isInteger(b.weight) ||
      b.weight < 0
    )
      throw new TypeBFormatError("Invalid baggage pieces/weight", ".W/");
    lines.push(`.W/${b.unit}/${b.pieces}/${b.weight}`);
  }
  if (payload.onward) lines.push(flightElement(".O/", payload.onward));
  if (payload.inbound) lines.push(flightElement(".I/", payload.inbound));
  lines.push("ENDBSM");
  return lines.map(line => assertLine(line, 69, "BSM"));
}

export function generateBpm(payload: BpmPayload): string[] {
  if (payload.type !== "BPM")
    throw new TypeBFormatError("Payload is not a BPM");
  if (!payload.licensePlates.length)
    throw new TypeBFormatError(
      "BPM requires at least one licence plate",
      ".N/"
    );
  const p = payload.processing;
  if (!/^[SLUR]$/.test(p.indicator))
    throw new TypeBFormatError(
      `Invalid processing indicator ${p.indicator}`,
      ".J/"
    );
  const location = p.location.toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/.test(location))
    throw new TypeBFormatError(
      `Invalid processing location ${p.location}`,
      ".J/"
    );
  const device = p.device ? `/${p.device.toUpperCase()}` : "";
  if (device && !/^\/[A-Z0-9]{1,10}$/.test(device))
    throw new TypeBFormatError(`Invalid device ${p.device}`, ".J/");
  const lines = [
    "BPM",
    versionElement(payload.version),
    `.J/${p.indicator}/${hhmm(p.time)}/${location}${device}`,
    flightElement(".F/", payload.outbound),
    ...payload.licensePlates.map(plateElement),
  ];
  if (payload.passenger) lines.push(nameElement(payload.passenger));
  lines.push("ENDBPM");
  return lines.map(line => assertLine(line, 69, "BPM"));
}

export interface ParsedBaggageFlight {
  flight: { carrier: string; number: string; suffix?: string };
  date: string;
  dateIso: string;
  station: string;
  classCode: string | null;
}

export interface ParsedBsm {
  type: "BSM" | "BPM";
  action: "ADD" | "CHG" | "DEL";
  version: { indicator: string; station: string } | null;
  outbound: ParsedBaggageFlight | null;
  licensePlates: Array<{ plate: string; count: number }>;
  passengerStatus: {
    checkedIn: boolean;
    seat: string | null;
    cabinClass: string | null;
    sequence: number | null;
  } | null;
  passenger: { surname: string; givenNames: string | null } | null;
  locator: string | null;
  baggage: { unit: string; pieces: number; weight: number } | null;
  onward: ParsedBaggageFlight | null;
  inbound: ParsedBaggageFlight | null;
  processing: {
    indicator: string;
    time: string;
    location: string;
    device: string | null;
  } | null;
  unknownElements: string[];
}

function parseFlightElement(
  value: string,
  reference: Date
): ParsedBaggageFlight {
  const parts = value.split("/");
  if (parts.length < 3 || parts.length > 4)
    throw new TypeBFormatError(`Invalid flight element ${value}`, ".F/");
  const date = parseDdmmm(parts[1], reference);
  return {
    flight: parseFlightCode(parts[0]),
    date: parts[1],
    dateIso: date.toISOString().slice(0, 10),
    station: assertStation(parts[2], ".F/"),
    classCode: parts[3] ?? null,
  };
}

/** Parse BSM or BPM text lines (without envelope). */
export function parseBsm(lines: string[], reference = new Date()): ParsedBsm {
  const text = lines.map(l => l.trim()).filter(Boolean);
  const type = text[0];
  if (type !== "BSM" && type !== "BPM")
    throw new TypeBFormatError("Not a BSM/BPM", "type");
  const end = text.at(-1);
  if (end !== `END${type}`)
    throw new TypeBFormatError(`${type} must end with END${type}`, "END");
  const result: ParsedBsm = {
    type,
    action: "ADD",
    version: null,
    outbound: null,
    licensePlates: [],
    passengerStatus: null,
    passenger: null,
    locator: null,
    baggage: null,
    onward: null,
    inbound: null,
    processing: null,
    unknownElements: [],
  };
  for (const line of text.slice(1, -1)) {
    if (line === "CHG" || line === "DEL") {
      result.action = line;
      continue;
    }
    const prefix = line.slice(0, 3);
    const value = line.slice(3);
    let m: RegExpExecArray | null;
    switch (prefix) {
      case ".V/":
        if (!(m = /^1([LT])([A-Z]{3})$/.exec(value)))
          throw new TypeBFormatError(`Invalid version element ${line}`, ".V/");
        result.version = { indicator: m[1], station: m[2] };
        break;
      case ".F/":
        result.outbound = parseFlightElement(value, reference);
        break;
      case ".O/":
        result.onward = parseFlightElement(value, reference);
        break;
      case ".I/":
        result.inbound = parseFlightElement(value, reference);
        break;
      case ".N/":
        if (!(m = /^(\d{10})(\d{3})$/.exec(value)))
          throw new TypeBFormatError(
            `Invalid licence plate element ${line}`,
            ".N/"
          );
        result.licensePlates.push({ plate: m[1], count: Number(m[2]) });
        break;
      case ".S/": {
        const fields = value.split("/");
        if (!/^[YN]$/.test(fields[0] ?? ""))
          throw new TypeBFormatError(`Invalid status element ${line}`, ".S/");
        const rest = fields.slice(1);
        const seat = rest.find(f => /^\d{1,3}[A-K]$/.test(f)) ?? null;
        const cabinClass = rest.find(f => /^[A-Z]$/.test(f)) ?? null;
        const sequence = rest.find(f => /^\d{3}$/.test(f));
        result.passengerStatus = {
          checkedIn: fields[0] === "Y",
          seat,
          cabinClass,
          sequence: sequence ? Number(sequence) : null,
        };
        break;
      }
      case ".P/": {
        const [surname, given] = value.split("/");
        if (!surname || !/^[A-Z]+$/.test(surname))
          throw new TypeBFormatError(`Invalid name element ${line}`, ".P/");
        result.passenger = { surname, givenNames: given ?? null };
        break;
      }
      case ".L/":
        if (!/^[A-Z0-9]{5,6}$/.test(value))
          throw new TypeBFormatError(`Invalid locator element ${line}`, ".L/");
        result.locator = value;
        break;
      case ".W/":
        if (!(m = /^([KL])\/(\d{1,3})\/(\d{1,4})$/.exec(value)))
          throw new TypeBFormatError(`Invalid weight element ${line}`, ".W/");
        result.baggage = {
          unit: m[1],
          pieces: Number(m[2]),
          weight: Number(m[3]),
        };
        break;
      case ".J/":
        if (
          !(m =
            /^([A-Z])\/(\d{4})\/([A-Z0-9]{3,8})(?:\/([A-Z0-9]{1,10}))?$/.exec(
              value
            ))
        )
          throw new TypeBFormatError(
            `Invalid processing element ${line}`,
            ".J/"
          );
        parseHhmm(m[2]);
        result.processing = {
          indicator: m[1],
          time: m[2],
          location: m[3],
          device: m[4] ?? null,
        };
        break;
      default:
        if (!/^\.[A-Z]{1,2}\//.test(line))
          throw new TypeBFormatError(`Invalid ${type} element ${line}`, line);
        result.unknownElements.push(line);
    }
  }
  if (!result.licensePlates.length)
    throw new TypeBFormatError(`${type} carries no licence plate`, ".N/");
  if (type === "BPM" && !result.processing)
    throw new TypeBFormatError("BPM lacks a .J/ processing element", ".J/");
  return result;
}
