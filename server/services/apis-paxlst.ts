import { TRPCError } from "@trpc/server";
import { zoneOffsetMs } from "./civil-day";

export const PAXLST_UNOA_MESSAGE =
  "PAXLST field contains unsupported UNOA characters";

class PaxlstFieldError extends Error {
  constructor(readonly field: string) {
    super(PAXLST_UNOA_MESSAGE);
  }
}

// The local draft uses UNOA syntax 4. Reject unsupported characters instead
// of silently changing names or letting input create additional segments.
function element(value: string, field = "field"): string {
  if (/[^A-Za-z0-9 .,()=/+'?:*-]/.test(value)) {
    throw new PaxlstFieldError(field);
  }
  return value.toUpperCase().replace(/[?+:'*]/g, "?$&");
}

function formatEdifactDate(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

// PAXLST 05B DTM qualifier 201: YYMMDDHHMM at the respective airport.
function localFlightTime(instant: Date, zone: string): string {
  const local = new Date(instant.getTime() + zoneOffsetMs(instant, zone));
  return local.toISOString().slice(2, 16).replace(/[-T:]/g, "");
}

export function generatePAXLST(data: {
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
}): string {
  const { flight, origin, destination, airline, passengers, apisMap } = data;

  const now = new Date();
  const dateStr = formatEdifactDate(now);
  const timeStr = now.toISOString().slice(11, 16).replace(":", "");

  const lines: string[] = [];

  // UNB - Interchange Header
  lines.push(
    `UNB+UNOA:4+${element(airline.code)}+${element(destination.country)}GOVT+${dateStr}:${timeStr}+${flight.id}++APIS'`
  );

  // UNH - Message Header
  lines.push(`UNH+1+PAXLST:D:05B:UN:IATA+${flight.id}+01:F'`);

  // BGM - Beginning of Message
  lines.push(`BGM+745'`);

  // NAD - Name and Address (carrier)
  lines.push(`NAD+MS+++${element(airline.name, "airline.name")}'`);

  // TDT - Transport Information
  lines.push(
    `TDT+20+${element(flight.flightNumber)}+++${element(airline.code)}'`
  );

  // LOC - Origin
  lines.push(`LOC+125+${element(origin.code)}'`);

  // DTM - Departure time
  lines.push(
    `DTM+189:${localFlightTime(flight.departureTime, origin.timezone)}:201'`
  );

  // LOC - Destination
  lines.push(`LOC+87+${element(destination.code)}'`);

  lines.push(
    `DTM+232:${localFlightTime(flight.arrivalTime, destination.timezone)}:201'`
  );

  // Passenger segments. One record with a non-UNOA name or an unsupported
  // document must not abort the draft for the whole flight silently: collect
  // the offending records and report them so they can be transliterated.
  const rejected: Array<{ passengerId: number; field: string }> = [];
  const passengerLines: string[] = [];
  let segCount = 0;
  for (const pax of passengers) {
    const apis = apisMap.get(pax.passengerId);
    if (!apis) continue;
    try {
      passengerLines.push(...passengerSegment(pax, apis));
      segCount++;
    } catch (error) {
      if (error instanceof PaxlstFieldError)
        rejected.push({ passengerId: pax.passengerId, field: error.field });
      else throw error;
    }
  }
  if (rejected.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${rejected.length} passenger record(s) contain characters outside UNOA (A-Z, 0-9, space . , ( ) = / + ' ? : * -) or an unsupported document; transliterate before drafting: ${rejected
        .map(r => `passenger ${r.passengerId} (${r.field})`)
        .join(", ")}`,
    });
  }
  lines.push(...passengerLines);

  // CNT - Passenger Count
  lines.push(`CNT+42:${segCount}'`);

  // UNT - Message Trailer
  lines.push(`UNT+${lines.length}+1'`);

  // UNZ - Interchange Trailer
  lines.push(`UNZ+1+${flight.id}'`);

  return lines.join("\n");
}

function passengerSegment(
  pax: { passengerId: number; firstName: string; lastName: string },
  apis: Record<string, unknown>
): string[] {
  const lines: string[] = [];
  {
    const surname = (apis["surname"] as string) ?? pax.lastName;
    const givenNames = (apis["given_names"] as string) ?? pax.firstName;
    const dob = apis["date_of_birth"]
      ? formatEdifactDate(new Date(apis["date_of_birth"] as string))
      : "";
    const gender = (apis["gender"] as string) ?? "U";
    const nationality = (apis["nationality"] as string) ?? "";
    const docNumber = (apis["document_number"] as string) ?? "";
    const issuingCountry = (apis["issuing_country"] as string) ?? "";
    const expiryDate = apis["expiry_date"]
      ? formatEdifactDate(new Date(apis["expiry_date"] as string))
      : "";
    const documentCodes: Record<string, string> = {
      passport: "P",
      national_id: "I",
      visa: "V",
    };
    const docType = documentCodes[String(apis["document_type"])];
    if (!docType) throw new PaxlstFieldError("document_type");

    // NAD - Passenger Name
    lines.push(
      `NAD+FL+++${element(surname, "surname")}:${element(givenNames, "given_names")}'`
    );

    // ATT - Gender
    if (!["M", "F", "U"].includes(gender)) throw new PaxlstFieldError("gender");
    lines.push(`ATT+2++${gender}'`);

    // DTM - Date of Birth
    if (dob) {
      lines.push(`DTM+329:${dob.slice(2)}'`);
    }

    // LOC - Residence country
    const resCountry = apis["residence_country"] as string | null;
    if (resCountry) {
      lines.push(`LOC+174+${element(resCountry, "residence_country")}'`);
    }

    // NAT - Nationality
    if (nationality) {
      lines.push(`NAT+2+${element(nationality, "nationality")}'`);
    }

    // DOC - Travel Document
    lines.push(`DOC+${docType}+${element(docNumber, "document_number")}'`);

    // DTM - Document Expiry
    if (expiryDate) {
      lines.push(`DTM+36:${expiryDate.slice(2)}'`);
    }

    // LOC - Document Issuing Country
    if (issuingCountry) {
      lines.push(`LOC+91+${element(issuingCountry, "issuing_country")}'`);
    }
  }
  return lines;
}
