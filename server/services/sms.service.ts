/**
 * SMS Notification Service
 *
 * Handles sending SMS notifications to users
 * Supports multiple providers (Twilio, local gateway)
 */

import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { getDb } from "../db";
import { notificationHistory, smsLogs } from "../../drizzle/schema";
import type { SMSLog } from "../../drizzle/schema";

// ============================================================================
// Types
// ============================================================================

export interface SMSMessage {
  to: string;
  body: string;
  templateId?: string;
}

export interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface SMSTemplate {
  id: string;
  nameAr: string;
  nameEn: string;
  bodyAr: string;
  bodyEn: string;
}

// ============================================================================
// Templates
// ============================================================================

export const SMS_TEMPLATES: Record<string, SMSTemplate> = {
  booking_confirmation: {
    id: "booking_confirmation",
    nameAr: "تأكيد الحجز",
    nameEn: "Booking Confirmation",
    bodyAr:
      "تم تأكيد حجزك رقم {bookingRef}. رحلة {flightNumber} في {date}. شكراً لاختيارك AIS.",
    bodyEn:
      "Your booking {bookingRef} is confirmed. Flight {flightNumber} on {date}. Thank you for choosing AIS.",
  },
  check_in_reminder: {
    id: "check_in_reminder",
    nameAr: "تذكير بتسجيل الوصول",
    nameEn: "Check-in Reminder",
    bodyAr:
      "تذكير: يمكنك الآن تسجيل الوصول لرحلتك {flightNumber} المغادرة في {date}.",
    bodyEn:
      "Reminder: Check-in is now open for flight {flightNumber} departing on {date}.",
  },
  flight_reminder: {
    id: "flight_reminder",
    nameAr: "تذكير بالرحلة",
    nameEn: "Flight Reminder",
    bodyAr:
      "تذكير: رحلتك {flightNumber} من {origin} إلى {destination} غداً في {time}. رقم الحجز: {bookingRef}.",
    bodyEn:
      "Reminder: Your flight {flightNumber} from {origin} to {destination} departs tomorrow at {time}. Booking: {bookingRef}.",
  },
  flight_status: {
    id: "flight_status",
    nameAr: "حالة الرحلة",
    nameEn: "Flight Status",
    bodyAr: "تحديث الرحلة {flightNumber}: {status}. {message}",
    bodyEn: "Flight {flightNumber} update: {status}. {message}",
  },
  boarding_pass: {
    id: "boarding_pass",
    nameAr: "بطاقة الصعود",
    nameEn: "Boarding Pass",
    bodyAr:
      "بطاقة صعودك لرحلة {flightNumber}: البوابة {gate}، المقعد {seat}، وقت الصعود {boardingTime}. رقم الحجز: {bookingRef}.",
    bodyEn:
      "Your boarding pass for {flightNumber}: Gate {gate}, Seat {seat}, Boarding at {boardingTime}. Booking: {bookingRef}.",
  },
  payment_received: {
    id: "payment_received",
    nameAr: "تم استلام الدفع",
    nameEn: "Payment Received",
    bodyAr: "تم استلام دفعتك بمبلغ {amount} ريال للحجز {bookingRef}.",
    bodyEn: "Payment of {amount} SAR received for booking {bookingRef}.",
  },
  refund_processed: {
    id: "refund_processed",
    nameAr: "تم معالجة الاسترداد",
    nameEn: "Refund Processed",
    bodyAr:
      "تم استرداد {amount} ريال للحجز {bookingRef}. سيظهر في حسابك خلال 5-10 أيام عمل.",
    bodyEn:
      "Refund of {amount} SAR processed for {bookingRef}. Will appear in your account within 5-10 business days.",
  },
  loyalty_milestone: {
    id: "loyalty_milestone",
    nameAr: "إنجاز الولاء",
    nameEn: "Loyalty Milestone",
    bodyAr:
      "مبروك! لقد وصلت إلى مستوى {tier} في برنامج الولاء. رصيدك الحالي: {miles} ميل.",
    bodyEn:
      "Congratulations! You've reached {tier} tier. Current balance: {miles} miles.",
  },
};

