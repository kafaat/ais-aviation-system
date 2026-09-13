import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { TRPCError } from "@trpc/server";
import { randomInt } from "node:crypto";

/**
 * E-Ticket PDF Generation Service
 * Generates local itinerary documents and signed AIS boarding documents.
 * External carrier ticket/dispatch acceptance is a separate authority.
 */

export interface TicketData {
  flightId?: number;
  additionalLegs?: TicketData[];
  // Passenger info
  passengerName: string;
  passengerType: "adult" | "child" | "infant";

  // Booking info
  ticketNumber: string; // 13-digit IATA standard
  bookingReference: string;
  pnr: string;

  // Flight info
  flightNumber: string;
  airline: string;
  origin: string;
  originCode: string;
  destination: string;
  destinationCode: string;
  departureTime: Date;
  arrivalTime: Date;

  // Seat & class
  cabinClass: string;
  seatNumber?: string;

  // Baggage
  baggageAllowance: string;

  // Payment
  totalAmount: number;
  currency: string;

  // Dates
  issueDate: Date;
}

export interface BoardingPassData extends TicketData {
  signedToken: string;
  gate?: string;
  boardingTime?: Date;
  sequence?: string;
}

/**
 * Generate a local document reference (13 digits; not external IATA issuance)
 * Format: AAA-XXXXXXXXX-C
 * AAA = Airline code (3 digits)
 * XXXXXXXXX = Serial number (9 digits)
 * C = Check digit (1 digit)
 */
export function generateTicketNumber(airlineCode: string = "001"): string {
  // Generate 9-digit serial number
  const serial = randomInt(100000000, 1000000000);

  // Calculate check digit (simple mod 7 for demo)
  const checkDigit = (parseInt(airlineCode) + serial) % 7;

  return `${airlineCode}${serial}${checkDigit}`;
}

/**
 * Generate E-Ticket PDF
 */
export async function generateETicketPDF(
  ticketData: TicketData
): Promise<Buffer> {
  // Generate QR code first (async operation)
  const qrData = `${ticketData.pnr}|${ticketData.ticketNumber}|${ticketData.passengerName}`;
  let qrCodeDataURL: string;
  try {
    qrCodeDataURL = await QRCode.toDataURL(qrData);
  } catch (error) {
    console.error("Error generating QR code:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to generate e-ticket QR code",
    });
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const buffers: Buffer[] = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", _err => {
        reject(
          new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to generate e-ticket PDF",
          })
        );
      });

      // Header
      doc
        .fontSize(24)
        .fillColor("#1e40af")
        .text("E-TICKET", { align: "center" })
        .moveDown(0.5);

      doc
        .fontSize(10)
        .fillColor("#6b7280")
        .text("ELECTRONIC TICKET", { align: "center" })
        .moveDown(1);

      // Ticket number
      doc
        .fontSize(12)
        .fillColor("#000")
        .text(`Ticket Number: ${ticketData.ticketNumber}`, { align: "center" })
        .text(`Booking Reference: ${ticketData.bookingReference}`, {
          align: "center",
        })
        .text(`PNR: ${ticketData.pnr}`, { align: "center" })
        .moveDown(1.5);

      // Passenger info box
      doc.rect(50, doc.y, 495, 80).fillAndStroke("#f3f4f6", "#d1d5db");

      doc
        .fillColor("#000")
        .fontSize(10)
        .text("PASSENGER INFORMATION", 60, doc.y - 70, { underline: true })
        .moveDown(0.5);

      doc
        .fontSize(14)
        .text(`Name: ${ticketData.passengerName}`, 60)
        .fontSize(10)
        .text(`Type: ${ticketData.passengerType.toUpperCase()}`, 60)
        .moveDown(1.5);

      // Flight info box
      doc.rect(50, doc.y, 495, 120).fillAndStroke("#eff6ff", "#bfdbfe");

      doc
        .fillColor("#1e40af")
        .fontSize(10)
        .text("FLIGHT INFORMATION", 60, doc.y - 110, { underline: true })
        .moveDown(0.5);

      doc
        .fillColor("#000")
        .fontSize(12)
        .text(`Flight: ${ticketData.flightNumber}`, 60)
        .text(`Airline: ${ticketData.airline}`, 60)
        .moveDown(0.5);

      doc
        .fontSize(16)
        .text(
          `${ticketData.originCode} → ${ticketData.destinationCode}`,
          60,
          undefined,
          { continued: true }
        )
        .fontSize(10)
        .text(`  (${ticketData.origin} to ${ticketData.destination})`)
        .moveDown(0.5);

      doc
        .fontSize(10)
        .text(
          `Departure: ${ticketData.departureTime.toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          })}`,
          60
        )
        .text(
          `Arrival: ${ticketData.arrivalTime.toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          })}`,
          60
        )
        .moveDown(1.5);

      // Service details
      doc.rect(50, doc.y, 495, 80).fillAndStroke("#f9fafb", "#e5e7eb");

      doc
        .fillColor("#000")
        .fontSize(10)
        .text("SERVICE DETAILS", 60, doc.y - 70, { underline: true })
        .moveDown(0.5);

      doc
        .text(`Class: ${ticketData.cabinClass.toUpperCase()}`, 60)
        .text(`Seat: ${ticketData.seatNumber || "Not assigned"}`, 60)
        .text(`Baggage: ${ticketData.baggageAllowance}`, 60)
        .moveDown(1.5);

      // Payment info
      doc
        .fontSize(10)
        .text(
          `Total Amount: ${(ticketData.totalAmount / 100).toFixed(2)} ${ticketData.currency}`,
          60
        )
        .text(
          `Issue Date: ${ticketData.issueDate.toLocaleDateString("en-US", {
            dateStyle: "medium",
          })}`,
          60
        )
        .moveDown(1.5);

      // QR Code
      doc.image(qrCodeDataURL, 220, doc.y, { width: 150, height: 150 });
      doc.moveDown(10);

      // Footer
      doc
        .fontSize(8)
        .fillColor("#9ca3af")
        .text(
          "AIS itinerary receipt. Carrier ticket acceptance and boarding authorization are separate.",
          50,
          doc.y,
          { align: "center", width: 495 }
        )
        .moveDown(0.5)
        .text("For inquiries, please contact customer service.", {
          align: "center",
          width: 495,
        });

      for (const leg of ticketData.additionalLegs ?? []) {
        doc
          .addPage()
          .fillColor("#1e40af")
          .fontSize(20)
          .text("ITINERARY CONTINUED", 50, 50);
        doc
          .moveDown()
          .fillColor("#000")
          .fontSize(12)
          .text(`Passenger: ${leg.passengerName}`)
          .text(`Reference: ${leg.bookingReference}`)
          .text(`Flight: ${leg.airline} ${leg.flightNumber}`)
          .moveDown()
          .text(
            `${leg.originCode} (${leg.origin}) to ${leg.destinationCode} (${leg.destination})`
          )
          .text(`Departure (UTC): ${leg.departureTime.toISOString()}`)
          .text(`Arrival (UTC): ${leg.arrivalTime.toISOString()}`)
          .text(
            `Class: ${leg.cabinClass}; Seat: ${leg.seatNumber ?? "Not assigned"}`
          )
          .text(`Baggage: ${leg.baggageAllowance}`)
          .moveDown()
          .fontSize(9)
          .text(
            "Included in the itinerary total on the first page. Not a boarding authorization."
          );
      }
      doc.end();
    } catch (error) {
      console.error("Error generating e-ticket PDF:", error);
      reject(
        new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate e-ticket",
        })
      );
    }
  });
}

