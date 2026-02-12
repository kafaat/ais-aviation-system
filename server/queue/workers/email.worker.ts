/**
 * Email Worker - Production Grade
 *
 * BullMQ worker that processes email sending jobs.
 * ✅ يستخدم email.service.ts الفعلي بدلاً من mock
 *
 * التحسينات:
 * 1. استخدام email.service.ts الموجود
 * 2. Structured logging
 * 3. Proper error handling with retry
 * 4. Job progress tracking
 */

import { Worker, Job } from "bullmq";
import { getRedisConnection, emailQueue } from "../queues";
import {
  sendBookingConfirmation,
  sendFlightStatusChange,
  sendRefundConfirmation,
  sendNotificationEmail,
  type BookingConfirmationData,
  type FlightStatusChangeData,
  type RefundConfirmationData,
} from "../../services/email.service";

// ============================================================================
// PII Helpers
// ============================================================================

/** Redact an email address for safe logging: "user@example.com" -> "u***@example.com" */
function redactEmail(email: string): string {
  if (email.includes("@")) {
    return email[0] + "***@" + email.split("@")[1];
  }
  return "[REDACTED]";
}

// ============================================================================
// Worker Configuration
// ============================================================================

const WORKER_CONFIG = {
  name: "email",
  concurrency: 5,
};

// ============================================================================
// Logger - Structured JSON
// ============================================================================

function log(
  level: "info" | "warn" | "error",
  message: string,
  context: Record<string, unknown> = {}
) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    service: "email-worker",
    message,
    ...context,
  };

  if (level === "error") {
    console.error(JSON.stringify(logEntry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(logEntry));
  } else {
    console.info(JSON.stringify(logEntry));
  }
}

// ============================================================================
// Job Types
// ============================================================================

type EmailJobType =
  | "booking_confirmation"
  | "booking_cancellation"
  | "payment_receipt"
  | "flight_reminder"
  | "flight_status_change"
  | "refund_confirmation"
  | "password_reset"
  | "welcome";

interface EmailJobData {
  type: EmailJobType;
  to: string;
  subject: string;
  templateData: Record<string, unknown>;
  userId?: number;
  bookingId?: number;
  correlationId?: string;
}

// ============================================================================
// Email Sending - Using Real Service
// ============================================================================

/**
 * ✅ يستخدم email.service.ts الفعلي
 */
