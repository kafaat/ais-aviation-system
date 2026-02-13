/**
 * Business Metrics Service
 * Real-time tracking of business metrics for analytics and monitoring
 *
 * This service provides in-memory metrics collection with support for:
 * - Search funnel tracking (search -> booking -> payment)
 * - Conversion rate calculations
 * - Payment success/failure rates
 * - Revenue metrics
 * - User engagement tracking
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

export type MetricEventType =
  | "search_performed"
  | "booking_started"
  | "booking_completed"
  | "booking_cancelled"
  | "payment_initiated"
  | "payment_success"
  | "payment_failed"
  | "refund_issued"
  | "user_login"
  | "user_registration";

export interface MetricEvent {
  type: MetricEventType;
  timestamp: Date;
  userId?: number;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchEvent extends MetricEvent {
  type: "search_performed";
  metadata: {
    originId: number;
    destinationId: number;
    departureDate: string;
    resultsCount: number;
    responseTimeMs?: number;
  };
}

export interface BookingEvent extends MetricEvent {
  type: "booking_started" | "booking_completed" | "booking_cancelled";
  metadata: {
    bookingId: number;
    flightId: number;
    cabinClass: "economy" | "business";
    passengerCount: number;
    totalAmount: number;
  };
}

export interface PaymentEvent extends MetricEvent {
  type: "payment_initiated" | "payment_success" | "payment_failed";
  metadata: {
    bookingId: number;
    amount: number;
    currency: string;
    paymentMethod?: string;
    errorCode?: string;
    errorMessage?: string;
  };
}

export interface RefundEvent extends MetricEvent {
  type: "refund_issued";
  metadata: {
    bookingId: number;
    refundAmount: number;
    originalAmount: number;
    reason?: string;
  };
}

export interface UserEvent extends MetricEvent {
  type: "user_login" | "user_registration";
  metadata?: {
    source?: string;
    deviceType?: string;
  };
}

// Aggregated metrics types
export interface ConversionFunnel {
  searches: number;
  bookingsStarted: number;
  bookingsCompleted: number;
  paymentsSuccessful: number;
  searchToBookingRate: number;
  bookingToPaymentRate: number;
  overallConversionRate: number;
}

export interface PaymentMetrics {
  totalAttempts: number;
  successful: number;
  failed: number;
  successRate: number;
  failureRate: number;
  averageAmount: number;
  totalRevenue: number;
  byPaymentMethod: Record<string, { count: number; amount: number }>;
}

export interface RefundMetrics {
  totalRefunds: number;
  totalRefundAmount: number;
  averageRefundAmount: number;
  refundRate: number; // % of completed bookings that were refunded
  byReason: Record<string, number>;
}

export interface RevenueMetrics {
  totalRevenue: number;
  netRevenue: number; // Revenue - Refunds
  averageBookingValue: number;
  revenueByClass: {
    economy: number;
    business: number;
  };
  revenueByHour: Record<string, number>;
}

export interface UserEngagementMetrics {
  totalLogins: number;
  uniqueUsers: number;
  newRegistrations: number;
  searchesPerUser: number;
  bookingsPerUser: number;
  returnUserRate: number;
}

export interface TimeSeriesDataPoint {
  timestamp: string;
  value: number;
}

export interface BusinessMetrics {
  period: {
    start: Date;
    end: Date;
    durationHours: number;
  };
  funnel: ConversionFunnel;
  payments: PaymentMetrics;
  refunds: RefundMetrics;
  revenue: RevenueMetrics;
  engagement: UserEngagementMetrics;
  eventCounts: Record<MetricEventType, number>;
  recentEvents: MetricEvent[];
  timeSeries: {
    searches: TimeSeriesDataPoint[];
    bookings: TimeSeriesDataPoint[];
    revenue: TimeSeriesDataPoint[];
  };
}

// ============================================================================
// In-Memory Metrics Storage
// ============================================================================

class MetricsStore {
  private events: MetricEvent[] = [];
  private readonly maxEvents = 100000; // Keep last 100K events in memory
  private readonly retentionHours = 24; // Keep events for 24 hours
  private flushCallbacks: Array<(events: MetricEvent[]) => Promise<void>> = [];

  /**
   * Add an event to the store
   */
  addEvent(event: MetricEvent): void {
    this.events.push(event);

    // Trim if exceeding max events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  /**
   * Get events within a time range
   */
  getEvents(startTime: Date, endTime: Date = new Date()): MetricEvent[] {
    return this.events.filter(
      e => e.timestamp >= startTime && e.timestamp <= endTime
    );
  }

  /**
   * Get events by type within a time range
   */
  getEventsByType(
    type: MetricEventType,
    startTime: Date,
    endTime: Date = new Date()
  ): MetricEvent[] {
    return this.getEvents(startTime, endTime).filter(e => e.type === type);
  }

  /**
   * Get unique user IDs from events
   */
  getUniqueUserIds(startTime: Date, endTime: Date = new Date()): Set<number> {
    const events = this.getEvents(startTime, endTime);
    const userIds = new Set<number>();
    for (const event of events) {
      if (event.userId) {
        userIds.add(event.userId);
      }
    }
    return userIds;
  }

  /**
   * Get unique session IDs from events
   */
  getUniqueSessions(startTime: Date, endTime: Date = new Date()): Set<string> {
    const events = this.getEvents(startTime, endTime);
    const sessionIds = new Set<string>();
    for (const event of events) {
      if (event.sessionId) {
        sessionIds.add(event.sessionId);
      }
    }
    return sessionIds;
  }

  /**
   * Register a callback for periodic flush
   */
  onFlush(callback: (events: MetricEvent[]) => Promise<void>): void {
    this.flushCallbacks.push(callback);
  }

  /**
   * Flush old events and optionally persist them
   */
  async flush(): Promise<number> {
    const cutoffTime = new Date(
      Date.now() - this.retentionHours * 60 * 60 * 1000
    );
    const oldEvents = this.events.filter(e => e.timestamp < cutoffTime);

    // Call flush callbacks with old events
    for (const callback of this.flushCallbacks) {
      try {
        await callback(oldEvents);
      } catch (error) {
        console.error("[Metrics] Flush callback error:", error);
      }
    }

    // Remove old events
    const originalCount = this.events.length;
    this.events = this.events.filter(e => e.timestamp >= cutoffTime);
    const removedCount = originalCount - this.events.length;

    if (removedCount > 0) {
      console.info(`[Metrics] Flushed ${removedCount} old events`);
    }

    return removedCount;
  }

  /**
   * Get total event count
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Clear all events (for testing)
   */
  clear(): void {
    this.events = [];
  }
}

