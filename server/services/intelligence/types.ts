/**
 * Intelligence Kernel - Shared Types
 *
 * Core type definitions for the AIS Autonomous Intelligence Platform (AAIP).
 * All agents share these types for consistent inter-agent communication.
 *
 * @module services/intelligence/types
 */

// ============================================================================
// Agent Framework Types
// ============================================================================

/** Severity levels for agent decisions */
export type DecisionSeverity =
  | "info"
  | "warning"
  | "critical"
  | "action_required";

/** Confidence level for agent outputs */
export type ConfidenceLevel = "low" | "medium" | "high" | "very_high";

/** Agent execution status */
export type AgentStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "timeout";

/** Base interface for all agent results */
export interface AgentResult<T = unknown> {
  agentId: string;
  agentName: string;
  timestamp: Date;
  executionTimeMs: number;
  status: AgentStatus;
  confidence: number; // 0-1
  confidenceLevel: ConfidenceLevel;
  data: T;
  reasoning: string[];
  recommendations: AgentRecommendation[];
  errors?: string[];
}

/** A recommendation from an agent */
export interface AgentRecommendation {
  id: string;
  type:
    | "pricing"
    | "operations"
    | "fraud"
    | "economics"
    | "marketing"
    | "inventory";
  severity: DecisionSeverity;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  action: string;
  impact: {
    metric: string;
    currentValue: number;
    projectedValue: number;
    change: number; // percentage
    unit: string;
  };
  autoApplicable: boolean;
  expiresAt?: Date;
}

/** Context passed to all agents */
export interface IntelligenceContext {
  requestId: string;
  userId?: number;
  timestamp: Date;
  timeHorizon: "realtime" | "short_term" | "medium_term" | "long_term";
  scope: {
    flightIds?: number[];
    routeIds?: number[];
    airlineIds?: number[];
    dateRange?: { start: Date; end: Date };
  };
}

// ============================================================================
// Economics Agent Types
// ============================================================================

export interface RouteEconomics {
  routeId: string;
  origin: string;
  destination: string;
  metrics: {
    rask: number; // Revenue per Available Seat Kilometer
    cask: number; // Cost per Available Seat Kilometer
    yield: number; // Revenue per Revenue Passenger Kilometer
    loadFactor: number; // Percentage of seats filled
    breakEvenLoadFactor: number;
    profitMargin: number;
    contributionMargin: number;
  };
  trend: "improving" | "stable" | "declining";
  forecast: {
    nextMonth: number;
    nextQuarter: number;
    confidence: number;
  };
}

export interface CostBreakdown {
  fuel: number;
  crew: number;
  maintenance: number;
  airport: number;
  navigation: number;
  insurance: number;
  overhead: number;
  total: number;
  perSeat: number;
  perKm: number;
}

export interface ProfitabilityAnalysis {
  totalRevenue: number;
  totalCost: number;
  operatingProfit: number;
  netMargin: number;
  roi: number;
  routes: RouteEconomics[];
  unprofitableRoutes: RouteEconomics[];
  topPerformers: RouteEconomics[];
  recommendations: AgentRecommendation[];
}

// ============================================================================
// Fraud Detection Agent Types
// ============================================================================

export type FraudRiskLevel = "low" | "medium" | "high" | "critical";

export interface FraudSignal {
  signalType: string;
  weight: number;
  description: string;
  value: unknown;
}

export interface FraudAssessment {
  bookingId?: number;
  userId?: number;
  riskScore: number; // 0-100
  riskLevel: FraudRiskLevel;
  signals: FraudSignal[];
  recommendation: "approve" | "review" | "block";
  reasoning: string;
}

export interface FraudPattern {
  patternId: string;
  name: string;
  description: string;
  occurrences: number;
  totalLoss: number;
  detectionRate: number;
  lastSeen: Date;
}

// ============================================================================
// Operations Agent Types
// ============================================================================

export interface DelayPrediction {
  flightId: number;
  flightNumber: string;
  scheduledDeparture: Date;
  predictedDelayMinutes: number;
  confidence: number;
  factors: DelayFactor[];
  recommendation: string;
}

export interface DelayFactor {
  factor: string;
  contribution: number; // 0-1
  description: string;
}

export interface DisruptionForecast {
  date: Date;
  severity: "none" | "minor" | "moderate" | "severe";
  affectedFlights: number;
  causes: string[];
  recommendations: AgentRecommendation[];
}

export interface OperationalHealth {
  otp: number; // On-Time Performance percentage
  completionRate: number;
  averageDelay: number;
  cancellationRate: number;
  turnaroundEfficiency: number;
  crewUtilization: number;
  aircraftUtilization: number;
  alerts: OperationalAlert[];
}

export interface OperationalAlert {
  type:
    | "delay_cascade"
    | "crew_shortage"
    | "maintenance"
    | "weather"
    | "capacity";
  severity: DecisionSeverity;
  message: string;
  affectedFlights: number[];
  suggestedAction: string;
}

// ============================================================================
// Intelligence Kernel Types
// ============================================================================

export interface IntelligenceBriefing {
  generatedAt: Date;
  period: string;
  executionTimeMs: number;
  overallHealth: "excellent" | "good" | "fair" | "poor" | "critical";
  healthScore: number; // 0-100
  economics: {
    summary: string;
    summaryAr: string;
    profitMargin: number;
    trend: string;
    keyMetrics: Record<string, number>;
  };
  operations: {
    summary: string;
    summaryAr: string;
    otp: number;
    alerts: OperationalAlert[];
  };
  fraud: {
    summary: string;
    summaryAr: string;
    blockedTransactions: number;
    savedAmount: number;
    riskLevel: FraudRiskLevel;
  };
  pricing: {
    summary: string;
    summaryAr: string;
    revenueImpact: number;
    activeOptimizations: number;
  };
  topRecommendations: AgentRecommendation[];
  agentResults: AgentResult[];
}

/** Configuration for agent execution */
export interface AgentConfig {
  enabled: boolean;
  timeoutMs: number;
  cacheTtlMs: number;
  priority: number; // 1 = highest
}

/** Intelligence Kernel configuration */
export interface IntelligenceConfig {
  agents: {
    economics: AgentConfig;
    fraud: AgentConfig;
    operations: AgentConfig;
    pricing: AgentConfig;
  };
  briefingCacheTtlMs: number;
  maxConcurrentAgents: number;
}
