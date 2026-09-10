// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";

export const responseContracts = {
  generateETicket: z.object({
    pdf: z.string(),
    ticketNumber: z.string(),
    filename: z.string(),
  }),
  generateBoardingPass: z.object({
    pdf: z.string(),
    ticketNumber: z.string(),
    filename: z.string(),
  }),
  generateCalendarEvent: z.object({ ics: z.string(), filename: z.string() }),
};