// ============================================================================
// SMS Provider Interface
// ============================================================================

interface SMSProvider {
  send(message: SMSMessage): Promise<SMSResult>;
}

// ============================================================================
// Mock SMS Provider (for development/testing)
// ============================================================================

class MockSMSProvider implements SMSProvider {
  async send(message: SMSMessage): Promise<SMSResult> {
    console.info(`[MockSMS] Sending to ${message.to}:`, message.body);

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));

    // Simulate success (95% of the time)
    if (Math.random() > 0.05) {
      return {
        success: true,
        messageId: `mock_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      };
    }

    return {
      success: false,
      error: "Mock delivery failure",
    };
  }
}

// ============================================================================
// Twilio SMS Provider
// ============================================================================

class TwilioSMSProvider implements SMSProvider {
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;

  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID || "";
    this.authToken = process.env.TWILIO_AUTH_TOKEN || "";
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || "";
  }

  async send(message: SMSMessage): Promise<SMSResult> {
    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      console.warn("[TwilioSMS] Missing credentials, using mock provider");
      return new MockSMSProvider().send(message);
    }

    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
          },
          body: new URLSearchParams({
            To: message.to,
            From: this.fromNumber,
            Body: message.body,
          }),
        }
      );

      const data = await response.json();

      if (response.ok) {
        return {
          success: true,
          messageId: data.sid,
        };
      }

      return {
        success: false,
        error: data.message || "Twilio API error",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

// ============================================================================
// SMS Service Functions
// ============================================================================

/**
 * Get SMS provider based on configuration
 */
function getSMSProvider(): SMSProvider {
  if (process.env.SMS_PROVIDER === "twilio") {
    return new TwilioSMSProvider();
  }
  return new MockSMSProvider();
}

/**
 * Format phone number to E.164 format
 */
export function formatPhoneNumber(
  phone: string,
  countryCode: string = "+966"
): string {
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, "");

  // If starts with 0, remove it
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.slice(1);
  }

  // If doesn't start with country code, add it
  if (!cleaned.startsWith(countryCode.replace("+", ""))) {
    cleaned = countryCode.replace("+", "") + cleaned;
  }

  return "+" + cleaned;
}

/**
 * Get the current SMS provider name
 */
function getProviderName(): string {
  return process.env.SMS_PROVIDER === "twilio" ? "twilio" : "mock";
}

/**
 * SMS Log type for filtering
 */
export type SMSType =
  | "booking_confirmation"
  | "flight_reminder"
  | "flight_status"
  | "boarding_pass"
  | "check_in_reminder"
  | "payment_received"
  | "refund_processed"
  | "loyalty_update"
  | "promotional"
  | "system";

/**
 * Send SMS notification
 */
export async function sendSMS(
  userId: number | null,
  phoneNumber: string,
  body: string,
  type: SMSType = "system",
  templateId?: string,
  bookingId?: number,
  flightId?: number
): Promise<SMSResult> {
  const provider = getSMSProvider();
  const providerName = getProviderName();
  const formattedPhone = formatPhoneNumber(phoneNumber);

  const result = await provider.send({
    to: formattedPhone,
    body,
    templateId,
  });

  // Log to sms_logs table
  try {
    const db = await getDb();
    if (db) {
      await db.insert(smsLogs).values({
        userId: userId ?? undefined,
        phoneNumber: formattedPhone,
        message: body,
        type,
        status: result.success ? "sent" : "failed",
        provider: providerName,
        providerMessageId: result.messageId,
        errorMessage: result.error,
        templateId,
        bookingId,
        flightId,
        sentAt: result.success ? new Date() : undefined,
      });
    }
  } catch (error) {
    console.error("[SMS] Error logging to sms_logs:", error);
  }

  // Also log to notification history for backward compatibility
  try {
    const db = await getDb();
    if (db && userId) {
      await db.insert(notificationHistory).values({
        userId,
        type: templateId
          ? (templateId as
              | "booking_confirmation"
              | "flight_status"
              | "check_in_reminder"
              | "price_alert"
              | "loyalty_update"
              | "refund_status"
              | "promotional"
              | "system")
          : "system",
        channel: "sms",
        recipientAddress: formattedPhone,
        content: body,
        templateId,
        status: result.success ? "sent" : "failed",
        sentAt: result.success ? new Date() : undefined,
        errorMessage: result.error,
        bookingId,
        flightId,
        providerMessageId: result.messageId,
      });
    }
  } catch (error) {
    console.error("[SMS] Error logging to notification history:", error);
  }

  return result;
}

/**
 * Send templated SMS
 */
export async function sendTemplatedSMS(
  userId: number | null,
  phoneNumber: string,
  templateId: keyof typeof SMS_TEMPLATES,
  variables: Record<string, string>,
  language: "ar" | "en" = "ar",
  bookingId?: number,
  flightId?: number
): Promise<SMSResult> {
  const template = SMS_TEMPLATES[templateId];
  if (!template) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unknown SMS template: ${templateId}`,
    });
  }

  // Get body in correct language
  let body = language === "ar" ? template.bodyAr : template.bodyEn;

  // Replace variables
  Object.entries(variables).forEach(([key, value]) => {
    body = body.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  });

  // Map template ID to SMS type
  const typeMap: Record<string, SMSType> = {
    booking_confirmation: "booking_confirmation",
    check_in_reminder: "check_in_reminder",
    flight_reminder: "flight_reminder",
    flight_status: "flight_status",
    boarding_pass: "boarding_pass",
    payment_received: "payment_received",
    refund_processed: "refund_processed",
    loyalty_milestone: "loyalty_update",
  };

  const smsType: SMSType = typeMap[templateId] || "system";

  return sendSMS(
    userId,
    phoneNumber,
    body,
    smsType,
    templateId,
    bookingId,
    flightId
  );
}