async function processEmailJob(
  job: Job<EmailJobData>
): Promise<{ success: boolean; sentAt: string }> {
  const { type, to, templateData, correlationId } = job.data;

  // Redact email address in logs to protect PII
  const redactedTo = redactEmail(to);

  log("info", `Processing email job`, {
    jobId: job.id,
    type,
    to: redactedTo,
    correlationId,
  });

  try {
    let success = false;

    switch (type) {
      case "booking_confirmation": {
        const data: BookingConfirmationData = {
          passengerName: templateData.passengerName as string,
          passengerEmail: to,
          bookingReference: templateData.bookingReference as string,
          pnr:
            (templateData.pnr as string) ||
            (templateData.bookingReference as string),
          flightNumber: templateData.flightNumber as string,
          origin: templateData.origin as string,
          destination: templateData.destination as string,
          departureTime: new Date(
            (templateData.departureTime as string) ||
              (templateData.departureDate as string)
          ),
          arrivalTime: new Date(
            (templateData.arrivalTime as string) ||
              (templateData.departureTime as string)
          ),
          cabinClass: (templateData.cabinClass as string) || "economy",
          numberOfPassengers: (templateData.numberOfPassengers as number) || 1,
          totalAmount: (templateData.totalAmount as number) || 0,
          attachments:
            templateData.attachments as BookingConfirmationData["attachments"],
        };
        success = await sendBookingConfirmation(data);
        break;
      }

      case "flight_status_change": {
        const data: FlightStatusChangeData = {
          passengerName: templateData.passengerName as string,
          passengerEmail: to,
          bookingReference: templateData.bookingReference as string,
          flightNumber: templateData.flightNumber as string,
          origin: templateData.origin as string,
          destination: templateData.destination as string,
          departureTime: new Date(templateData.departureTime as string),
          oldStatus: templateData.oldStatus as string,
          newStatus: templateData.newStatus as string,
          delayMinutes: templateData.delayMinutes as number,
          reason: templateData.reason as string,
        };
        success = await sendFlightStatusChange(data);
        break;
      }

      case "refund_confirmation":
      case "booking_cancellation": {
        const data: RefundConfirmationData = {
          passengerName: templateData.passengerName as string,
          passengerEmail: to,
          bookingReference: templateData.bookingReference as string,
          flightNumber: (templateData.flightNumber as string) || "",
          refundAmount: (templateData.refundAmount as number) || 0,
          refundReason: templateData.refundReason as string,
          processingDays: (templateData.processingDays as number) || 5,
        };
        success = await sendRefundConfirmation(data);
        break;
      }

      case "flight_reminder": {
        const reminderData: BookingConfirmationData = {
          passengerName: templateData.passengerName as string,
          passengerEmail: to,
          bookingReference: (templateData.bookingReference as string) || "",
          pnr: (templateData.pnr as string) || "",
          flightNumber: templateData.flightNumber as string,
          origin: templateData.origin as string,
          destination: templateData.destination as string,
          departureTime: new Date(templateData.departureTime as string),
          arrivalTime: new Date(
            (templateData.arrivalTime as string) ||
              (templateData.departureTime as string)
          ),
          cabinClass: (templateData.cabinClass as string) || "economy",
          numberOfPassengers: (templateData.numberOfPassengers as number) || 1,
          totalAmount: (templateData.totalAmount as number) || 0,
        };
        success = await sendBookingConfirmation(reminderData);
        break;
      }

      case "payment_receipt": {
        const receiptData: BookingConfirmationData = {
          passengerName: templateData.passengerName as string,
          passengerEmail: to,
          bookingReference: (templateData.bookingReference as string) || "",
          pnr:
            (templateData.pnr as string) ||
            (templateData.bookingReference as string) ||
            "",
          flightNumber: (templateData.flightNumber as string) || "",
          origin: (templateData.origin as string) || "",
          destination: (templateData.destination as string) || "",
          departureTime: new Date(
            (templateData.departureTime as string) || new Date()
          ),
          arrivalTime: new Date(
            (templateData.arrivalTime as string) ||
              (templateData.departureTime as string) ||
              new Date()
          ),
          cabinClass: (templateData.cabinClass as string) || "economy",
          numberOfPassengers: (templateData.numberOfPassengers as number) || 1,
          totalAmount: (templateData.totalAmount as number) || 0,
        };
        success = await sendBookingConfirmation(receiptData);
        break;
      }

      case "password_reset":
      case "welcome":
      default: {
        // Generic email types handled via sendNotificationEmail.
        // password_reset and welcome will use the generic notification template;
        // dedicated templates require SMTP/provider integration beyond current scope.
        log("info", `Sending generic notification email for type: ${type}`, {
          jobId: job.id,
          type,
        });
        const message =
          (templateData.message as string) ||
          (templateData.body as string) ||
          job.data.subject;
        success = await sendNotificationEmail(to, job.data.subject, message);
        break;
      }
    }

    if (!success) {
      throw new Error(`Failed to send ${type} email`);
    }

    log("info", `Email sent successfully`, {
      jobId: job.id,
      type,
      to: redactedTo,
    });

    return { success: true, sentAt: new Date().toISOString() };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    log("error", `Failed to send email`, {
      jobId: job.id,
      type,
      to: redactedTo,
      error: errorMessage,
    });

    throw error;
  }
}

// ============================================================================
// Worker Definition
// ============================================================================

let workerInstance: Worker<EmailJobData> | null = null;

export function getEmailWorker(): Worker<EmailJobData> {
  if (workerInstance) {
    return workerInstance;
  }

  const connection = getRedisConnection();
  if (!connection) {
    throw new Error("Redis connection required for email worker");
  }

  workerInstance = new Worker<EmailJobData>(
    WORKER_CONFIG.name,
    processEmailJob,
    {
      connection,
      concurrency: WORKER_CONFIG.concurrency,
    }
  );

  // Event Handlers
  workerInstance.on("completed", job => {
    log("info", `Job completed`, { jobId: job.id, type: job.data.type });
  });

  workerInstance.on("failed", (job, error) => {
    log("error", `Job failed`, {
      jobId: job?.id,
      type: job?.data.type,
      error: error.message,
      attemptsMade: job?.attemptsMade,
    });
  });

  workerInstance.on("error", error => {
    log("error", `Worker error`, { error: error.message });
  });

  return workerInstance;
}