// Singleton instance
const metricsStore = new MetricsStore();

// ============================================================================
// Event Tracking Functions
// ============================================================================

/**
 * Track a search event
 */
export function trackSearch(params: {
  userId?: number;
  sessionId?: string;
  originId: number;
  destinationId: number;
  departureDate: Date;
  resultsCount: number;
  responseTimeMs?: number;
}): void {
  const event: SearchEvent = {
    type: "search_performed",
    timestamp: new Date(),
    userId: params.userId,
    sessionId: params.sessionId,
    metadata: {
      originId: params.originId,
      destinationId: params.destinationId,
      departureDate: params.departureDate.toISOString(),
      resultsCount: params.resultsCount,
      responseTimeMs: params.responseTimeMs,
    },
  };
  metricsStore.addEvent(event);
}

/**
 * Track booking started event
 */
export function trackBookingStarted(params: {
  userId: number;
  sessionId?: string;
  bookingId: number;
  flightId: number;
  cabinClass: "economy" | "business";
  passengerCount: number;
  totalAmount: number;
}): void {
  const event: BookingEvent = {
    type: "booking_started",
    timestamp: new Date(),
    userId: params.userId,
    sessionId: params.sessionId,
    metadata: {
      bookingId: params.bookingId,
      flightId: params.flightId,
      cabinClass: params.cabinClass,
      passengerCount: params.passengerCount,
      totalAmount: params.totalAmount,
    },
  };
  metricsStore.addEvent(event);
}

/**
 * Track booking completed event (after payment)
 */
export function trackBookingCompleted(params: {
  userId: number;
  sessionId?: string;
  bookingId: number;
  flightId: number;
  cabinClass: "economy" | "business";
  passengerCount: number;
  totalAmount: number;
}): void {
  const event: BookingEvent = {
    type: "booking_completed",
    timestamp: new Date(),
    userId: params.userId,
    sessionId: params.sessionId,
    metadata: {
      bookingId: params.bookingId,
      flightId: params.flightId,
      cabinClass: params.cabinClass,
      passengerCount: params.passengerCount,
      totalAmount: params.totalAmount,
    },
  };
  metricsStore.addEvent(event);
}

/**
 * Track booking cancelled event
 */
