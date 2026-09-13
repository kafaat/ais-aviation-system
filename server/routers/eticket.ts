import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { responseContracts } from "../contracts/eticket";
import {
  generateETicketPDF,
  generateBoardingPassPDF,
} from "../services/eticket.service";
import { readTicketDocument } from "../services/ticket-documents.service";
import {
  issueBoardingPass,
  verifyActiveBoardingPass,
} from "../services/boarding-pass.service";
import { getDb } from "../db";
import { bookings, passengers } from "../../drizzle/schema";
const documentInput = z.object({
  bookingId: z.number().int().positive(),
  passengerId: z.number().int().positive(),
});
const calendarDate = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
const calendarText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, "\\$&");
export const eticketRouter = router({
  generateETicket: protectedProcedure
    .input(documentInput)
    .output(responseContracts.generateETicket)
    .mutation(async ({ ctx, input }) => {
      const { data } = await readTicketDocument(
        input.bookingId,
        input.passengerId,
        ctx.user.id
      );
      return {
        pdf: (await generateETicketPDF(data)).toString("base64"),
        ticketNumber: data.ticketNumber,
        filename: `itinerary_${input.bookingId}_${input.passengerId}.pdf`,
      };
    }),
  generateBoardingPass: protectedProcedure
    .input(
      documentInput.extend({ flightId: z.number().int().positive().optional() })
    )
    .output(responseContracts.generateBoardingPass)
    .mutation(async ({ ctx, input }) => {
      const issued = await issueBoardingPass(input, { userId: ctx.user.id });
      const document = await readTicketDocument(
        input.bookingId,
        input.passengerId,
        ctx.user.id
      );
      const leg = document.legs.find(
        l => l.flightId === issued.payload.flightId
      );
      if (!leg || !(await verifyActiveBoardingPass(issued.token)).valid)
        throw new Error("Boarding document changed; issue again");
      const pdf = await generateBoardingPassPDF({
        ...leg,
        signedToken: issued.token,
        passengerName: issued.payload.passengerName,
        seatNumber: issued.payload.seatNumber,
        departureTime: new Date(issued.payload.departureTime),
        sequence: String(issued.payload.sequence),
      });
      return {
        pdf: pdf.toString("base64"),
        ticketNumber: leg.ticketNumber,
        filename: `boarding_${input.bookingId}_${input.passengerId}_${issued.payload.flightId}.pdf`,
      };
    }),
  generateCalendarEvent: protectedProcedure
    .input(z.object({ bookingId: z.number().int().positive() }))
    .output(responseContracts.generateCalendarEvent)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (!db) throw new Error("Database unavailable");
      const [p] = await db
        .select({ id: passengers.id })
        .from(passengers)
        .innerJoin(bookings, eq(bookings.id, passengers.bookingId))
        .where(
          and(
            eq(bookings.id, input.bookingId),
            eq(bookings.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!p) throw new Error("Booking passenger not found");
      const { legs } = await readTicketDocument(
        input.bookingId,
        p.id,
        ctx.user.id
      );
      const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//AIS Aviation System//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
      ];
      for (const leg of legs)
        lines.push(
          "BEGIN:VEVENT",
          `UID:${input.bookingId}-${leg.flightId}@ais-aviation`,
          `DTSTAMP:${calendarDate(new Date())}`,
          `DTSTART:${calendarDate(leg.departureTime)}`,
          `DTEND:${calendarDate(leg.arrivalTime)}`,
          `SUMMARY:${calendarText(`${leg.flightNumber}: ${leg.originCode} to ${leg.destinationCode}`)}`,
          `DESCRIPTION:${calendarText(`Booking ${leg.bookingReference}; ${leg.airline}; ${leg.cabinClass}`)}`,
          `LOCATION:${calendarText(`${leg.origin} (${leg.originCode})`)}`,
          "STATUS:CONFIRMED",
          "END:VEVENT"
        );
      lines.push("END:VCALENDAR", "");
      return {
        ics: Buffer.from(lines.join("\r\n")).toString("base64"),
        filename: `itinerary_${input.bookingId}.ics`,
      };
    }),
});
