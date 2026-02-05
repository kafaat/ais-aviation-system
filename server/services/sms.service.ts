/**
 * SMS Notification Service
 *
 * Handles sending SMS notifications to users
 * Supports multiple providers (Twilio, local gateway)
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { notificationHistory } from "../../drizzle/schema";

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
  flight_status: {
    id: "flight_status",
    nameAr: "حالة الرحلة",
    nameEn: "Flight Status",
    bodyAr: "تحديث الرحلة {flightNumber}: {status}. {message}",
    bodyEn: "Flight {flightNumber} update: {status}. {message}",
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
 * Send SMS notification
 */
export async function sendSMS(
  userId: number,
  phoneNumber: string,
  body: string,
  templateId?: string,
  bookingId?: number,
  flightId?: number
): Promise<SMSResult> {
  const provider = getSMSProvider();
  const formattedPhone = formatPhoneNumber(phoneNumber);

  const result = await provider.send({
    to: formattedPhone,
    body,
    templateId,
  });

  // Log to notification history
  try {
    const db = await getDb();
    if (db) {
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
    console.error("[SMS] Error logging to history:", error);
  }

  return result;
}

/**
 * Send templated SMS
 */
export async function sendTemplatedSMS(
  userId: number,
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

  return sendSMS(userId, phoneNumber, body, templateId, bookingId, flightId);
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
