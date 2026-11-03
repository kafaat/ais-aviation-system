/**
 * LDM — Load Message (IATA AHM 583).
 *
 *   LDM
 *   XY123/03.HZASA.C14Y165.4/12              flight/day . registration . version . crew (cockpit/cabin[/extra])
 *   -JED.102/5/2.T2850.1/1200.3/1650.PAX/8/94.PAD/0/0
 *   SI
 *   TOTAL LOAD 2850 KG
 *   UNDERLOAD BEFORE LMC 1250 KG
 *   JED BAG 120/1400 KG CARGO 1250 KG MAIL 200 KG
 *
 * Destination line elements, separated by ".":
 *   -DEST            arrival station
 *   A/C/I or M/F/C/I passengers (adults/children/infants, or males/females/children/infants)
 *   Tnnnn            total deadload for the destination (kg)
 *   n/nnnn           compartment number / weight (kg), repeated
 *   PAX/n/n          passengers per class in configuration order
 *   PAD/n/n          passengers available for disembarkation per class
 *
 * Total load and underload are not fixed elements of the destination line in
 * the public examples, so they are reported in the SI (supplementary
 * information) section; SI is free text and therefore safe for any handler.
 * Weights are whole kilograms.
 */
import {
  TypeBFormatError,
  type CabinConfiguration,
  type LdmDestination,
  type LdmPayload,
} from "./model";
import {
  assertLine,
  assertStation,
  dd,
  flightCode,
  foldText,
  normalizeRegistration,
  parseFlightCode,
} from "./text";

const kg = (value: number, element: string) => {
  if (!Number.isInteger(value) || value < 0 || value > 999999)
    throw new TypeBFormatError(`Invalid weight ${value}`, element);
  return String(value);
};
const count = (value: number, element: string) => {
  if (!Number.isInteger(value) || value < 0 || value > 999)
    throw new TypeBFormatError(`Invalid count ${value}`, element);
  return String(value);
};

export function configurationCode(configuration: CabinConfiguration[]): string {
  if (!configuration.length)
    throw new TypeBFormatError("Configuration requires at least one class");
  return configuration
    .map(c => {
      const code = c.classCode.toUpperCase();
      if (!/^[A-Z]$/.test(code))
        throw new TypeBFormatError(`Invalid class code ${c.classCode}`, "CFG");
      return `${code}${count(c.seats, "CFG")}`;
    })
    .join("");
}

function destinationLine(d: LdmDestination, classes: number): string {
  const pax =
    "adults" in d.passengers
      ? [d.passengers.adults, d.passengers.children, d.passengers.infants]
      : [
          d.passengers.males,
          d.passengers.females,
          d.passengers.children,
          d.passengers.infants,
        ];
  if (d.paxByClass.length !== classes)
    throw new TypeBFormatError(
      `PAX/ must list ${classes} classes in configuration order`,
      "PAX"
    );
  const elements = [
    `-${assertStation(d.station)}`,
    pax.map(n => count(n, "pax")).join("/"),
    `T${kg(d.totalLoadKg, "T")}`,
    ...d.compartments.map(c => {
      if (!/^[1-5]$/.test(c.compartment))
        throw new TypeBFormatError(
          `Compartment must be 1-5: ${c.compartment}`,
          "compartment"
        );
      return `${c.compartment}/${kg(c.weightKg, "compartment")}`;
    }),
    `PAX/${d.paxByClass.map(n => count(n, "PAX")).join("/")}`,
  ];
  if (d.padByClass) {
    if (d.padByClass.length !== classes)
      throw new TypeBFormatError(
        `PAD/ must list ${classes} classes in configuration order`,
        "PAD"
      );
    elements.push(`PAD/${d.padByClass.map(n => count(n, "PAD")).join("/")}`);
  }
  return elements.join(".");
}

export function generateLdm(payload: LdmPayload): string[] {
  if (payload.type !== "LDM")
    throw new TypeBFormatError("Payload is not an LDM");
  const crew = [payload.crew.cockpit, payload.crew.cabin]
    .concat(payload.crew.extra !== undefined ? [payload.crew.extra] : [])
    .map(n => count(n, "crew"))
    .join("/");
  const lines = [
    "LDM",
    `${flightCode(payload.flight)}/${dd(payload.departureDate)}.${normalizeRegistration(payload.registration)}.${configurationCode(payload.configuration)}.${crew}`,
  ];
  if (!payload.destinations.length)
    throw new TypeBFormatError("LDM requires at least one destination");
  for (const d of payload.destinations)
    lines.push(destinationLine(d, payload.configuration.length));
  const si: string[] = [];
  const t = payload.totals;
  if (t?.totalLoadKg !== undefined)
    si.push(`TOTAL LOAD ${kg(t.totalLoadKg, "SI")} KG`);
  if (t?.underloadKg !== undefined)
    si.push(`UNDERLOAD BEFORE LMC ${kg(t.underloadKg, "SI")} KG`);
  const weights = [
    t?.zeroFuelWeightKg !== undefined
      ? `ZFW ${kg(t.zeroFuelWeightKg, "SI")}`
      : null,
    t?.takeOffWeightKg !== undefined
      ? `TOW ${kg(t.takeOffWeightKg, "SI")}`
      : null,
    t?.landingWeightKg !== undefined
      ? `LAW ${kg(t.landingWeightKg, "SI")}`
      : null,
  ].filter((v): v is string => v !== null);
  if (weights.length) si.push(`${weights.join(" ")} KG`);
  for (const d of payload.destinations) {
    const parts = [
      d.baggage
        ? `BAG ${count(d.baggage.pieces, "SI")}/${kg(d.baggage.weightKg, "SI")} KG`
        : null,
      d.cargoKg !== undefined ? `CARGO ${kg(d.cargoKg, "SI")} KG` : null,
      d.mailKg !== undefined ? `MAIL ${kg(d.mailKg, "SI")} KG` : null,
    ].filter((v): v is string => v !== null);
    if (parts.length) si.push(`${assertStation(d.station)} ${parts.join(" ")}`);
  }
  for (const remark of payload.remarks ?? []) si.push(...foldText(remark));
  if (si.length) lines.push("SI", ...si);
  return lines.map(line => assertLine(line, 69, "LDM"));
}