/**
 * Send booking confirmation SMS
 */
export async function sendBookingConfirmationSMS(
  userId: number,
  phoneNumber: string,
  bookingRef: string,
  flightNumber: string,
  date: string,
  language: "ar" | "en" = "ar",
  bookingId?: number
): Promise<SMSResult> {
  return sendTemplatedSMS(
    userId,
    phoneNumber,
    "booking_confirmation",
    { bookingRef, flightNumber, date },
    language,
    bookingId
  );
}

/**
 * Send check-in reminder SMS
 */
export async function sendCheckInReminderSMS(
  userId: number,
  phoneNumber: string,
  flightNumber: string,
  date: string,
  language: "ar" | "en" = "ar",
  bookingId?: number,
  flightId?: number
): Promise<SMSResult> {
  return sendTemplatedSMS(
    userId,
    phoneNumber,
    "check_in_reminder",
    { flightNumber, date },
    language,
    bookingId,
    flightId
  );
}

/**
 * Send flight status update SMS
 */
export async function sendFlightStatusSMS(
  userId: number,
  phoneNumber: string,
  flightNumber: string,
  status: string,
  message: string,
  language: "ar" | "en" = "ar",
  flightId?: number
): Promise<SMSResult> {
  return sendTemplatedSMS(
    userId,
    phoneNumber,
    "flight_status",
    { flightNumber, status, message },
    language,
    undefined,
    flightId
  );
}

/**
 * Send payment confirmation SMS
 */
export async function sendPaymentReceivedSMS(
  userId: number,
  phoneNumber: string,
  amount: string,
  bookingRef: string,
  language: "ar" | "en" = "ar",
  bookingId?: number
): Promise<SMSResult> {
  return sendTemplatedSMS(
    userId,
    phoneNumber,
    "payment_received",
    { amount, bookingRef },
    language,
    bookingId
  );
}

/**
 * Bulk send SMS to multiple recipients
 */
