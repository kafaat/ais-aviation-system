/**
 * Operations Prediction Agent
 *
 * Forecasts flight delays, predicts disruptions, and monitors operational health
 * using historical patterns and real-time data analysis.
 *
 * Capabilities:
 * - Flight delay prediction with confidence intervals
 * - Disruption cascade forecasting
 * - On-Time Performance (OTP) monitoring
 * - Turnaround efficiency analysis
 * - Crew/aircraft utilization tracking
 * - Operational alert generation
 *
 * @module services/intelligence/operations.agent
 */

import { getDb } from "../../db";
import { flights, bookings } from "../../../drizzle/schema";
import { eq, and, gte, lte, sql, count } from "drizzle-orm";
import { createServiceLogger } from "../../_core/logger";
import type {
  AgentResult,
  AgentRecommendation,
  IntelligenceContext,
  DelayPrediction,
  DisruptionForecast,
  OperationalHealth,
  OperationalAlert,
  DelayFactor,
} from "./types";

const log = createServiceLogger("intelligence:operations");

// ============================================================================
// Constants
// ============================================================================

/** Historical average delay by time of day (hour -> avg delay minutes) */
const HOURLY_DELAY_BASELINE: Record<number, number> = {
  0: 5,
  1: 3,
  2: 3,
  3: 3,
  4: 5,
  5: 8,
  6: 12,
  7: 15,
  8: 18,
  9: 14,
  10: 12,
  11: 10,
  12: 11,
  13: 13,
  14: 15,
  15: 17,
  16: 20,
  17: 22,
  18: 19,
  19: 16,
  20: 13,
  21: 10,
  22: 8,
  23: 6,
};

/** Load factor impact on delays (higher load = longer boarding) */
const _LOAD_FACTOR_DELAY_WEIGHT = 0.15;

/** OTP target percentage */
const OTP_TARGET = 85;

// ============================================================================
// Operations Agent
// ============================================================================

export class OperationsAgent {
  private readonly agentId = "operations-agent-v1";
  private readonly agentName = "Operations Prediction Agent";

