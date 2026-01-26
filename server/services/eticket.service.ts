import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { TRPCError } from "@trpc/server";

/**
 * E-Ticket PDF Generation Service
 * Generates IATA-compliant e-tickets and boarding passes
 */

export interface TicketData {
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
  gate?: string;
  boardingTime?: Date;
  sequence?: string;
}

/**
 * Generate IATA-standard ticket number (13 digits)
 * Format: AAA-XXXXXXXXX-C
 * AAA = Airline code (3 digits)
 * XXXXXXXXX = Serial number (9 digits)
 * C = Check digit (1 digit)
 */
export function generateTicketNumber(airlineCode: string = "001"): string {
  // Generate 9-digit serial number
  const serial = Math.floor(100000000 + Math.random() * 900000000);

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
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const buffers: Buffer[] = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });

      // Generate QR code
      const qrData = `${ticketData.pnr}|${ticketData.ticketNumber}|${ticketData.passengerName}`;
      const qrCodeDataURL = await QRCode.toDataURL(qrData);

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
          "This is an electronic ticket. Please present this document or a printed copy at check-in.",
          50,
          doc.y,
          { align: "center", width: 495 }
        )
        .moveDown(0.5)
        .text("For inquiries, please contact customer service.", {
          align: "center",
          width: 495,
        });

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
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: [600, 250], margin: 20 });
      const buffers: Buffer[] = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });

      // Generate barcode data
      const barcodeData = `M1${passData.passengerName.substring(0, 20).padEnd(20)}E${passData.bookingReference}${passData.originCode}${passData.destinationCode}${passData.flightNumber.padEnd(5)}${passData.sequence || "001"}`;
      const barcodeDataURL = await QRCode.toDataURL(barcodeData);

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
      doc.image(barcodeDataURL, 350, 50, { width: 200, height: 150 });

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
  const { getDb } = await import("../db");
  const { bookings, flights, airports, passengers, airlines } = await import(
    "../../drizzle/schema"
  );
  const { eq } = await import("drizzle-orm");

  const database = await getDb();
  if (!database) throw new Error("Database not available");

  // Get booking details
  const [booking] = await database
    .select({
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      cabinClass: bookings.cabinClass,
      totalAmount: bookings.totalAmount,
      flightNumber: flights.flightNumber,
      airlineId: flights.airlineId,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new Error("Booking not found");
  }

  // Get passenger details
  const [passenger] = await database
    .select()
    .from(passengers)
    .where(eq(passengers.id, passengerId))
    .limit(1);

  if (!passenger || passenger.bookingId !== bookingId) {
    throw new Error("Passenger not found");
  }

  // Get airport details
  const [origin] = await database
    .select()
    .from(airports)
    .where(eq(airports.id, booking.originId))
    .limit(1);

  const [destination] = await database
    .select()
    .from(airports)
    .where(eq(airports.id, booking.destinationId))
    .limit(1);

  if (!origin || !destination) {
    throw new Error("Airport not found");
  }

  // Get airline details
  const [airline] = await database
    .select()
    .from(airlines)
    .where(eq(airlines.id, booking.airlineId))
    .limit(1);

  const airlineName = airline?.name || "Unknown Airline";

  // Generate ticket number if not exists
  const ticketNumber = passenger.ticketNumber || generateTicketNumber();

  // Update passenger with ticket number
  if (!passenger.ticketNumber) {
    await database
      .update(passengers)
      .set({ ticketNumber })
      .where(eq(passengers.id, passenger.id));
  }

  // Generate PDF
  const pdfBuffer = await generateETicketPDF({
    passengerName: `${passenger.firstName} ${passenger.lastName}`,
    passengerType: passenger.type,
    ticketNumber,
    bookingReference: booking.bookingReference,
    pnr: booking.pnr,
    flightNumber: booking.flightNumber,
    airline: airlineName,
    origin: origin.city,
    originCode: origin.code,
    destination: destination.city,
    destinationCode: destination.code,
    departureTime: booking.departureTime,
    arrivalTime: booking.arrivalTime,
    cabinClass: booking.cabinClass,
    seatNumber: passenger.seatNumber || undefined,
    baggageAllowance:
      booking.cabinClass === "business" ? "2 × 32kg" : "1 × 23kg",
    totalAmount: booking.totalAmount,
    currency: "SAR",
    issueDate: new Date(),
  });

  // Return PDF as base64
  return pdfBuffer.toString("base64");
}