// Legacy export for backward compatibility
export const emailWorker = {
  get instance() {
    return getEmailWorker();
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Queue a booking confirmation email
 */
export async function queueBookingConfirmationEmail(data: {
  to: string;
  bookingReference: string;
  passengerName: string;
  flightNumber: string;
  departureDate?: string;
  departureTime?: string;
  arrivalTime?: string;
  origin: string;
  destination: string;
  cabinClass?: string;
  numberOfPassengers?: number;
  totalAmount?: number;
  pnr?: string;
  userId?: number;
  bookingId?: number;
  correlationId?: string;
}): Promise<string | null> {
  const queue = emailQueue;
  if (!queue) {
    log("warn", "Email queue not available, skipping email", {
      to: redactEmail(data.to),
    });
    return null;
  }

  const job = await queue.add(
    "booking_confirmation",
    {
      type: "booking_confirmation",
      to: data.to,
      subject: `تأكيد الحجز - ${data.bookingReference}`,
      templateData: data,
      userId: data.userId,
      bookingId: data.bookingId,
      correlationId: data.correlationId,
    },
    {
      priority: 2,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    }
  );

  log("info", "Queued booking confirmation email", {
    jobId: job.id,
    to: redactEmail(data.to),
    bookingReference: data.bookingReference,
  });

  return job.id ?? null;
}

/**
 * Queue a booking cancellation email
 */
export async function queueBookingCancellationEmail(data: {
  to: string;
  bookingReference: string;
  passengerName: string;
  flightNumber?: string;
  refundAmount?: number;
  currency?: string;
  refundReason?: string;
  userId?: number;
  bookingId?: number;
  correlationId?: string;
}): Promise<string | null> {
  const queue = emailQueue;
  if (!queue) {
    log("warn", "Email queue not available, skipping email", {
      to: redactEmail(data.to),
    });
    return null;
  }

  const job = await queue.add(
    "booking_cancellation",
    {
      type: "booking_cancellation",
      to: data.to,
      subject: `إلغاء الحجز - ${data.bookingReference}`,
      templateData: {
        ...data,
        processingDays: 5,
      },
      userId: data.userId,
      bookingId: data.bookingId,
      correlationId: data.correlationId,
    },
    {
      priority: 2,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    }
  );

  log("info", "Queued booking cancellation email", {
    jobId: job.id,
    to: redactEmail(data.to),
    bookingReference: data.bookingReference,
  });

  return job.id ?? null;
}

/**
 * Queue a flight status change email
 */
export async function queueFlightStatusChangeEmail(data: {
  to: string;
  passengerName: string;
  bookingReference: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureTime: string;
  oldStatus: string;
  newStatus: string;
  delayMinutes?: number;
  reason?: string;
  correlationId?: string;
}): Promise<string | null> {
  const queue = emailQueue;
  if (!queue) {
    log("warn", "Email queue not available, skipping email", {
      to: redactEmail(data.to),
    });
    return null;
  }

  const job = await queue.add(
    "flight_status_change",
    {
      type: "flight_status_change",
      to: data.to,
      subject: `تحديث حالة الرحلة - ${data.flightNumber}`,
      templateData: data,
      correlationId: data.correlationId,
    },
    {
      priority: 1, // High priority for status changes
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    }
  );

  log("info", "Queued flight status change email", {
    jobId: job.id,
    to: redactEmail(data.to),
    flightNumber: data.flightNumber,
    newStatus: data.newStatus,
  });

  return job.id ?? null;
}

/**
 * Queue a flight reminder email
 */
export async function queueFlightReminderEmail(data: {
  to: string;
  passengerName: string;
  flightNumber: string;
  departureTime: string;
  origin: string;
  destination: string;
  correlationId?: string;
}): Promise<string | null> {
  const queue = emailQueue;
  if (!queue) {
    log("warn", "Email queue not available, skipping email", {
      to: redactEmail(data.to),
    });
    return null;
  }

  const job = await queue.add(
    "flight_reminder",
    {
      type: "flight_reminder",
      to: data.to,
      subject: `تذكير بالرحلة - ${data.flightNumber}`,
      templateData: data,
      correlationId: data.correlationId,
    },
    {
      priority: 3,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    }
  );

  log("info", "Queued flight reminder email", {
    jobId: job.id,
    to: redactEmail(data.to),
    flightNumber: data.flightNumber,
  });

  return job.id ?? null;
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

export async function closeEmailWorker(): Promise<void> {
  if (workerInstance) {
    log("info", "Closing email worker...");
    await workerInstance.close();
    workerInstance = null;
    log("info", "Email worker closed");
  }
}
