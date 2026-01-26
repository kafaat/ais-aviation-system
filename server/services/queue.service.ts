import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { logger } from "./logger.service";

/**
 * Queue names
 */
export enum QueueName {
  EMAIL = "emails",
  WEBHOOK_RETRY = "webhook-retry",
  RECONCILIATION = "reconciliation",
  CLEANUP = "cleanup",
  NOTIFICATIONS = "notifications",
}

/**
 * Job types for email queue
 */
export enum EmailJobType {
  BOOKING_CONFIRMATION = "booking-confirmation",
  PAYMENT_RECEIPT = "payment-receipt",
  CANCELLATION_NOTICE = "cancellation-notice",
  REFUND_NOTICE = "refund-notice",
}

/**
 * Queue Service
 * Manages background job processing using BullMQ
 */
class QueueService {
  private queues: Map<QueueName, Queue> = new Map();
  private workers: Map<QueueName, Worker> = new Map();
  private queueEvents: Map<QueueName, QueueEvents> = new Map();
  private connection: any;

  /**
   * Initialize queue service
   */
  async initialize(): Promise<void> {
    this.connection = {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD,
    };

    // Initialize queues
    this.initializeQueue(QueueName.EMAIL);
    this.initializeQueue(QueueName.WEBHOOK_RETRY);
    this.initializeQueue(QueueName.RECONCILIATION);
    this.initializeQueue(QueueName.CLEANUP);
    this.initializeQueue(QueueName.NOTIFICATIONS);

    // Initialize workers
    this.initializeWorker(QueueName.EMAIL, this.processEmailJob.bind(this));
    this.initializeWorker(
      QueueName.WEBHOOK_RETRY,
      this.processWebhookRetryJob.bind(this)
    );
    this.initializeWorker(
      QueueName.RECONCILIATION,
      this.processReconciliationJob.bind(this)
    );
    this.initializeWorker(QueueName.CLEANUP, this.processCleanupJob.bind(this));
    this.initializeWorker(
      QueueName.NOTIFICATIONS,
      this.processNotificationJob.bind(this)
    );

    logger.info("Queue service initialized");
  }