  /**
   * Predict delay for a specific flight
   */
  async predictDelay(
    flightId: number,
    _context: IntelligenceContext
  ): Promise<AgentResult<DelayPrediction>> {
    const startTime = Date.now();
    const reasoning: string[] = [];
    const factors: DelayFactor[] = [];

    try {
      const db = await getDb();
      if (!db) {
        return this.delayErrorResult(
          flightId,
          "Database not available",
          startTime
        );
      }

      // Get flight details
      const [flight] = await db
        .select({
          id: flights.id,
          flightNumber: flights.flightNumber,
          departureTime: flights.departureTime,
          arrivalTime: flights.arrivalTime,
          status: flights.status,
          economySeats: flights.economySeats,
          businessSeats: flights.businessSeats,
          originId: flights.originId,
          destinationId: flights.destinationId,
        })
        .from(flights)
        .where(eq(flights.id, flightId))
        .limit(1);

      if (!flight) {
        return this.delayErrorResult(flightId, "Flight not found", startTime);
      }

      reasoning.push(
        `Analyzing flight ${flight.flightNumber} (ID: ${flightId})`
      );

      // Factor 1: Time of day
      const departureHour = flight.departureTime
        ? new Date(flight.departureTime).getHours()
        : 12;
      const baselineDelay = HOURLY_DELAY_BASELINE[departureHour] || 10;
      factors.push({
        factor: "time_of_day",
        contribution: baselineDelay / 60,
        description: `${departureHour}:00 departure has ${baselineDelay} min avg delay historically`,
      });

      // Factor 2: Load factor impact
      const [bookingCount] = await db
        .select({ count: count() })
        .from(bookings)
        .where(
          and(eq(bookings.flightId, flightId), eq(bookings.status, "confirmed"))
        );

      const bookedSeats = Number(bookingCount?.count || 0);
      const totalSeats =
        (Number(flight.economySeats) || 0) +
          (Number(flight.businessSeats) || 0) || 180;
      const loadFactor = Math.min(bookedSeats / totalSeats, 1);

      const loadFactorDelay = loadFactor > 0.9 ? 8 : loadFactor > 0.8 ? 4 : 0;
      if (loadFactorDelay > 0) {
        factors.push({
          factor: "high_load_factor",
          contribution: loadFactorDelay / 60,
          description: `Load factor ${(loadFactor * 100).toFixed(0)}% - high passenger volume increases boarding time`,
        });
      }

      // Factor 3: Historical route delay
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [routeHistory] = await db
        .select({
          totalFlights: count(),
          delayedFlights: sql<number>`SUM(CASE WHEN ${flights.status} = 'delayed' THEN 1 ELSE 0 END)`,
          cancelledFlights: sql<number>`SUM(CASE WHEN ${flights.status} = 'cancelled' THEN 1 ELSE 0 END)`,
        })
        .from(flights)
        .where(
          and(
            eq(flights.originId, flight.originId),
            eq(flights.destinationId, flight.destinationId),
            gte(flights.departureTime, thirtyDaysAgo)
          )
        );

      const histTotal = Number(routeHistory?.totalFlights || 0);
      const histDelayed = Number(routeHistory?.delayedFlights || 0);
      const routeDelayRate = histTotal > 0 ? histDelayed / histTotal : 0.15;

      if (routeDelayRate > 0.2) {
        const routeDelayContrib = routeDelayRate * 15;
        factors.push({
          factor: "route_history",
          contribution: routeDelayContrib / 60,
          description: `Route has ${(routeDelayRate * 100).toFixed(0)}% delay rate over last 30 days`,
        });
      }

      // Factor 4: Current day disruption check (cascade effect)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const [todayStats] = await db
        .select({
          totalToday: count(),
          delayedToday: sql<number>`SUM(CASE WHEN ${flights.status} = 'delayed' THEN 1 ELSE 0 END)`,
        })
        .from(flights)
        .where(
          and(
            gte(flights.departureTime, todayStart),
            lte(flights.departureTime, todayEnd)
          )
        );

      const todayTotal = Number(todayStats?.totalToday || 0);
      const todayDelayed = Number(todayStats?.delayedToday || 0);
      const todayDelayRate = todayTotal > 0 ? todayDelayed / todayTotal : 0;

      if (todayDelayRate > 0.3) {
        factors.push({
          factor: "cascade_effect",
          contribution: todayDelayRate * 0.4,
          description: `${(todayDelayRate * 100).toFixed(0)}% of today's flights delayed - cascade risk`,
        });
      }

      // Calculate predicted delay
      const predictedDelay = Math.round(
        baselineDelay +
          loadFactorDelay +
          (routeDelayRate > 0.2 ? routeDelayRate * 15 : 0) +
          (todayDelayRate > 0.3 ? todayDelayRate * 10 : 0)
      );

      // Confidence based on data availability
      const confidence = Math.min(
        0.4 +
          (histTotal > 10 ? 0.3 : histTotal * 0.03) +
          (todayTotal > 5 ? 0.2 : 0.1),
        0.95
      );

      const recommendation =
        predictedDelay > 30
          ? "Proactively notify passengers of potential delay"
          : predictedDelay > 15
            ? "Monitor closely, prepare contingency"
            : "Normal operations expected";

      reasoning.push(`Predicted delay: ${predictedDelay} minutes`);
      reasoning.push(`Confidence: ${(confidence * 100).toFixed(0)}%`);
      reasoning.push(
        `Primary factors: ${factors.map(f => f.factor).join(", ")}`
      );

      const prediction: DelayPrediction = {
        flightId,
        flightNumber: flight.flightNumber,
        scheduledDeparture: flight.departureTime || new Date(),
        predictedDelayMinutes: predictedDelay,
        confidence,
        factors,
        recommendation,
      };

      return {
        agentId: this.agentId,
        agentName: this.agentName,
        timestamp: new Date(),
        executionTimeMs: Date.now() - startTime,
        status: "completed",
        confidence,
        confidenceLevel:
          confidence > 0.7 ? "high" : confidence > 0.5 ? "medium" : "low",
        data: prediction,
        reasoning,
        recommendations: [],
      };
    } catch (error) {
      log.error(
        { error, flightId, event: "delay_prediction_failed" },
        "Delay prediction failed"
      );
      return this.delayErrorResult(
        flightId,
        error instanceof Error ? error.message : "Unknown error",
        startTime
      );
    }
  }