export interface ParsedLdm {
  type: "LDM";
  flight: { carrier: string; number: string; suffix?: string };
  day: number;
  registration: string;
  configuration: CabinConfiguration[];
  crew: { cockpit: number; cabin: number; extra?: number };
  destinations: Array<{
    station: string;
    passengers:
      | { adults: number; children: number; infants: number }
      | { males: number; females: number; children: number; infants: number };
    totalLoadKg: number;
    compartments: Array<{ compartment: string; weightKg: number }>;
    paxByClass: number[];
    padByClass?: number[];
  }>;
  remarks: string[];
}

export function parseConfigurationCode(code: string): CabinConfiguration[] {
  const matches = [...code.matchAll(/([A-Z])(\d{1,3})/g)];
  if (!matches.length || matches.map(m => m[0]).join("") !== code)
    throw new TypeBFormatError(`Invalid configuration ${code}`, "CFG");
  return matches.map(m => ({ classCode: m[1], seats: Number(m[2]) }));
}

/** Parse LDM text lines (without envelope). */
export function parseLdm(lines: string[]): ParsedLdm {
  const text = lines.map(l => l.trim()).filter(Boolean);
  if (text[0] !== "LDM") throw new TypeBFormatError("Not an LDM", "type");
  const flight =
    /^([A-Z0-9]{2,3}\d{1,4}[A-Z]?)\/(\d{2})\.([A-Z0-9]{3,8})\.([A-Z0-9]+)\.(\d{1,3})\/(\d{1,3})(?:\/(\d{1,3}))?$/.exec(
      text[1] ?? ""
    );
  if (!flight)
    throw new TypeBFormatError(`Invalid LDM flight line: ${text[1]}`, "flight");
  const configuration = parseConfigurationCode(flight[4]);
  const destinations: ParsedLdm["destinations"] = [];
  let i = 2;
  for (; i < text.length && text[i].startsWith("-"); i += 1) {
    const elements = text[i].split(".");
    const station = assertStation(elements[0].slice(1), "destination");
    const paxField = elements[1]?.split("/").map(Number) ?? [];
    if (
      ![3, 4].includes(paxField.length) ||
      paxField.some(n => !Number.isInteger(n) || n < 0)
    )
      throw new TypeBFormatError(
        `Invalid passenger element: ${elements[1]}`,
        "pax"
      );
    const passengers =
      paxField.length === 3
        ? { adults: paxField[0], children: paxField[1], infants: paxField[2] }
        : {
            males: paxField[0],
            females: paxField[1],
            children: paxField[2],
            infants: paxField[3],
          };
    const total = /^T(\d{1,6})$/.exec(elements[2] ?? "");
    if (!total)
      throw new TypeBFormatError(
        `Invalid total load element: ${elements[2]}`,
        "T"
      );
    const compartments: Array<{ compartment: string; weightKg: number }> = [];
    let paxByClass: number[] | null = null;
    let padByClass: number[] | undefined;
    for (const element of elements.slice(3)) {
      const comp = /^([1-5])\/(\d{1,6})$/.exec(element);
      const pax = /^PAX\/(\d{1,3}(?:\/\d{1,3})*)$/.exec(element);
      const pad = /^PAD\/(\d{1,3}(?:\/\d{1,3})*)$/.exec(element);
      if (comp)
        compartments.push({ compartment: comp[1], weightKg: Number(comp[2]) });
      else if (pax) paxByClass = pax[1].split("/").map(Number);
      else if (pad) padByClass = pad[1].split("/").map(Number);
      else if (element !== "")
        throw new TypeBFormatError(`Unknown LDM element: ${element}`, element);
    }
    if (!paxByClass)
      throw new TypeBFormatError("Destination line lacks PAX/ element", "PAX");
    destinations.push({
      station,
      passengers,
      totalLoadKg: Number(total[1]),
      compartments,
      paxByClass,
      padByClass,
    });
  }
  if (!destinations.length)
    throw new TypeBFormatError("LDM has no destination lines", "destination");
  const remarks: string[] = [];
  if (i < text.length) {
    const si = /^SI\s?(.*)$/.exec(text[i]);
    if (!si)
      throw new TypeBFormatError(`Unexpected LDM line: ${text[i]}`, text[i]);
    if (si[1]) remarks.push(si[1]);
    remarks.push(...text.slice(i + 1));
  }
  return {
    type: "LDM",
    flight: parseFlightCode(flight[1]),
    day: Number(flight[2]),
    registration: flight[3],
    configuration,
    crew: {
      cockpit: Number(flight[5]),
      cabin: Number(flight[6]),
      ...(flight[7] !== undefined ? { extra: Number(flight[7]) } : {}),
    },
    destinations,
    remarks,
  };
}