export function trackBookingCancelled(params: {
  userId: number;
  sessionId?: string;
  bookingId: number;
  flightId: number;
  cabinClass: "economy" | "business";
  passengerCount: number;
  totalAmount: number;
}): void {
  const event: BookingEvent = {
    type: "booking_cancelled",
    timestamp: new Date(),
    userId: params.userId,
    sessionId: params.sessionId,
    metadata: {
      bookingId: params.bookingId,
      flightId: params.flightId,
      cabinClass: params.cabinClass,
      passengerCount: params.passengerCount,
      totalAmount: params.totalAmount,
    },
  };
  metricsStore.addEvent(event);
}

/**
 * Track payment initiated event
 */
export function trackPaymentInitiated(params: {
  userId: number;
  sessionId?: string;
  bookingId: number;
  amount: number;
  currency: string;
  paymentMethod?: string;
}): void {
  const event: PaymentEvent = {
    type: "payment_initiated",
    timestamp: new Date(),
    userId: params.userId,
    sessionId: params.sessionId,
    metadata: {
      bookingId: params.bookingId,
      amount: params.amount,
      currency: params.currency,
      paymentMethod: params.paymentMethod,
    },
  };
  metricsStore.addEvent(event);
}

/**
 * Track successful payment event
 */
export function trackPaymentSuccess(params: {
  userId: number;
  sessionId?: string;
  bookingId: number;
  amount: number;
  currency: string;
  paymentMethod?: string;
}): void {
  const event: PaymentEvent = {
    type: "payment_success",
    timestamp: new Date(),
    userId: params.userId,
    sessionId: params.sessionId,
    metadata: {
      bookingId: params.bookingId,
      amount: params.amount,
      currency: params.currency,
      paymentMethod: params.paymentMethod,
    },
  };
  metricsStore.addEvent(event);
}

/**
 * Track failed payment event
 */
export function trackPaymentFailed(params: {
  userId: number;
  sessionId?: string;
  bookingId: number;
  amount: number;
  currency: string;
  paymentMethod?: string;
  errorCode?: string;
  errorMessage?: string;
}): void {
  const event: PaymentEvent = {
    type: "payment_failed",
    timestamp: new Date(),
    userId: params.userId,
    sessionId: params.sessionId,
    metadata: {
      bookingId: params.bookingId,
      amount: params.amount,
      currency: params.currency,
      paymentMethod: params.paymentMethod,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    },
  };
  metricsStore.addEvent(event);
}

/**
 * Track refund issued event
 */
export function trackRefundIssued(params: {
  userId: number;
  sessionId?: string;
  bookingId: number;
  refundAmount: number;
  originalAmount: number;
  reason?: string;
}): void {
  const event: RefundEvent = {
    type: "refund_issued",
    timestamp: new Date(),
    userId: params.userId,
    sessionId: params.sessionId,
    metadata: {
      bookingId: params.bookingId,
      refundAmount: params.refundAmount,
      originalAmount: params.originalAmount,
      reason: params.reason,
    },
  };
  metricsStore.addEvent(event);
}

/**
 * Track user login event
 */
export function trackUserLogin(params: {
  userId: number;
  sessionId?: string;
  source?: string;
  deviceType?: string;
}): void {
  const event: UserEvent = {
    type: "user_login",
    timestamp: new Date(),
    userId: params.userId,
    sessionId: params.sessionId,
    metadata: {
      source: params.source,
      deviceType: params.deviceType,
    },
  };
  metricsStore.addEvent(event);
}

/**
 * Track user registration event
 */
export function trackUserRegistration(params: {
  userId: number;
  sessionId?: string;
  source?: string;
  deviceType?: string;
}): void {
  const event: UserEvent = {
    type: "user_registration",
    timestamp: new Date(),
    userId: params.userId,
    sessionId: params.sessionId,
    metadata: {
      source: params.source,
      deviceType: params.deviceType,
    },
  };
  metricsStore.addEvent(event);
}

// ============================================================================
// Metrics Calculation Functions
// ============================================================================

/**
 * Calculate conversion funnel metrics
 */
