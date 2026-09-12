import {
  getOperationalDeparture,
  getObservedOperations,
} from "../operational-events.service";
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
import { flights } from "../../../drizzle/schema";
import { eq, and, gte, lte, sql, count } from "drizzle-orm";
import { createServiceLogger } from "../../_core/logger";
import type {
  AgentResult,
  IntelligenceContext,
  DelayPrediction,
  DisruptionForecast,
  OperationalHealth,
} from "./types";

const log = createServiceLogger("intelligence:operations");

// ============================================================================
// Constants
// ============================================================================

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
    try {
      const evidence = await getOperationalDeparture(flightId);
      return {
        agentId: this.agentId,
        agentName: this.agentName,
        timestamp: new Date(),
        executionTimeMs: Date.now() - startTime,
        status: evidence.delayMinutes === null ? "failed" : "completed",
        confidence: 0,
        confidenceLevel: "low",
        data: {
          flightId,
          flightNumber: evidence.flightNumber,
          scheduledDeparture: evidence.scheduledDeparture,
          predictedDelayMinutes: evidence.delayMinutes,
          confidence: 0,
          basis: evidence.basis,
          evidenceId: evidence.evidenceId,
          sourceId: evidence.sourceId,
          fresh: evidence.fresh,
          factors: [],
          recommendation:
            evidence.delayMinutes === null
              ? "Fresh operational evidence required"
              : "Review the source observation; no calibrated model confidence is available",
        },
        reasoning: [
          "Delay is derived from a signed source timestamp; model confidence is not measured.",
        ],
        recommendations: [],
      };
    } catch (error) {
      return this.delayErrorResult(
        flightId,
        error instanceof Error ? error.message : "Operations unavailable",
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
    try {
      const db = await getDb();
      if (!db) throw new Error("Operations unavailable");
      const to = new Date();
      const from = new Date(to.getTime() - 30 * 86400000);
      const observed = await getObservedOperations(from, to);
      const [stats] = await db
        .select({
          total: count(),
          completed: sql<number>`SUM(CASE WHEN ${flights.status} = 'completed' THEN 1 ELSE 0 END)`,
          cancelled: sql<number>`SUM(CASE WHEN ${flights.status} = 'cancelled' THEN 1 ELSE 0 END)`,
        })
        .from(flights)
        .where(
          and(gte(flights.departureTime, from), lte(flights.departureTime, to))
        );
      const total = Number(stats?.total ?? 0);
      const data: OperationalHealth = {
        otp: observed.otp,
        averageDelay: observed.averageDelay,
        completionRate: total
          ? (100 * Number(stats?.completed ?? 0)) / total
          : null,
        cancellationRate: total
          ? (100 * Number(stats?.cancelled ?? 0)) / total
          : null,
        turnaroundEfficiency: null,
        crewUtilization: null,
        aircraftUtilization: null,
        alerts: [],
        observedFlights: observed.sampleCount,
        coverage: total ? observed.sampleCount / total : null,
      };
      return {
        agentId: this.agentId,
        agentName: this.agentName,
        timestamp: to,
        executionTimeMs: Date.now() - startTime,
        status: observed.sampleCount ? "completed" : "failed",
        confidence: 0,
        confidenceLevel: "low",
        data,
        reasoning: [
          `Departure OTP uses ${observed.sampleCount} observed flight instances and a 15-minute threshold.`,
          "Completion/cancellation use past scheduled flights; utilization requires roster and rotation evidence.",
        ],
        recommendations: [],
      };
    } catch (error) {
      return this.healthErrorResult(
        error instanceof Error ? error.message : "Operations unavailable",
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
        predictedDelayMinutes: null,
        basis: "unavailable",
        evidenceId: null,
        sourceId: null,
        fresh: false,
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
        otp: null,
        completionRate: null,
        averageDelay: null,
        cancellationRate: null,
        turnaroundEfficiency: null,
        crewUtilization: null,
        aircraftUtilization: null,
        observedFlights: 0,
        coverage: null,
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
