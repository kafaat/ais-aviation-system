import { z } from "zod";
import { outputNumber } from "./primitives";

export const bagTagDocument = z.object({
  printStatus: z.literal("document_ready"),
  bagTags: z.array(
    z.object({
      tagNumber: z.string(),
      passengerName: z.string(),
      flightNumber: z.string(),
      origin: z.string(),
      destination: z.string(),
      bookingReference: z.string(),
      sequence: z.string(),
      barcodeData: z.string(),
      printedAt: z.null(),
    })
  ),
  totalBags: outputNumber,
  passengerName: z.string(),
});
