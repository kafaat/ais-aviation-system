import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateETicketPDF,
  type TicketData,
} from "../services/eticket.service";

function ticket(): TicketData {
  return {
    passengerName: "Synthetic Passenger",
    passengerType: "adult",
    ticketNumber: "0011234567890",
    bookingReference: "RETRY1",
    pnr: "RETRY1",
    flightNumber: "TEST71",
    airline: "Synthetic Airline",
    origin: "Riyadh",
    originCode: "RUH",
    destination: "Jeddah",
    destinationCode: "JED",
    departureTime: new Date("2030-01-01T10:00:00Z"),
    arrivalTime: new Date("2030-01-01T12:00:00Z"),
    cabinClass: "economy",
    baggageAllowance: "20 kg",
    totalAmount: 20000,
    currency: "SAR",
    issueDate: new Date("2026-10-27T09:12:30Z"),
    localCoupon: { number: 1, status: "O" },
  };
}

const digest = (pdf: Buffer) => createHash("sha256").update(pdf).digest("hex");

afterEach(() => vi.useRealTimers());

describe("real e-ticket renderer retry identity", () => {
  it("renders identical bytes for the same local document at different wall times", async () => {
    // Only the wall clock changes. QRCode and PDFKit execute their real code;
    // asynchronous rendering timers and streams are not replaced.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T23:59:00Z"));
    const first = await generateETicketPDF(ticket());
    vi.setSystemTime(new Date("2026-11-06T00:01:00Z"));
    const retry = await generateETicketPDF(ticket());

    expect(first.subarray(0, 5).toString()).toBe("%PDF-");
    expect(first.subarray(-30).toString()).toContain("%%EOF");
    expect(retry.equals(first), `${digest(first)} !== ${digest(retry)}`).toBe(
      true
    );
  });

  it("changes the bytes when the document's semantic passenger data changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    const original = await generateETicketPDF(ticket());
    const corrected = await generateETicketPDF({
      ...ticket(),
      passengerName: "Corrected Passenger",
    });

    expect(corrected.equals(original)).toBe(false);
    expect(digest(corrected)).not.toBe(digest(original));
  });
});
