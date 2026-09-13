import { z } from "zod";

export const hotelStatus = z.enum([
  "reserved",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show",
  "requested",
  "pending_provider",
  "outcome_unknown",
  "confirmed",
  "sandbox_confirmed",
  "cancellation_pending",
  "cancellation_unknown",
  "rejected",
]);
export const hotelQuote = z.object({
  provider: z.literal("hotelbeds"),
  mode: z.enum(["sandbox", "live"]),
  account: z.string().min(1).max(64),
  hotelCode: z.number().int().positive(),
  roomCode: z.string().min(1).max(100),
  boardCode: z.enum(["RO", "BB"]),
  checkIn: z.string().date(),
  checkOut: z.string().date(),
  currency: z.literal("SAR"),
  totalCost: z.number().int().positive().max(2147483647),
  rateKey: z.string().min(1).max(2048),
  terms: z.string().min(1).max(20000),
  cancellationPolicies: z
    .array(
      z.object({
        from: z.string().datetime({ offset: true }),
        amount: z.number().int().nonnegative(),
      })
    )
    .max(30),
  expiresAt: z.string().datetime(),
});
export type HotelQuote = z.infer<typeof hotelQuote>;
export const hotelRequest = z.object({
  quote: hotelQuote,
  quoteId: z.string().uuid(),
  mappingEvidence: z.string().min(5).max(255),
  quotedBy: z.number().int().positive(),
  approvedBy: z.number().int().positive().nullable(),
  approvedAt: z.string().datetime().nullable(),
  holder: z.object({
    name: z.string().min(1).max(100),
    surname: z.string().min(1).max(100),
  }),
  maxCancellationCost: z.number().int().nonnegative().default(0),
});
export type HotelRequest = z.infer<typeof hotelRequest>;
export interface HotelReceipt {
  reference: string;
  clientReference: string;
  status: "CONFIRMED" | "CANCELLED";
  currency: "SAR";
  totalCost: number;
  cancellationCost: number | null;
  cancellationReference: string | null;
}

export function hotelStatusLabel(status: string, arabic = false): string {
  const labels: Record<string, [string, string]> = {
    reserved: [
      "Legacy reservation — confirmation unverified",
      "حجز قديم — التأكيد غير متحقق",
    ],
    requested: [
      "Awaiting hotel quote and approval",
      "بانتظار عرض الفندق واعتماده",
    ],
    pending_provider: ["Awaiting provider", "بانتظار المزوّد"],
    outcome_unknown: [
      "Provider outcome unknown — reconciling",
      "نتيجة المزوّد غير معروفة — تجري المصالحة",
    ],
    confirmed: ["Provider confirmed", "مؤكد من المزوّد"],
    sandbox_confirmed: [
      "Sandbox only — no hotel reservation",
      "اختبار فقط — لا يوجد حجز فندقي فعلي",
    ],
    cancellation_pending: ["Cancellation requested", "طُلب الإلغاء"],
    cancellation_unknown: [
      "Cancellation outcome unknown",
      "نتيجة الإلغاء غير معروفة",
    ],
    rejected: [
      "Quote expired or rejected — review required",
      "العرض منتهي أو مرفوض — يحتاج مراجعة",
    ],
    cancelled: ["Cancelled", "ملغى"],
    checked_in: ["Checked in", "تم تسجيل الدخول"],
    checked_out: ["Checked out", "تم تسجيل الخروج"],
    no_show: ["No show", "لم يحضر"],
  };
  return (
    labels[status]?.[arabic ? 1 : 0] ??
    (arabic ? "حالة غير معروفة" : "Unknown status")
  );
}
