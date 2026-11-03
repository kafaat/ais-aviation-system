/**
 * PNL (Passenger Name List) and ADL (Additions and Deletions List).
 *
 * Reservations → handling DCS messages (IATA PSCRM RP 1708 family). The
 * widely documented layout implemented here:
 *
 *   PNL
 *   XY123/03NOV RUH PART1          flight/date, boarding point, part number
 *   CFG/016C150Y                   optional configuration
 *   RBD/Y/YBHKMLQ                  optional RBD mapping
 *   -JED025Y                       destination, 3-digit count, class
 *   1ALHARBI/AHMEDMR .L/ABC123     name element + record locator
 *    .R/VGML HK1                   SSR elements, one per line
 *    .R/INFT HK1 ALHARBI/SARA 01JAN25
 *    .OSI/CTCM 966500000000        OSI (assumption, see below)
 *   2SMITH/JOHNMR/JANEMRS .L/DEF456
 *   ENDPART1 | ENDPNL
 *
 *   ADL
 *   XY123/03NOV RUH PART1
 *   -JED001Y
 *   ADD
 *   1BROWN/TOMMR .L/GHI789
 *   DEL
 *   1DOE/JANEMS .L/JKL012
 *   ENDADL
 *
 * Verified against public vendor documentation of the format (AeroCRS
 * "PNL/ADL setup", Videcom DCS notes) rather than the licensed PSCRM text.
 * ASSUMPTIONS flagged for the handler exchange:
 *  - OSI free text is carried as `.OSI/`; some handlers expect `.RN/`.
 *  - The ADL destination header count is the number of ADD names unless
 *    `totals` is supplied.
 *  - CFG/ renders each class as 3-digit seats + class letter.
 */
import {
  TypeBFormatError,
  type AdlPayload,
  type PnlPassenger,
  type PnlPayload,
  type SsrElement,
} from "./model";
import {
  assertLine,
  assertStation,
  ddmmm,
  ddmmmyy,
  flightCode,
  nameLetters,
  sanitizeText,
} from "./text";

/** Name and element lines in PNL/ADL are limited to 64 characters. */
export const PNL_LINE_LENGTH = 64;
/** Text budget per part; leaves room for the envelope within 3,840 characters. */
const PART_TEXT_BUDGET = 3600;
const MAX_NAMES_PER_ELEMENT = 9;

interface NameBlock {
  destination: string;
  classCode: string;
  seats: number;
  lines: string[];
}

function title(p: PnlPassenger): string {
  if (p.type === "child") return "CHD";
  return p.title ?? (p.type === "infant" ? "INF" : "MR");
}

function locator(value: string): string {
  const loc = value.toUpperCase();
  if (!/^[A-Z0-9]{5,6}$/.test(loc))
    throw new TypeBFormatError(`Invalid record locator: ${value}`, ".L/");
  return loc;
}

export function formatSsr(ssr: SsrElement): string {
  const code = ssr.code.toUpperCase();
  if (!/^[A-Z]{4}$/.test(code))
    throw new TypeBFormatError(`Invalid SSR code: ${ssr.code}`, ".R/");
  const count = ssr.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 9)
    throw new TypeBFormatError(`Invalid SSR count: ${count}`, ".R/");
  const text = ssr.text ? ` ${sanitizeText(ssr.text)}` : "";
  return `.R/${code} ${ssr.status ?? "HK"}${count}${text}`;
}

/** Elements following the name: locator first, then SSR/OSI lines. */
function elementLines(p: PnlPassenger): string[] {
  const elements: string[] = [];
  for (const ssr of p.ssrs ?? []) elements.push(formatSsr(ssr));
  if (p.ticketNumber) {
    if (!/^\d{13}$/.test(p.ticketNumber))
      throw new TypeBFormatError(
        `Ticket number must be 13 digits: ${p.ticketNumber}`,
        "TKNE"
      );
    elements.push(formatSsr({ code: "TKNE", text: `${p.ticketNumber}/1` }));
  }
  if (p.seat) {
    const seat = p.seat.toUpperCase();
    if (!/^\d{1,3}[A-K]$/.test(seat))
      throw new TypeBFormatError(`Invalid seat: ${p.seat}`, "SEAT");
    elements.push(formatSsr({ code: "SEAT", text: seat }));
  }
  if (p.infant) {
    const dob = p.infant.dateOfBirth ? ` ${ddmmmyy(p.infant.dateOfBirth)}` : "";
    elements.push(
      formatSsr({
        code: "INFT",
        text: `${nameLetters(p.infant.surname)}/${nameLetters(p.infant.givenNames)}${dob}`,
      })
    );
  }
  for (const osi of p.osi ?? []) elements.push(`.OSI/${sanitizeText(osi)}`);
  return elements;
}

