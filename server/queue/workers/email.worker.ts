/**
 * Email Worker
 * 
 * BullMQ worker that processes email sending jobs.
 * Handles booking confirmations, cancellations, and notifications.
 */

import { Worker, Job } from "bullmq";
import { getRedisConnection, emailQueue } from "../queues";

// ============================================================================
// Worker Configuration
// ============================================================================

const WORKER_CONFIG = {
  name: "email",
  concurrency: 5, // Process up to 5 emails concurrently
};

// ============================================================================
// Job Types
// ============================================================================

type EmailJobType = 
  | "booking_confirmation"
  | "booking_cancellation"
  | "payment_receipt"
  | "flight_reminder"
  | "flight_status_change"
  | "password_reset"
  | "welcome";

interface EmailJobData {
  type: EmailJobType;
  to: string;
  subject: string;
  templateData: Record<string, unknown>;
  userId?: number;
  bookingId?: number;
}

// ============================================================================
// Email Templates
// ============================================================================

function getEmailTemplate(type: EmailJobType, data: Record<string, unknown>): { subject: string; html: string } {
  switch (type) {
    case "booking_confirmation":
      return {
        subject: `Booking Confirmed - ${data.bookingReference}`,
        html: `
          <h1>Booking Confirmed!</h1>
          <p>Dear ${data.passengerName},</p>
          <p>Your booking has been confirmed.</p>
          <p><strong>Booking Reference:</strong> ${data.bookingReference}</p>
          <p><strong>Flight:</strong> ${data.flightNumber}</p>
          <p><strong>Date:</strong> ${data.departureDate}</p>
          <p><strong>Route:</strong> ${data.origin} → ${data.destination}</p>
          <p>Thank you for choosing AIS Aviation.</p>
        `,
      };

    case "booking_cancellation":
      return {
        subject: `Booking Cancelled - ${data.bookingReference}`,
        html: `
          <h1>Booking Cancelled</h1>
          <p>Dear ${data.passengerName},</p>
          <p>Your booking has been cancelled.</p>
          <p><strong>Booking Reference:</strong> ${data.bookingReference}</p>
          ${data.refundAmount ? `<p><strong>Refund Amount:</strong> ${data.refundAmount} ${data.currency}</p>` : ""}
          <p>If you have any questions, please contact our support team.</p>
        `,
      };

    case "payment_receipt":
      return {
        subject: `Payment Receipt - ${data.bookingReference}`,
        html: `
          <h1>Payment Receipt</h1>
          <p>Dear ${data.passengerName},</p>
          <p>We have received your payment.</p>
          <p><strong>Amount:</strong> ${data.amount} ${data.currency}</p>
          <p><strong>Transaction ID:</strong> ${data.transactionId}</p>
          <p><strong>Date:</strong> ${data.paymentDate}</p>
          <p>Thank you for your payment.</p>
        `,
      };

    case "flight_reminder":
      return {
        subject: `Flight Reminder - ${data.flightNumber}`,
        html: `
          <h1>Flight Reminder</h1>
          <p>Dear ${data.passengerName},</p>
          <p>This is a reminder for your upcoming flight.</p>
          <p><strong>Flight:</strong> ${data.flightNumber}</p>
          <p><strong>Departure:</strong> ${data.departureTime}</p>
          <p><strong>From:</strong> ${data.origin}</p>
          <p><strong>To:</strong> ${data.destination}</p>
          <p>Please arrive at the airport at least 2 hours before departure.</p>
        `,
      };

    case "flight_status_change":
      return {
        subject: `Flight Status Update - ${data.flightNumber}`,
        html: `
          <h1>Flight Status Update</h1>
          <p>Dear ${data.passengerName},</p>
          <p>Your flight status has been updated.</p>
          <p><strong>Flight:</strong> ${data.flightNumber}</p>
          <p><strong>New Status:</strong> ${data.newStatus}</p>
          ${data.newDepartureTime ? `<p><strong>New Departure Time:</strong> ${data.newDepartureTime}</p>` : ""}
          <p>We apologize for any inconvenience.</p>
        `,
      };

    default:
      return {
        subject: data.subject as string || "Notification",
        html: `<p>${data.message || "You have a new notification."}</p>`,
      };
  }
}

// ============================================================================
// Email Sending (Mock - Replace with actual email service)
// ============================================================================

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  // TODO: Replace with actual email service (SendGrid, SES, etc.)
  console.log(`[EmailWorker] Sending email to ${to}`);
  console.log(`[EmailWorker] Subject: ${subject}`);
  
  // Simulate email sending delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // In production, use something like:
  // await sendgrid.send({ to, from: 'noreply@ais.com', subject, html });
  
  return true;
}

// ============================================================================
// Worker Definition
// ============================================================================

export const emailWorker = new Worker<EmailJobData>(
  WORKER_CONFIG.name,
  async (job: Job<EmailJobData>) => {
    console.log(`[EmailWorker] Processing job ${job.id} (${job.data.type})...`);
    
    const { type, to, templateData } = job.data;
    
    try {
      // Get email template
      const { subject, html } = getEmailTemplate(type, templateData);
      
      // Send email
      const success = await sendEmail(to, subject, html);
      
      if (!success) {
        throw new Error("Failed to send email");
      }
      
      console.log(`[EmailWorker] Email sent successfully to ${to}`);
      
      return { success: true, sentAt: new Date().toISOString() };
    } catch (error) {
      console.error(`[EmailWorker] Failed to send email to ${to}:`, error);
      throw error;
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: WORKER_CONFIG.concurrency,
  }
);

// ============================================================================
// Event Handlers
// ============================================================================

emailWorker.on("completed", (job) => {
  console.log(`[EmailWorker] Job ${job.id} completed`);
});

emailWorker.on("failed", (job, error) => {
  console.error(`[EmailWorker] Job ${job?.id} failed:`, error.message);
});

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
  departureDate: string;
  origin: string;
  destination: string;
  userId?: number;
  bookingId?: number;
}): Promise<string> {
  const job = await emailQueue.add(
    "booking_confirmation",
    {
      type: "booking_confirmation",
      to: data.to,
      subject: `Booking Confirmed - ${data.bookingReference}`,
      templateData: data,
      userId: data.userId,
      bookingId: data.bookingId,
    },
    { priority: 2 }
  );
  return job.id!;
}

/**
 * Queue a booking cancellation email
 */
export async function queueBookingCancellationEmail(data: {
  to: string;
  bookingReference: string;
  passengerName: string;
  refundAmount?: number;
  currency?: string;
  userId?: number;
  bookingId?: number;
}): Promise<string> {
  const job = await emailQueue.add(
    "booking_cancellation",
    {
      type: "booking_cancellation",
      to: data.to,
      subject: `Booking Cancelled - ${data.bookingReference}`,
      templateData: data,
      userId: data.userId,
      bookingId: data.bookingId,
    },
    { priority: 2 }
  );
  return job.id!;
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
}): Promise<string> {
  const job = await emailQueue.add(
    "flight_reminder",
    {
      type: "flight_reminder",
      to: data.to,
      subject: `Flight Reminder - ${data.flightNumber}`,
      templateData: data,
    },
    { priority: 3 }
  );
  return job.id!;
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

export async function closeEmailWorker(): Promise<void> {
  console.log("[EmailWorker] Closing worker...");
  await emailWorker.close();
  console.log("[EmailWorker] Worker closed");
}