export async function sendBulkSMS(
  messages: Array<{
    userId: number;
    phoneNumber: string;
    body: string;
    bookingId?: number;
  }>
): Promise<{ sent: number; failed: number; results: SMSResult[] }> {
  const results: SMSResult[] = [];
  let sent = 0;
  let failed = 0;

  for (const msg of messages) {
    const result = await sendSMS(
      msg.userId,
      msg.phoneNumber,
      msg.body,
      "system",
      undefined,
      msg.bookingId
    );
    results.push(result);
    if (result.success) {
      sent++;
    } else {
      failed++;
    }

    // Rate limiting: wait 100ms between messages
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { sent, failed, results };
}

// ============================================================================
// Flight Reminder & Boarding Pass Functions
// ============================================================================

/**
 * Send flight reminder SMS (24 hours before departure)
 */
export async function sendFlightReminderSMS(
  userId: number,
  phoneNumber: string,
  flightNumber: string,
  origin: string,
  destination: string,
  departureTime: string,
  bookingRef: string,
  language: "ar" | "en" = "ar",
  bookingId?: number,
  flightId?: number
): Promise<SMSResult> {
  return sendTemplatedSMS(
    userId,
    phoneNumber,
    "flight_reminder",
    {
      flightNumber,
      origin,
      destination,
      time: departureTime,
      bookingRef,
    },
    language,
    bookingId,
    flightId
  );
}

/**
 * Send boarding pass SMS
 */
export async function sendBoardingPassSMS(
  userId: number,
  phoneNumber: string,
  flightNumber: string,
  gate: string,
  seat: string,
  boardingTime: string,
  bookingRef: string,
  language: "ar" | "en" = "ar",
  bookingId?: number,
  flightId?: number
): Promise<SMSResult> {
  return sendTemplatedSMS(
    userId,
    phoneNumber,
    "boarding_pass",
    {
      flightNumber,
      gate,
      seat,
      boardingTime,
      bookingRef,
    },
    language,
    bookingId,
    flightId
  );
}

/**
 * Send refund processed SMS
 */
export async function sendRefundProcessedSMS(
  userId: number,
  phoneNumber: string,
  amount: string,
  bookingRef: string,
  language: "ar" | "en" = "ar",
  bookingId?: number
): Promise<SMSResult> {
  return sendTemplatedSMS(
    userId,
    phoneNumber,
    "refund_processed",
    { amount, bookingRef },
    language,
    bookingId
  );
}

/**
 * Send loyalty milestone SMS
 */
export async function sendLoyaltyMilestoneSMS(
  userId: number,
  phoneNumber: string,
  tier: string,
  miles: string,
  language: "ar" | "en" = "ar"
): Promise<SMSResult> {
  return sendTemplatedSMS(
    userId,
    phoneNumber,
    "loyalty_milestone",
    { tier, miles },
    language
  );
}

// ============================================================================
// SMS Logs Query Functions
// ============================================================================

/**
 * Options for fetching SMS logs
 */
export interface GetSMSLogsOptions {
  limit?: number;
  offset?: number;
  type?: SMSType;
  status?: "pending" | "sent" | "delivered" | "failed" | "rejected";
  startDate?: Date;
  endDate?: Date;
}

/**
 * Get SMS logs for a specific user
 */
export async function getSMSLogs(
  userId: number,
  options: GetSMSLogsOptions = {}
): Promise<SMSLog[]> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const { limit = 50, offset = 0, type, status, startDate, endDate } = options;

    // Build conditions
    const conditions = [eq(smsLogs.userId, userId)];

    if (type) {
      conditions.push(eq(smsLogs.type, type));
    }

    if (status) {
      conditions.push(eq(smsLogs.status, status));
    }

    if (startDate) {
      conditions.push(sql`${smsLogs.createdAt} >= ${startDate}`);
    }

    if (endDate) {
      conditions.push(sql`${smsLogs.createdAt} <= ${endDate}`);
    }

    const results = await db
      .select()
      .from(smsLogs)
      .where(and(...conditions))
      .orderBy(desc(smsLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return results;
  } catch (error) {
    console.error("[SMS] Error fetching SMS logs:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to fetch SMS logs",
    });
  }
}