/** One or more passengers sharing locator and surname become one name element. */
function nameElement(group: PnlPassenger[]): string[] {
  const surname = nameLetters(group[0].surname);
  const given = group.map(p => `${nameLetters(p.givenNames)}${title(p)}`);
  const head = `${group.length}${surname}/${given.join("/")}`;
  const lines: string[] = [];
  const subElements = group.flatMap(elementLines);
  const first = `${head} .L/${locator(group[0].locator)}`;
  if (first.length > PNL_LINE_LENGTH) {
    lines.push(assertLine(head, PNL_LINE_LENGTH, "name"));
    lines.push(` .L/${locator(group[0].locator)}`);
  } else lines.push(first);
  for (const element of subElements)
    lines.push(assertLine(` ${element}`, PNL_LINE_LENGTH, "element"));
  return lines;
}

/** Infant-type passengers are folded into an adult on the same locator. */
function attachInfants(passengers: PnlPassenger[]): PnlPassenger[] {
  const seated = passengers.filter(p => p.type !== "infant");
  const infants = passengers.filter(p => p.type === "infant");
  const result = seated.map(p => ({ ...p }));
  for (const infant of infants) {
    const carrier = result.find(
      p => p.locator === infant.locator && p.type === "adult" && !p.infant
    );
    if (!carrier)
      throw new TypeBFormatError(
        `Infant ${infant.surname} has no accompanying adult on ${infant.locator}`,
        "INFT"
      );
    carrier.infant = { surname: infant.surname, givenNames: infant.givenNames };
  }
  return result;
}

function compareNames(a: PnlPassenger, b: PnlPassenger) {
  return (
    nameLetters(a.surname).localeCompare(nameLetters(b.surname)) ||
    nameLetters(a.givenNames).localeCompare(nameLetters(b.givenNames))
  );
}

/** Group by destination/class, sort names, merge same-locator families. */
export function nameBlocks(passengers: PnlPassenger[]): NameBlock[] {
  const seated = attachInfants(passengers).sort(
    (a, b) =>
      assertStation(a.destination).localeCompare(
        assertStation(b.destination)
      ) ||
      a.classCode.localeCompare(b.classCode) ||
      compareNames(a, b)
  );
  const blocks: NameBlock[] = [];
  let i = 0;
  while (i < seated.length) {
    const p = seated[i];
    const group = [p];
    while (
      i + group.length < seated.length &&
      group.length < MAX_NAMES_PER_ELEMENT &&
      seated[i + group.length].locator === p.locator &&
      nameLetters(seated[i + group.length].surname) ===
        nameLetters(p.surname) &&
      seated[i + group.length].destination === p.destination &&
      seated[i + group.length].classCode === p.classCode
    )
      group.push(seated[i + group.length]);
    i += group.length;
    const classCode = p.classCode.toUpperCase();
    if (!/^[A-Z]$/.test(classCode))
      throw new TypeBFormatError(`Invalid class code: ${p.classCode}`, "class");
    blocks.push({
      destination: assertStation(p.destination),
      classCode,
      seats: group.length,
      lines: nameElement(group),
    });
  }
  return blocks;
}

function destinationHeader(destination: string, classCode: string, n: number) {
  if (n > 999)
    throw new TypeBFormatError("Destination block exceeds 999 passengers");
  return `-${destination}${String(n).padStart(3, "0")}${classCode}`;
}

function configurationLines(payload: PnlPayload | AdlPayload): string[] {
  const lines: string[] = [];
  if (payload.configuration?.length)
    lines.push(
      `CFG/${payload.configuration
        .map(
          c => `${String(c.seats).padStart(3, "0")}${c.classCode.toUpperCase()}`
        )
        .join("")}`
    );
  if (payload.type === "PNL")
    for (const rbd of payload.rbd ?? [])
      lines.push(
        `RBD/${rbd.classCode.toUpperCase()}/${rbd.bookingClasses.toUpperCase()}`
      );
  return lines.map(line => assertLine(line, PNL_LINE_LENGTH, "CFG"));
}

function flightLine(payload: PnlPayload | AdlPayload, part: number) {
  return `${flightCode(payload.flight)}/${ddmmm(payload.departureDate)} ${assertStation(payload.boardPoint)} PART${part}`;
}