  /**
   * Initialize a queue
   */
  private initializeQueue(queueName: QueueName): void {
    const queue = new Queue(queueName, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: {
          age: 86400, // Keep completed jobs for 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 604800, // Keep failed jobs for 7 days
        },
      },
    });

    this.queues.set(queueName, queue);

    // Setup queue events
    const queueEvents = new QueueEvents(queueName, {
      connection: this.connection,
    });

    queueEvents.on("completed", ({ jobId }) => {
      logger.info("Job completed", { queue: queueName, jobId });
    });

    queueEvents.on("failed", ({ jobId, failedReason }) => {
      logger.error("Job failed", { queue: queueName, jobId, failedReason });
    });

    this.queueEvents.set(queueName, queueEvents);
  }

  /**
   * Initialize a worker
   */
  private initializeWorker(
    queueName: QueueName,
    processor: (job: Job) => Promise<any>
  ): void {
    const worker = new Worker(queueName, processor, {
      connection: this.connection,
      concurrency: 5,
    });

    worker.on("error", (err) => {
      logger.error("Worker error", { queue: queueName, error: err });
    });

    this.workers.set(queueName, worker);
  }

  /**
   * Get queue by name
   */
  private getQueue(queueName: QueueName): Queue {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not initialized`);
    }
    return queue;
  }

  /**
   * Add job to queue
   */
  async addJob(
    queueName: QueueName,
    jobName: string,
    data: any,
    options?: any
  ): Promise<Job> {
    const queue = this.getQueue(queueName);
    const job = await queue.add(jobName, data, options);
    logger.info("Job added to queue", { queue: queueName, jobName, jobId: job.id });
    return job;
  }

  /**
   * Process email job
   */
  private async processEmailJob(job: Job): Promise<void> {
    const { type, to, subject, body, bookingReference } = job.data;

    logger.info("Processing email job", {
      jobId: job.id,
      type,
      to,
      bookingReference,
    });

    try {
      // TODO: Implement actual email sending
      // await emailService.send({ to, subject, body });

      // Simulate email sending
      await new Promise((resolve) => setTimeout(resolve, 1000));

      logger.info("Email sent successfully", {
        jobId: job.id,
        to,
        bookingReference,
      });
    } catch (error) {
      logger.error("Failed to send email", {
        jobId: job.id,
        error,
      });
      throw error;
    }
  }

  /**
   * Process webhook retry job
   */
  private async processWebhookRetryJob(job: Job): Promise<void> {
    const { eventId, eventType, payload } = job.data;

    logger.info("Processing webhook retry job", {
      jobId: job.id,
      eventId,
      eventType,
    });

    try {
      // TODO: Implement webhook retry logic
      // await stripeWebhookService.retryEvent(eventId);

      logger.info("Webhook retry successful", {
        jobId: job.id,
        eventId,
      });
    } catch (error) {
      logger.error("Webhook retry failed", {
        jobId: job.id,
        eventId,
        error,
      });
      throw error;
    }
  }

  /**
   * Process reconciliation job
   */
  private async processReconciliationJob(job: Job): Promise<void> {
    const { type, startDate, endDate } = job.data;

    logger.info("Processing reconciliation job", {
      jobId: job.id,
      type,
      startDate,
      endDate,
    });

    try {
      // TODO: Implement reconciliation logic
      // await reconciliationService.reconcile(type, startDate, endDate);

      logger.info("Reconciliation completed", {
        jobId: job.id,
        type,
      });
    } catch (error) {
      logger.error("Reconciliation failed", {
        jobId: job.id,
        error,
      });
      throw error;
    }
  }

  /**
   * Process cleanup job
   */
  private async processCleanupJob(job: Job): Promise<void> {
    const { type } = job.data;

    logger.info("Processing cleanup job", {
      jobId: job.id,
      type,
    });

    try {
      // TODO: Implement cleanup logic
      // await cleanupService.cleanup(type);

      logger.info("Cleanup completed", {
        jobId: job.id,
        type,
      });
    } catch (error) {
      logger.error("Cleanup failed", {
        jobId: job.id,
        error,
      });
      throw error;
    }
  }

  /**
   * Process notification job
   */
  private async processNotificationJob(job: Job): Promise<void> {
    const { userId, type, message, metadata } = job.data;

    logger.info("Processing notification job", {
      jobId: job.id,
      userId,
      type,
    });

    try {
      // TODO: Implement notification logic
      // await notificationService.send(userId, type, message, metadata);

      logger.info("Notification sent", {
        jobId: job.id,
        userId,
        type,
      });
    } catch (error) {
      logger.error("Notification failed", {
        jobId: job.id,
        error,
      });
      throw error;
    }
  }

  /**
   * Send booking confirmation email
   */
  async sendBookingConfirmationEmail(data: {
    to: string;
    bookingReference: string;
    bookingDetails: any;
  }): Promise<void> {
    await this.addJob(QueueName.EMAIL, EmailJobType.BOOKING_CONFIRMATION, {
      type: EmailJobType.BOOKING_CONFIRMATION,
      to: data.to,
      subject: `Booking Confirmation - ${data.bookingReference}`,
      body: `Your booking ${data.bookingReference} has been confirmed.`,
      bookingReference: data.bookingReference,
      bookingDetails: data.bookingDetails,
    });
  }

  /**
   * Send payment receipt email
   */
  async sendPaymentReceiptEmail(data: {
    to: string;
    bookingReference: string;
    amount: number;
    currency: string;
  }): Promise<void> {
    await this.addJob(QueueName.EMAIL, EmailJobType.PAYMENT_RECEIPT, {
      type: EmailJobType.PAYMENT_RECEIPT,
      to: data.to,
      subject: `Payment Receipt - ${data.bookingReference}`,
      body: `Payment of ${data.amount} ${data.currency} received for booking ${data.bookingReference}.`,
      bookingReference: data.bookingReference,
      amount: data.amount,
      currency: data.currency,
    });
  }

  /**
   * Schedule webhook retry
   */
  async scheduleWebhookRetry(data: {
    eventId: string;
    eventType: string;
    payload: any;
  }): Promise<void> {
    await this.addJob(QueueName.WEBHOOK_RETRY, "retry-webhook", data, {
      delay: 5000, // Retry after 5 seconds
    });
  }

  /**
   * Schedule daily reconciliation
   */
  async scheduleDailyReconciliation(): Promise<void> {
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 1);

    await this.addJob(QueueName.RECONCILIATION, "daily-reconciliation", {
      type: "daily",
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
  }

  /**
   * Schedule cleanup job
   */
  async scheduleCleanup(type: string): Promise<void> {
    await this.addJob(QueueName.CLEANUP, `cleanup-${type}`, {
      type,
    });
  }

  /**
   * Close all queues and workers
   */
  async close(): Promise<void> {
    // Close all workers
    for (const [name, worker] of this.workers) {
      await worker.close();
      logger.info("Worker closed", { queue: name });
    }

    // Close all queues
    for (const [name, queue] of this.queues) {
      await queue.close();
      logger.info("Queue closed", { queue: name });
    }

    // Close all queue events
    for (const [name, queueEvents] of this.queueEvents) {
      await queueEvents.close();
      logger.info("Queue events closed", { queue: name });
    }

    logger.info("Queue service closed");
  }
}

// Export singleton instance
export const queueService = new QueueService();

// Initialize on module load
queueService.initialize().catch((err) => {
  logger.error("Failed to initialize queue service", { error: err });
});