/**
 * Get all SMS logs (admin function)
 */
export async function getAllSMSLogs(
  options: GetSMSLogsOptions = {}
): Promise<{ logs: SMSLog[]; total: number }> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const { limit = 50, offset = 0, type, status, startDate, endDate } = options;

    // Build conditions
    const conditions: ReturnType<typeof eq>[] = [];

    if (type) {
      conditions.push(eq(smsLogs.type, type));
    }

    if (status) {
      conditions.push(eq(smsLogs.status, status));
    }

    if (startDate) {
      conditions.push(sql`${smsLogs.createdAt} >= ${startDate}` as any);
    }

    if (endDate) {
      conditions.push(sql`${smsLogs.createdAt} <= ${endDate}` as any);
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    // Get logs
    const logs = await db
      .select()
      .from(smsLogs)
      .where(whereClause)
      .orderBy(desc(smsLogs.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [countResult] = await db
      .select({ count: count() })
      .from(smsLogs)
      .where(whereClause);

    return {
      logs,
      total: countResult?.count ?? 0,
    };
  } catch (error) {
    console.error("[SMS] Error fetching all SMS logs:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to fetch SMS logs",
    });
  }
}

/**
 * Get SMS statistics (admin function)
 */
export async function getSMSStats(): Promise<{
  totalSent: number;
  totalFailed: number;
  totalPending: number;
  byType: Record<string, number>;
  byProvider: Record<string, number>;
  todaySent: number;
}> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Get total counts by status
    const statusCounts = await db
      .select({
        status: smsLogs.status,
        count: count(),
      })
      .from(smsLogs)
      .groupBy(smsLogs.status);

    // Get counts by type
    const typeCounts = await db
      .select({
        type: smsLogs.type,
        count: count(),
      })
      .from(smsLogs)
      .groupBy(smsLogs.type);

    // Get counts by provider
    const providerCounts = await db
      .select({
        provider: smsLogs.provider,
        count: count(),
      })
      .from(smsLogs)
      .groupBy(smsLogs.provider);

    // Get today's sent count
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayResult] = await db
      .select({ count: count() })
      .from(smsLogs)
      .where(
        and(
          eq(smsLogs.status, "sent"),
          sql`${smsLogs.createdAt} >= ${today}`
        )
      );

    // Process results
    const statusMap = Object.fromEntries(
      statusCounts.map(r => [r.status, r.count])
    );
    const typeMap = Object.fromEntries(
      typeCounts.map(r => [r.type, r.count])
    );
    const providerMap = Object.fromEntries(
      providerCounts.map(r => [r.provider, r.count])
    );

    return {
      totalSent: statusMap["sent"] ?? 0,
      totalFailed: statusMap["failed"] ?? 0,
      totalPending: statusMap["pending"] ?? 0,
      byType: typeMap,
      byProvider: providerMap,
      todaySent: todayResult?.count ?? 0,
    };
  } catch (error) {
    console.error("[SMS] Error fetching SMS stats:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to fetch SMS statistics",
    });
  }
}

/**
 * Resend a failed SMS
 */
export async function resendSMS(logId: number): Promise<SMSResult> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Get the original log
    const [log] = await db
      .select()
      .from(smsLogs)
      .where(eq(smsLogs.id, logId))
      .limit(1);

    if (!log) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "SMS log not found",
      });
    }

    if (log.status === "sent" || log.status === "delivered") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "SMS was already delivered",
      });
    }

    // Update retry count
    await db
      .update(smsLogs)
      .set({
        retryCount: (log.retryCount ?? 0) + 1,
        status: "pending",
      })
      .where(eq(smsLogs.id, logId));

    // Resend
    const result = await sendSMS(
      log.userId,
      log.phoneNumber,
      log.message,
      log.type,
      log.templateId ?? undefined,
      log.bookingId ?? undefined,
      log.flightId ?? undefined
    );

    return result;
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("[SMS] Error resending SMS:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to resend SMS",
    });
  }
}