/**
 * Generate Boarding Pass PDF
 */
export async function generateBoardingPassPDF(
  passData: BoardingPassData
): Promise<Buffer> {
  // Generate barcode data first (async operation)
  if (!passData.signedToken)
    throw new Error("Signed boarding authorization required");
  const barcodeData = passData.signedToken;
  let barcodeDataURL: string;
  try {
    barcodeDataURL = await QRCode.toDataURL(barcodeData);
  } catch (error) {
    console.error("Error generating barcode:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to generate boarding pass barcode",
    });
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: [600, 250], margin: 20 });
      const buffers: Buffer[] = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", _err => {
        reject(
          new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to generate boarding pass PDF",
          })
        );
      });

      // Header
      doc
        .fontSize(18)
        .fillColor("#1e40af")
        .text("BOARDING PASS", 20, 20, { align: "center" })
        .moveDown(0.3);

      // Passenger name
      doc
        .fontSize(14)
        .fillColor("#000")
        .text(passData.passengerName.toUpperCase(), 20, 50)
        .moveDown(0.3);

      // Flight route
      doc
        .fontSize(24)
        .text(`${passData.originCode}`, 20, 80)
        .fontSize(16)
        .text("→", 90, 85)
        .fontSize(24)
        .text(`${passData.destinationCode}`, 120, 80);

      // Flight details
      doc
        .fontSize(10)
        .text(`Flight: ${passData.flightNumber}`, 20, 120)
        .text(`Date: ${passData.departureTime.toLocaleDateString()}`, 20, 135)
        .text(`Time: ${passData.departureTime.toLocaleTimeString()}`, 20, 150)
        .text(`Gate: ${passData.gate || "TBA"}`, 20, 165)
        .text(`Seat: ${passData.seatNumber || "TBA"}`, 20, 180)
        .text(`Class: ${passData.cabinClass.toUpperCase()}`, 20, 195);

      // Barcode
      doc.image(barcodeDataURL, 350, 50, { width: 150, height: 150 });

      // Booking reference
      doc
        .fontSize(10)
        .text(`PNR: ${passData.pnr}`, 350, 210)
        .text(`Seq: ${passData.sequence || "001"}`, 480, 210);

      doc.end();
    } catch (error) {
      console.error("Error generating boarding pass PDF:", error);
      reject(
        new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate boarding pass",
        })
      );
    }
  });
}

/**
 * Generate E-Ticket PDF from booking and passenger IDs
 * Helper function for email attachments
 */
export async function generateETicketForPassenger(
  bookingId: number,
  passengerId: number
): Promise<string> {
  const { readTicketDocument } = await import("./ticket-documents.service");
  const { data } = await readTicketDocument(bookingId, passengerId);
  return (await generateETicketPDF(data)).toString("base64");
}