  /**
   * Get operational health overview for the intelligence briefing
   */
  async getOperationalHealth(
    _context: IntelligenceContext
  ): Promise<AgentResult<OperationalHealth>> {
    const startTime = Date.now();
    const reasoning: string[] = [];
    const alerts: OperationalAlert[] = [];

    try {
      const db = await getDb();
      if (!db) {
        return this.healthErrorResult("Database not available", startTime);
      }

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Get flight statistics for the period
      const [flightStats] = await db
        .select({
          totalFlights: count(),
          completedFlights: sql<number>`SUM(CASE WHEN ${flights.status} = 'completed' THEN 1 ELSE 0 END)`,
          delayedFlights: sql<number>`SUM(CASE WHEN ${flights.status} = 'delayed' THEN 1 ELSE 0 END)`,
          cancelledFlights: sql<number>`SUM(CASE WHEN ${flights.status} = 'cancelled' THEN 1 ELSE 0 END)`,
          scheduledFlights: sql<number>`SUM(CASE WHEN ${flights.status} = 'scheduled' THEN 1 ELSE 0 END)`,
        })
        .from(flights)
        .where(gte(flights.departureTime, thirtyDaysAgo));

      const total = Number(flightStats?.totalFlights || 0);
      const completed = Number(flightStats?.completedFlights || 0);
      const delayed = Number(flightStats?.delayedFlights || 0);
      const cancelled = Number(flightStats?.cancelledFlights || 0);

      // Calculate OTP (On-Time Performance)
      const operatedFlights = completed + delayed;
      const onTimeFlights = completed; // Simplified: completed = on-time
      const otp =
        operatedFlights > 0 ? (onTimeFlights / operatedFlights) * 100 : 100;

      // Completion rate
      const completionRate =
        total > 0 ? ((total - cancelled) / total) * 100 : 100;

      // Cancellation rate
      const cancellationRate = total > 0 ? (cancelled / total) * 100 : 0;

      // Average delay estimation (using delayed flights ratio)
      const averageDelay =
        delayed > 0 ? (delayed / Math.max(operatedFlights, 1)) * 25 : 0;

      // Turnaround efficiency (based on schedule adherence)
      const turnaroundEfficiency = Math.max(
        0,
        100 - averageDelay * 0.5 - cancellationRate * 2
      );

      // Aircraft utilization estimate (flights per day / expected flights per day)
      const daysCovered = 30;
      const avgFlightsPerDay = total / daysCovered;
      const aircraftUtilization = Math.min((avgFlightsPerDay / 50) * 100, 100); // Assume 50 flights/day capacity

      // Crew utilization (similar estimation)
      const crewUtilization = Math.min((avgFlightsPerDay / 45) * 100, 100);

      reasoning.push(`30-day analysis: ${total} total flights`);
      reasoning.push(`OTP: ${otp.toFixed(1)}% (target: ${OTP_TARGET}%)`);
      reasoning.push(`Completion rate: ${completionRate.toFixed(1)}%`);
      reasoning.push(`Cancellation rate: ${cancellationRate.toFixed(1)}%`);

      // Generate operational alerts
      if (otp < OTP_TARGET) {
        alerts.push({
          type: "delay_cascade",
          severity: otp < 70 ? "critical" : "warning",
          message: `OTP at ${otp.toFixed(1)}% is below ${OTP_TARGET}% target`,
          affectedFlights: [],
          suggestedAction:
            "Review schedule buffer times and ground handling efficiency",
        });
      }

      if (cancellationRate > 3) {
        alerts.push({
          type: "maintenance",
          severity: cancellationRate > 5 ? "critical" : "warning",
          message: `Cancellation rate at ${cancellationRate.toFixed(1)}% is elevated`,
          affectedFlights: [],
          suggestedAction:
            "Audit maintenance scheduling and aircraft availability",
        });
      }

      // Check recent week trend
      const [recentStats] = await db
        .select({
          totalFlights: count(),
          delayedFlights: sql<number>`SUM(CASE WHEN ${flights.status} = 'delayed' THEN 1 ELSE 0 END)`,
        })
        .from(flights)
        .where(gte(flights.departureTime, sevenDaysAgo));

      const recentTotal = Number(recentStats?.totalFlights || 0);
      const recentDelayed = Number(recentStats?.delayedFlights || 0);
      const recentDelayRate = recentTotal > 0 ? recentDelayed / recentTotal : 0;

      if (recentDelayRate > 0.25) {
        alerts.push({
          type: "delay_cascade",
          severity: "action_required",
          message: `Last 7 days: ${(recentDelayRate * 100).toFixed(0)}% delay rate detected`,
          affectedFlights: [],
          suggestedAction:
            "Investigate root causes - possible crew shortage or weather pattern",
        });
      }

      if (aircraftUtilization < 60) {
        alerts.push({
          type: "capacity",
          severity: "info",
          message: `Aircraft utilization at ${aircraftUtilization.toFixed(0)}% - potential for schedule optimization`,
          affectedFlights: [],
          suggestedAction: "Review fleet allocation for underutilized aircraft",
        });
      }

      // Build recommendations
      const recommendations: AgentRecommendation[] = [];

      if (otp < OTP_TARGET) {
        recommendations.push({
          id: "ops-otp-improvement",
          type: "operations",
          severity: otp < 70 ? "critical" : "warning",
          title: "Improve On-Time Performance",
          titleAr: "تحسين الأداء في الوقت المحدد",
          description: `OTP is ${otp.toFixed(1)}%, ${(OTP_TARGET - otp).toFixed(1)}% below target. Focus on turnaround optimization and buffer management.`,
          descriptionAr: `الأداء في الوقت المحدد ${otp.toFixed(1)}%، أقل من المستهدف بـ ${(OTP_TARGET - otp).toFixed(1)}%.`,
          action: "optimize_turnaround",
          impact: {
            metric: "otp",
            currentValue: otp,
            projectedValue: OTP_TARGET,
            change: OTP_TARGET - otp,
            unit: "%",
          },
          autoApplicable: false,
        });
      }

      const healthData: OperationalHealth = {
        otp: Math.round(otp * 10) / 10,
        completionRate: Math.round(completionRate * 10) / 10,
        averageDelay: Math.round(averageDelay * 10) / 10,
        cancellationRate: Math.round(cancellationRate * 10) / 10,
        turnaroundEfficiency: Math.round(turnaroundEfficiency * 10) / 10,
        crewUtilization: Math.round(crewUtilization * 10) / 10,
        aircraftUtilization: Math.round(aircraftUtilization * 10) / 10,
        alerts,
      };

      const confidence =
        total > 100 ? 0.88 : total > 30 ? 0.72 : total > 0 ? 0.5 : 0.2;

      log.info(
        {
          event: "operational_health_complete",
          otp,
          completionRate,
          alertCount: alerts.length,
          executionTimeMs: Date.now() - startTime,
        },
        "Operational health assessment completed"
      );

      return {
        agentId: this.agentId,
        agentName: this.agentName,
        timestamp: new Date(),
        executionTimeMs: Date.now() - startTime,
        status: "completed",
        confidence,
        confidenceLevel:
          confidence > 0.8 ? "high" : confidence > 0.6 ? "medium" : "low",
        data: healthData,
        reasoning,
        recommendations,
      };
    } catch (error) {
      log.error(
        { error, event: "operational_health_failed" },
        "Operational health assessment failed"
      );
      return this.healthErrorResult(
        error instanceof Error ? error.message : "Unknown error",
        startTime
      );
    }
  }

