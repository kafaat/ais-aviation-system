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
import { and, gte, lte, sql, count } from "drizzle-orm";
import type {
  AgentResult,
  IntelligenceContext,
  DelayPrediction,
  DisruptionForecast,
  OperationalHealth,
} from "./types";

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
  forecastDisruptions(
    _context: IntelligenceContext
  ): Promise<AgentResult<DisruptionForecast[]>> {
    return Promise.resolve(
      this.disruptionErrorResult(
        "No temporally validated disruption model is configured; use observed flight evidence and approved recovery plans",
        Date.now()
      )
    );
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