function calculateConversionFunnel(
  startTime: Date,
  endTime: Date
): ConversionFunnel {
  const searches = metricsStore.getEventsByType(
    "search_performed",
    startTime,
    endTime
  ).length;
  const bookingsStarted = metricsStore.getEventsByType(
    "booking_started",
    startTime,
    endTime
  ).length;
  const bookingsCompleted = metricsStore.getEventsByType(
    "booking_completed",
    startTime,
    endTime
  ).length;
  const paymentsSuccessful = metricsStore.getEventsByType(
    "payment_success",
    startTime,
    endTime
  ).length;

  return {
    searches,
    bookingsStarted,
    bookingsCompleted,
    paymentsSuccessful,
    searchToBookingRate:
      searches > 0
        ? Math.round((bookingsStarted / searches) * 100 * 100) / 100
        : 0,
    bookingToPaymentRate:
      bookingsStarted > 0
        ? Math.round((paymentsSuccessful / bookingsStarted) * 100 * 100) / 100
        : 0,
    overallConversionRate:
      searches > 0
        ? Math.round((paymentsSuccessful / searches) * 100 * 100) / 100
        : 0,
  };
}

/**
 * Calculate payment metrics
 */
function calculatePaymentMetrics(
  startTime: Date,
  endTime: Date
): PaymentMetrics {
  const successEvents = metricsStore.getEventsByType(
    "payment_success",
    startTime,
    endTime
  ) as PaymentEvent[];
  const failedEvents = metricsStore.getEventsByType(
    "payment_failed",
    startTime,
    endTime
  ) as PaymentEvent[];

  const successful = successEvents.length;
  const failed = failedEvents.length;
  const totalAttempts = successful + failed;

  const totalRevenue = successEvents.reduce(
    (sum, e) => sum + (e.metadata?.amount || 0),
    0
  );

  const byPaymentMethod: Record<string, { count: number; amount: number }> = {};
  for (const event of successEvents) {
    const method = event.metadata?.paymentMethod || "card";
    if (!byPaymentMethod[method]) {
      byPaymentMethod[method] = { count: 0, amount: 0 };
    }
    byPaymentMethod[method].count++;
    byPaymentMethod[method].amount += event.metadata?.amount || 0;
  }

  return {
    totalAttempts,
    successful,
    failed,
    successRate:
      totalAttempts > 0
        ? Math.round((successful / totalAttempts) * 100 * 100) / 100
        : 0,
    failureRate:
      totalAttempts > 0
        ? Math.round((failed / totalAttempts) * 100 * 100) / 100
        : 0,
    averageAmount: successful > 0 ? Math.round(totalRevenue / successful) : 0,
    totalRevenue,
    byPaymentMethod,
  };
}

/**
 * Calculate refund metrics
 */
function calculateRefundMetrics(startTime: Date, endTime: Date): RefundMetrics {
  const refundEvents = metricsStore.getEventsByType(
    "refund_issued",
    startTime,
    endTime
  ) as RefundEvent[];
  const completedBookings = metricsStore.getEventsByType(
    "booking_completed",
    startTime,
    endTime
  ).length;

  const totalRefunds = refundEvents.length;
  const totalRefundAmount = refundEvents.reduce(
    (sum, e) => sum + (e.metadata?.refundAmount || 0),
    0
  );

  const byReason: Record<string, number> = {};
  for (const event of refundEvents) {
    const reason = event.metadata?.reason || "customer_request";
    byReason[reason] = (byReason[reason] || 0) + 1;
  }

  return {
    totalRefunds,
    totalRefundAmount,
    averageRefundAmount:
      totalRefunds > 0 ? Math.round(totalRefundAmount / totalRefunds) : 0,
    refundRate:
      completedBookings > 0
        ? Math.round((totalRefunds / completedBookings) * 100 * 100) / 100
        : 0,
    byReason,
  };
}

/**
 * Calculate revenue metrics
 */
function calculateRevenueMetrics(
  startTime: Date,
  endTime: Date
): RevenueMetrics {
  const paymentEvents = metricsStore.getEventsByType(
    "payment_success",
    startTime,
    endTime
  ) as PaymentEvent[];
  const refundEvents = metricsStore.getEventsByType(
    "refund_issued",
    startTime,
    endTime
  ) as RefundEvent[];
  const bookingEvents = metricsStore.getEventsByType(
    "booking_completed",
    startTime,
    endTime
  ) as BookingEvent[];

  const totalRevenue = paymentEvents.reduce(
    (sum, e) => sum + (e.metadata?.amount || 0),
    0
  );
  const totalRefunds = refundEvents.reduce(
    (sum, e) => sum + (e.metadata?.refundAmount || 0),
    0
  );
  const completedBookings = bookingEvents.length;

  const revenueByClass = { economy: 0, business: 0 };
  for (const event of bookingEvents) {
    const cabinClass = event.metadata?.cabinClass || "economy";
    revenueByClass[cabinClass] += event.metadata?.totalAmount || 0;
  }

  // Group revenue by hour
  const revenueByHour: Record<string, number> = {};
  for (const event of paymentEvents) {
    const hour = event.timestamp.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    revenueByHour[hour] =
      (revenueByHour[hour] || 0) + (event.metadata?.amount || 0);
  }

  return {
    totalRevenue,
    netRevenue: totalRevenue - totalRefunds,
    averageBookingValue:
      completedBookings > 0 ? Math.round(totalRevenue / completedBookings) : 0,
    revenueByClass,
    revenueByHour,
  };
}

