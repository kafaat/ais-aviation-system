import { zoneOffsetMs } from "./civil-day";

// The local draft uses UNOA syntax 4. Reject unsupported characters instead
// of silently changing names or letting input create additional segments.
function element(value: string): string {
  if (/[^A-Za-z0-9 .,()=/+'?:*-]/.test(value)) {
    throw new Error("PAXLST field contains unsupported UNOA characters");
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
  lines.push(`NAD+MS+++${element(airline.name)}'`);

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

  // Passenger segments
  let segCount = 0;
  for (const pax of passengers) {
    const apis = apisMap.get(pax.passengerId);
    if (!apis) continue;

    segCount++;

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
    if (!docType) throw new Error("Unsupported PAXLST document type");

    // NAD - Passenger Name
    lines.push(`NAD+FL+++${element(surname)}:${element(givenNames)}'`);

    // ATT - Gender
    if (!["M", "F", "U"].includes(gender))
      throw new Error("Unsupported PAXLST gender");
    lines.push(`ATT+2++${gender}'`);

    // DTM - Date of Birth
    if (dob) {
      lines.push(`DTM+329:${dob.slice(2)}'`);
    }

    // LOC - Residence country
    const resCountry = apis["residence_country"] as string | null;
    if (resCountry) {
      lines.push(`LOC+174+${element(resCountry)}'`);
    }

    // NAT - Nationality
    if (nationality) {
      lines.push(`NAT+2+${element(nationality)}'`);
    }

    // DOC - Travel Document
    lines.push(`DOC+${docType}+${element(docNumber)}'`);

    // DTM - Document Expiry
    if (expiryDate) {
      lines.push(`DTM+36:${expiryDate.slice(2)}'`);
    }

    // LOC - Document Issuing Country
    if (issuingCountry) {
      lines.push(`LOC+91+${element(issuingCountry)}'`);
    }
  }

  // CNT - Passenger Count
  lines.push(`CNT+42:${segCount}'`);

  // UNT - Message Trailer
  lines.push(`UNT+${lines.length}+1'`);

  // UNZ - Interchange Trailer
  lines.push(`UNZ+1+${flight.id}'`);

  return lines.join("\n");
}