  /**
   * Forecast disruptions for upcoming period
   */
  async forecastDisruptions(
    _context: IntelligenceContext
  ): Promise<AgentResult<DisruptionForecast[]>> {
    const startTime = Date.now();
    const reasoning: string[] = [];

    try {
      const db = await getDb();
      if (!db) {
        return this.disruptionErrorResult("Database not available", startTime);
      }

      // Analyze next 7 days
      const forecasts: DisruptionForecast[] = [];
      const now = new Date();

      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const targetDate = new Date(
          now.getTime() + dayOffset * 24 * 60 * 60 * 1000
        );
        const dayStart = new Date(targetDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(targetDate);
        dayEnd.setHours(23, 59, 59, 999);

        // Count scheduled flights for this day
        const [dayFlights] = await db
          .select({ count: count() })
          .from(flights)
          .where(
            and(
              gte(flights.departureTime, dayStart),
              lte(flights.departureTime, dayEnd)
            )
          );

        const flightCount = Number(dayFlights?.count || 0);
        const dayOfWeek = targetDate.getDay();

        // Risk factors
        const causes: string[] = [];
        let riskScore = 0;

        // Weekend typically has different patterns
        if (dayOfWeek === 5 || dayOfWeek === 6) {
          riskScore += 10;
          causes.push("Weekend operations - reduced staffing");
        }

        // High volume days
        if (flightCount > 60) {
          riskScore += 15;
          causes.push(`High flight volume: ${flightCount} scheduled`);
        }

        // Peak travel periods (Thursday/Sunday for Saudi market)
        if (dayOfWeek === 4 || dayOfWeek === 0) {
          riskScore += 8;
          causes.push("Peak travel day");
        }

        const severity: DisruptionForecast["severity"] =
          riskScore >= 30
            ? "severe"
            : riskScore >= 20
              ? "moderate"
              : riskScore >= 10
                ? "minor"
                : "none";

        forecasts.push({
          date: targetDate,
          severity,
          affectedFlights:
            severity === "none"
              ? 0
              : Math.ceil(flightCount * (riskScore / 100)),
          causes: causes.length > 0 ? causes : ["Normal operations expected"],
          recommendations: [],
        });
      }

      reasoning.push(`7-day disruption forecast generated`);
      reasoning.push(
        `Days with elevated risk: ${forecasts.filter(f => f.severity !== "none").length}`
      );

      return {
        agentId: this.agentId,
        agentName: this.agentName,
        timestamp: new Date(),
        executionTimeMs: Date.now() - startTime,
        status: "completed",
        confidence: 0.65,
        confidenceLevel: "medium",
        data: forecasts,
        reasoning,
        recommendations: [],
      };
    } catch (error) {
      log.error(
        { error, event: "disruption_forecast_failed" },
        "Disruption forecast failed"
      );
      return this.disruptionErrorResult(
        error instanceof Error ? error.message : "Unknown error",
        startTime
      );
    }
  }