/**
 * Calculate user engagement metrics
 */
function calculateEngagementMetrics(
  startTime: Date,
  endTime: Date
): UserEngagementMetrics {
  const loginEvents = metricsStore.getEventsByType(
    "user_login",
    startTime,
    endTime
  );
  const registrationEvents = metricsStore.getEventsByType(
    "user_registration",
    startTime,
    endTime
  );
  const searchEvents = metricsStore.getEventsByType(
    "search_performed",
    startTime,
    endTime
  );
  const bookingEvents = metricsStore.getEventsByType(
    "booking_started",
    startTime,
    endTime
  );

  const uniqueUsers = metricsStore.getUniqueUserIds(startTime, endTime);
  const uniqueUserCount = uniqueUsers.size;
  const newRegistrations = registrationEvents.length;
  const totalLogins = loginEvents.length;

  // Users who made bookings
  const _usersWithBookings = new Set(
    bookingEvents.filter(e => e.userId).map(e => e.userId ?? 0)
  );

  return {
    totalLogins,
    uniqueUsers: uniqueUserCount,
    newRegistrations,
    searchesPerUser:
      uniqueUserCount > 0
        ? Math.round((searchEvents.length / uniqueUserCount) * 100) / 100
        : 0,
    bookingsPerUser:
      uniqueUserCount > 0
        ? Math.round((bookingEvents.length / uniqueUserCount) * 100) / 100
        : 0,
    returnUserRate:
      uniqueUserCount > 0
        ? Math.round(
            ((uniqueUserCount - newRegistrations) / uniqueUserCount) * 100 * 100
          ) / 100
        : 0,
  };
}

/**
 * Get event counts by type
 */
function getEventCounts(
  startTime: Date,
  endTime: Date
): Record<MetricEventType, number> {
  const eventTypes: MetricEventType[] = [
    "search_performed",
    "booking_started",
    "booking_completed",
    "booking_cancelled",
    "payment_initiated",
    "payment_success",
    "payment_failed",
    "refund_issued",
    "user_login",
    "user_registration",
  ];

  const counts: Record<MetricEventType, number> = {} as Record<
    MetricEventType,
    number
  >;
  for (const type of eventTypes) {
    counts[type] = metricsStore.getEventsByType(
      type,
      startTime,
      endTime
    ).length;
  }
  return counts;
}

/**
 * Generate time series data for a metric
 */
