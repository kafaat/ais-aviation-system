/**
 * Type B payload model.
 *
 * Every message the gateway emits is first built as one of these typed
 * payloads and only then serialised. The serialisation is behind
 * {@link MessageSerializer} so the same payload can be rendered as classic
 * IATA Type B teletype text today and as a BIX (RP 1755) document later
 * without touching the producers (see ./bix.ts and docs/architecture/typeb-gateway.md).
 *
 * Nothing in this file talks to a database or a transport.
 */

export const TYPEB_MESSAGE_TYPES = [
  "PNL",
  "ADL",
  "LDM",
  "MVT",
  "BSM",
  "BPM",
] as const;
export type TypeBMessageType = (typeof TYPEB_MESSAGE_TYPES)[number];

/** Airline designator + flight number, e.g. { carrier: "XY", number: "123" }. */
export interface FlightDesignator {
  /** Two-letter IATA (or three-character ICAO/alphanumeric) carrier code. */
  carrier: string;
  /** Flight number digits without padding; serialisers decide the width. */
  number: string;
  /** Optional operational suffix (A, B, ...). */
  suffix?: string;
}

export type PassengerTitle =
  | "MR"
  | "MRS"
  | "MS"
  | "MSTR"
  | "MISS"
  | "DR"
  | "CHD"
  | "INF";

export interface SsrElement {
  /** Four-letter SSR code (VGML, WCHR, INFT, TKNE, DOCS, SEAT ...). */
  code: string;
  /** Action/status code; defaults to HK (confirmed). */
  status?: "HK" | "NN" | "UN" | "HN";
  /** Number of services; defaults to 1. */
  count?: number;
  /** Free text following the code/status/count. */
  text?: string;
}

export interface PnlPassenger {
  surname: string;
  givenNames: string;
  title?: PassengerTitle;
  type: "adult" | "child" | "infant";
  /** Record locator (PNR), 5–6 alphanumerics. */
  locator: string;
  /** Deplaning station (three-letter IATA). */
  destination: string;
  /** Booking class / RBD letter used for the destination/class block. */
  classCode: string;
  ssrs?: SsrElement[];
  /** Other service information lines (free text). */
  osi?: string[];
  seat?: string;
  /** 13-digit e-ticket number; rendered as SSR TKNE when present. */
  ticketNumber?: string;
  /** Infant travelling with this (adult) passenger; rendered as SSR INFT. */
  infant?: { surname: string; givenNames: string; dateOfBirth?: Date };
}

export interface CabinConfiguration {
  classCode: string;
  seats: number;
}

export interface PnlPayload {
  type: "PNL";
  flight: FlightDesignator;
  /** Scheduled departure date (UTC calendar day is used for DDMMM). */
  departureDate: Date;
  /** Boarding point (departure station). */
  boardPoint: string;
  configuration?: CabinConfiguration[];
  /** Optional RBD mapping per cabin class, rendered as RBD/ lines. */
  rbd?: Array<{ classCode: string; bookingClasses: string }>;
  passengers: PnlPassenger[];
}

export interface AdlPayload {
  type: "ADL";
  flight: FlightDesignator;
  departureDate: Date;
  boardPoint: string;
  configuration?: CabinConfiguration[];
  add: PnlPassenger[];
  change: PnlPassenger[];
  delete: PnlPassenger[];
  /**
   * Booked totals per destination/class after the change. When absent the
   * destination header carries the number of ADD names in the block
   * (documented assumption, see typeb-gateway.md).
   */
  totals?: Array<{ destination: string; classCode: string; booked: number }>;
}

export interface LdmDestination {
  station: string;
  passengers:
    | { adults: number; children: number; infants: number }
    | { males: number; females: number; children: number; infants: number };
  /** Total deadload (baggage + cargo + mail) for this destination in kg. */
  totalLoadKg: number;
  compartments: Array<{ compartment: string; weightKg: number }>;
  /** Passengers per class in configuration order (PAX/8/94). */
  paxByClass: number[];
  /** Passengers available for disembarkation per class (PAD/0/0). */
  padByClass?: number[];
  baggage?: { pieces: number; weightKg: number };
  cargoKg?: number;
  mailKg?: number;
}

