/**
 * Functional acknowledgement parsing for government passenger-data messages.
 *
 * Two acknowledgement shapes are accepted:
 *
 * - CUSRES (UN/EDIFACT customs response, as used by APIS/PNRGOV authorities):
 *   UNH+ref+CUSRES:D:05B:UN:IATA' BGM+962' RFF+<qualifier>:<reference>'
 *   ERP+<point>' ERC+<code>' FTX+AAO+++<text>' ... UNT' . A CUSRES with no
 *   ERC segments is a positive acknowledgement; ERC codes mark a rejection.
 * - CONTRL (syntax acknowledgement): UCI+<interchange ref>+<sender>+
 *   <recipient>+<action code>+<syntax error code>' where action code 7 means
 *   acknowledged and 4 rejected.
 *
 * The exact error-code list, the RFF qualifier that echoes our correlation id
 * and whether the NPSC answers with CUSRES at all are part of the technical
 * specification that is not public (research README, "could not verify").
 * The parser therefore extracts every candidate reference and lets the
 * transmission service match any of them against its correlation ids.
 */
import { elementAt, parseEdifact } from "./edifact";

export type AcknowledgementDisposition = "ack" | "nak" | "unknown";

export interface AcknowledgementError {
  code: string;
  /** Segment position or tag the authority points at, when present. */
  point: string | null;
  text: string | null;
}

export interface ParsedAcknowledgement {
  messageType: "CUSRES" | "CONTRL" | "unknown";
  disposition: AcknowledgementDisposition;
  /** Every reference found (RFF values, UNH common access reference, UCI interchange reference). */
  references: string[];
  errors: AcknowledgementError[];
  interchangeControlReference: string | null;
}

export function parseAcknowledgement(body: string): ParsedAcknowledgement {
  const segments = parseEdifact(body);
  const references = new Set<string>();
  const errors: AcknowledgementError[] = [];
  let messageType: ParsedAcknowledgement["messageType"] = "unknown";
  let disposition: AcknowledgementDisposition = "unknown";
  let interchangeControlReference: string | null = null;
  let pendingPoint: string | null = null;
  let pendingCode: string | null = null;

  for (const seg of segments) {
    switch (seg.tag) {
      case "UNB":
        interchangeControlReference = elementAt(seg, 4) ?? null;
        break;
      case "UNH": {
        const type = elementAt(seg, 1);
        if (type === "CUSRES" || type === "CONTRL") messageType = type;
        const common = elementAt(seg, 2);
        if (common) references.add(common);
        break;
      }
      case "RFF": {
        const value = elementAt(seg, 0, 1);
        if (value) references.add(value);
        break;
      }
      case "ERP":
        pendingPoint = elementAt(seg, 0) ?? null;
        break;
      case "ERC":
        pendingCode = elementAt(seg, 0) ?? null;
        if (pendingCode) {
          errors.push({ code: pendingCode, point: pendingPoint, text: null });
          pendingPoint = null;
        }
        break;
      case "FTX": {
        const text = seg.elements[3]?.filter(Boolean).join(" ") ?? null;
        if (text && errors.length && errors[errors.length - 1].text === null)
          errors[errors.length - 1].text = text;
        break;
      }
      case "UCI": {
        messageType = "CONTRL";
        const ref = elementAt(seg, 0);
        if (ref) references.add(ref);
        const action = elementAt(seg, 3);
        const syntaxError = elementAt(seg, 4);
        if (action === "7") disposition = "ack";
        else if (action === "4" || action === "8") {
          disposition = "nak";
          errors.push({
            code: syntaxError ?? `UCI-${action ?? "?"}`,
            point: null,
            text: null,
          });
        }
        break;
      }
      default:
        break;
    }
  }
  if (messageType === "CUSRES") disposition = errors.length ? "nak" : "ack";
  if (interchangeControlReference) references.add(interchangeControlReference);
  return {
    messageType,
    disposition,
    references: [...references],
    errors,
    interchangeControlReference,
  };
}