/**
 * Split name blocks into parts. Each part repeats the destination/class
 * header with the number of names contained in that part (for an ADL: the
 * number of ADD names, unless totals are supplied by the caller).
 */
function paginate(
  payload: PnlPayload | AdlPayload,
  sections: Array<{ label: string | null; blocks: NameBlock[] }>
): string[][] {
  const type = payload.type;
  const parts: string[][] = [];
  let part: string[] = [];
  let size = 0;
  let partNo = 1;
  let current: { destination: string; classCode: string } | null = null;
  let label: string | null = null;
  let headerIndex = -1;
  let counted = 0;

  const countsToward = (sectionLabel: string | null) =>
    type === "PNL" || sectionLabel === "ADD";
  const headerFor = (
    dest: { destination: string; classCode: string },
    n: number
  ) => {
    const total = payload.type === "ADL" ? payload.totals : undefined;
    const supplied = total?.find(
      t =>
        assertStation(t.destination) === dest.destination &&
        t.classCode.toUpperCase() === dest.classCode
    );
    return destinationHeader(
      dest.destination,
      dest.classCode,
      supplied ? supplied.booked : n
    );
  };
  const settleHeader = () => {
    if (headerIndex >= 0 && current)
      part[headerIndex] = headerFor(current, counted);
  };
  const open = () => {
    part = [type, flightLine(payload, partNo)];
    if (partNo === 1) part.push(...configurationLines(payload));
    size = part.join("\n").length;
    current = null;
    label = null;
    headerIndex = -1;
    counted = 0;
  };
  const close = (final: boolean) => {
    settleHeader();
    part.push(final ? `END${type}` : `ENDPART${partNo}`);
    parts.push(part);
  };
  open();
  for (const section of sections) {
    for (const block of section.blocks) {
      const newHeader =
        !current ||
        current.destination !== block.destination ||
        current.classCode !== block.classCode;
      const newLabel = newHeader || label !== section.label;
      const extra =
        block.lines.join("\n").length +
        1 +
        (newHeader ? 9 : 0) +
        (newLabel && section.label ? section.label.length + 1 : 0);
      if (size + extra > PART_TEXT_BUDGET && headerIndex >= 0) {
        close(false);
        partNo += 1;
        open();
      }
      if (
        !current ||
        current.destination !== block.destination ||
        current.classCode !== block.classCode
      ) {
        settleHeader();
        current = {
          destination: block.destination,
          classCode: block.classCode,
        };
        headerIndex = part.length;
        part.push(destinationHeader(block.destination, block.classCode, 0));
        counted = 0;
        label = null;
      }
      if (section.label && label !== section.label) {
        part.push(section.label);
        label = section.label;
      }
      part.push(...block.lines);
      if (countsToward(section.label)) counted += block.seats;
      size += extra;
    }
  }
  close(true);
  return parts;
}

/** Generate PNL text lines, one array per part. */
export function generatePnl(payload: PnlPayload): string[][] {
  if (payload.type !== "PNL")
    throw new TypeBFormatError("Payload is not a PNL");
  const blocks = nameBlocks(payload.passengers);
  if (blocks.length === 0) {
    // An empty flight still gets a PNL so the handler knows the list is final.
    return [
      [
        ...["PNL", flightLine(payload, 1)],
        ...configurationLines(payload),
        "ENDPNL",
      ],
    ];
  }
  return paginate(payload, [{ label: null, blocks }]);
}

/** Generate ADL text lines, one array per part. */
export function generateAdl(payload: AdlPayload): string[][] {
  if (payload.type !== "ADL")
    throw new TypeBFormatError("Payload is not an ADL");
  const sections = (
    [
      ["ADD", payload.add],
      ["CHG", payload.change],
      ["DEL", payload.delete],
    ] as const
  )
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, blocks: nameBlocks(list) }));
  if (sections.length === 0)
    throw new TypeBFormatError(
      "ADL requires at least one ADD, CHG or DEL name"
    );
  // Headers are organised per destination/class, each holding its ADD, CHG
  // and DEL sections in that order.
  const keys = [
    ...new Set(
      sections.flatMap(s =>
        s.blocks.map(b => `${b.destination}/${b.classCode}`)
      )
    ),
  ].sort();
  const ordered: Array<{ label: string | null; blocks: NameBlock[] }> = [];
  for (const key of keys)
    for (const s of sections) {
      const blocks = s.blocks.filter(
        b => `${b.destination}/${b.classCode}` === key
      );
      if (blocks.length) ordered.push({ label: s.label, blocks });
    }
  return paginate(payload, ordered);
}