export interface LdmPayload {
  type: "LDM";
  flight: FlightDesignator;
  departureDate: Date;
  /** Aircraft registration without hyphen, e.g. HZASA. */
  registration: string;
  /** Version/configuration, rendered as C14Y165. */
  configuration: CabinConfiguration[];
  crew: { cockpit: number; cabin: number; extra?: number };
  destinations: LdmDestination[];
  totals?: {
    totalLoadKg?: number;
    underloadKg?: number;
    zeroFuelWeightKg?: number;
    takeOffWeightKg?: number;
    landingWeightKg?: number;
  };
  /** Supplementary information lines (free text). */
  remarks?: string[];
}

export interface DelayElement {
  /** IATA two-character delay code (numeric or alpha). */
  code: string;
  minutes: number;
}

export type MvtMovement =
  | {
      kind: "AD";
      offBlocks: Date;
      airborne?: Date;
      estimatedArrival?: Date;
      destination: string;
      delays?: DelayElement[];
      passengers?: { total: number } | { byClass: number[] };
    }
  | { kind: "AA"; touchdown?: Date; onBlocks: Date }
  | { kind: "ED"; estimatedDeparture: Date; delays?: DelayElement[] }
  | { kind: "NI"; nextInformation: Date };

export interface MvtPayload {
  type: "MVT";
  flight: FlightDesignator;
  /** Day of month in the flight line is taken from this date (UTC). */
  date: Date;
  registration: string;
  /** Station reporting the movement (departure station for AD/ED/NI, arrival station for AA). */
  station: string;
  movement: MvtMovement;
  remarks?: string[];
}

export interface BaggageFlightElement {
  flight: FlightDesignator;
  date: Date;
  /** Destination (or boarding point for inbound elements). */
  station: string;
  classCode?: string;
}

export interface LicensePlate {
  /** IATA 10-digit licence plate (Res. 740): leading digit, 3-digit airline code, 6-digit serial. */
  plate: string;
  /** Number of consecutive tags starting at `plate`; defaults to 1. */
  count?: number;
}

export interface BsmPayload {
  type: "BSM";
  /** Omitted for a new bag; CHG/DEL update or cancel an earlier BSM for the same licence plate. */
  action?: "CHG" | "DEL";
  /** .V/ version element: processing indicator and station. */
  version: { indicator: "L" | "T"; station: string };
  outbound: BaggageFlightElement;
  licensePlates: LicensePlate[];
  passengerStatus?: {
    checkedIn: boolean;
    seat?: string;
    cabinClass?: string;
    sequence?: number;
  };
  passenger?: { surname: string; givenNames?: string };
  locator?: string;
  baggage?: { unit: "K" | "L"; pieces: number; weight: number };
  onward?: BaggageFlightElement;
  inbound?: BaggageFlightElement;
}

export interface BpmPayload {
  type: "BPM";
  version: { indicator: "L" | "T"; station: string };
  /** .J/ processing element: what happened to the bag, when and where. */
  processing: {
    indicator: "S" | "L" | "U" | "R";
    time: Date;
    location: string;
    device?: string;
  };
  outbound: BaggageFlightElement;
  licensePlates: LicensePlate[];
  passenger?: { surname: string; givenNames?: string };
}

export type TypeBPayload =
  | PnlPayload
  | AdlPayload
  | LdmPayload
  | MvtPayload
  | BsmPayload
  | BpmPayload;

/** A rendering of a payload. Type B returns teletype lines; BIX returns JSON. */
export interface SerializedMessage {
  format: "typeb" | "bix";
  /** For Type B: one entry per message part (PNL/ADL may need several). */
  parts: string[];
}

export interface MessageSerializer {
  readonly format: SerializedMessage["format"];
  supports(type: TypeBMessageType): boolean;
  serialize(payload: TypeBPayload): SerializedMessage;
}

export class TypeBFormatError extends Error {
  constructor(
    message: string,
    readonly element?: string
  ) {
    super(message);
    this.name = "TypeBFormatError";
  }
}