function generateTimeSeries(
  events: MetricEvent[],
  intervalMinutes: number = 60
): TimeSeriesDataPoint[] {
  if (events.length === 0) return [];

  const buckets: Record<string, number> = {};
  const intervalMs = intervalMinutes * 60 * 1000;

  for (const event of events) {
    const bucketTime = new Date(
      Math.floor(event.timestamp.getTime() / intervalMs) * intervalMs
    );
    const key = bucketTime.toISOString();
    buckets[key] = (buckets[key] || 0) + 1;
  }

  return Object.entries(buckets)
    .map(([timestamp, value]) => ({ timestamp, value }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Generate revenue time series
 */
function generateRevenueTimeSeries(
  events: PaymentEvent[],
  intervalMinutes: number = 60
): TimeSeriesDataPoint[] {
  if (events.length === 0) return [];

  const buckets: Record<string, number> = {};
  const intervalMs = intervalMinutes * 60 * 1000;

  for (const event of events) {
    const bucketTime = new Date(
      Math.floor(event.timestamp.getTime() / intervalMs) * intervalMs
    );
    const key = bucketTime.toISOString();
    buckets[key] = (buckets[key] || 0) + (event.metadata?.amount || 0);
  }

  return Object.entries(buckets)
    .map(([timestamp, value]) => ({ timestamp, value }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// ============================================================================
// Main API Functions
// ============================================================================

/**
 * Get comprehensive business metrics for a time period
 */
export function getBusinessMetrics(hoursBack: number = 24): BusinessMetrics {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - hoursBack * 60 * 60 * 1000);

  const events = metricsStore.getEvents(startTime, endTime);
  const searchEvents = events.filter(e => e.type === "search_performed");
  const bookingEvents = events.filter(
    e => e.type === "booking_started" || e.type === "booking_completed"
  );
  const paymentEvents = events.filter(
    e => e.type === "payment_success"
  ) as PaymentEvent[];

  return {
    period: {
      start: startTime,
      end: endTime,
      durationHours: hoursBack,
    },
    funnel: calculateConversionFunnel(startTime, endTime),
    payments: calculatePaymentMetrics(startTime, endTime),
    refunds: calculateRefundMetrics(startTime, endTime),
    revenue: calculateRevenueMetrics(startTime, endTime),
    engagement: calculateEngagementMetrics(startTime, endTime),
    eventCounts: getEventCounts(startTime, endTime),
    recentEvents: events.slice(-100), // Last 100 events
    timeSeries: {
      searches: generateTimeSeries(searchEvents),
      bookings: generateTimeSeries(bookingEvents),
      revenue: generateRevenueTimeSeries(paymentEvents),
    },
  };
}

/**
 * Get metrics summary (lightweight version)
 */
export function getMetricsSummary(hoursBack: number = 1): {
  period: { start: Date; end: Date };
  totalSearches: number;
  totalBookings: number;
  totalRevenue: number;
  conversionRate: number;
  paymentSuccessRate: number;
} {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - hoursBack * 60 * 60 * 1000);

  const funnel = calculateConversionFunnel(startTime, endTime);
  const payments = calculatePaymentMetrics(startTime, endTime);

  return {
    period: { start: startTime, end: endTime },
    totalSearches: funnel.searches,
    totalBookings: funnel.bookingsCompleted,
    totalRevenue: payments.totalRevenue,
    conversionRate: funnel.overallConversionRate,
    paymentSuccessRate: payments.successRate,
  };
}

/**
 * Get real-time stats (last 5 minutes)
 */
export function getRealTimeStats(): {
  searchesPerMinute: number;
  bookingsPerMinute: number;
  revenuePerMinute: number;
  activeUsers: number;
} {
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 5 * 60 * 1000); // Last 5 minutes

  const searches = metricsStore.getEventsByType(
    "search_performed",
    startTime,
    endTime
  ).length;
  const bookings = metricsStore.getEventsByType(
    "booking_completed",
    startTime,
    endTime
  ).length;
  const payments = metricsStore.getEventsByType(
    "payment_success",
    startTime,
    endTime
  ) as PaymentEvent[];
  const revenue = payments.reduce(
    (sum, e) => sum + (e.metadata?.amount || 0),
    0
  );
  const activeUsers = metricsStore.getUniqueUserIds(startTime, endTime).size;

  return {
    searchesPerMinute: Math.round((searches / 5) * 100) / 100,
    bookingsPerMinute: Math.round((bookings / 5) * 100) / 100,
    revenuePerMinute: Math.round((revenue / 5) * 100) / 100,
    activeUsers,
  };
}

/**
 * Register a callback for periodic metric flush (e.g., to persist to database)
 */
export function onMetricsFlush(
  callback: (events: MetricEvent[]) => Promise<void>
): void {
  metricsStore.onFlush(callback);
}

/**
 * Manually trigger a flush of old events
 */
export async function flushOldEvents(): Promise<number> {
  return await metricsStore.flush();
}

/**
 * Get the current event count in memory
 */
export function getEventCount(): number {
  return metricsStore.getEventCount();
}

/**
 * Clear all metrics (for testing purposes)
 */
export function clearMetrics(): void {
  metricsStore.clear();
}

// ============================================================================
// Periodic Flush Setup
// ============================================================================

let flushInterval: NodeJS.Timeout | null = null;

/**
 * Start periodic flush of old events
 */
export function startPeriodicFlush(intervalHours: number = 1): void {
  if (flushInterval) {
    clearInterval(flushInterval);
  }
  flushInterval = setInterval(
    async () => {
      try {
        await flushOldEvents();
      } catch (error) {
        console.error("[Metrics] Periodic flush error:", error);
      }
    },
    intervalHours * 60 * 60 * 1000
  );
  console.info(`[Metrics] Started periodic flush every ${intervalHours} hours`);
}

/**
 * Stop periodic flush
 */
export function stopPeriodicFlush(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
    console.info("[Metrics] Stopped periodic flush");
  }
}