  private delayErrorResult(
    flightId: number,
    message: string,
    startTime: number
  ): AgentResult<DelayPrediction> {
    return {
      agentId: this.agentId,
      agentName: this.agentName,
      timestamp: new Date(),
      executionTimeMs: Date.now() - startTime,
      status: "failed",
      confidence: 0,
      confidenceLevel: "low",
      data: {
        flightId,
        flightNumber: "",
        scheduledDeparture: new Date(),
        predictedDelayMinutes: 0,
        confidence: 0,
        factors: [],
        recommendation: "Unable to predict",
      },
      reasoning: [],
      recommendations: [],
      errors: [message],
    };
  }

  private healthErrorResult(
    message: string,
    startTime: number
  ): AgentResult<OperationalHealth> {
    return {
      agentId: this.agentId,
      agentName: this.agentName,
      timestamp: new Date(),
      executionTimeMs: Date.now() - startTime,
      status: "failed",
      confidence: 0,
      confidenceLevel: "low",
      data: {
        otp: 0,
        completionRate: 0,
        averageDelay: 0,
        cancellationRate: 0,
        turnaroundEfficiency: 0,
        crewUtilization: 0,
        aircraftUtilization: 0,
        alerts: [],
      },
      reasoning: [],
      recommendations: [],
      errors: [message],
    };
  }

  private disruptionErrorResult(
    message: string,
    startTime: number
  ): AgentResult<DisruptionForecast[]> {
    return {
      agentId: this.agentId,
      agentName: this.agentName,
      timestamp: new Date(),
      executionTimeMs: Date.now() - startTime,
      status: "failed",
      confidence: 0,
      confidenceLevel: "low",
      data: [],
      reasoning: [],
      recommendations: [],
      errors: [message],
    };
  }
}

export const operationsAgent = new OperationsAgent();
