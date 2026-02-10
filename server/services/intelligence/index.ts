/**
 * Intelligence Module - Public API
 *
 * Entry point for the AIS Autonomous Intelligence Platform (AAIP).
 *
 * @module services/intelligence
 */

export { intelligenceKernel, IntelligenceKernel } from "./kernel";
export { economicsAgent, EconomicsAgent } from "./economics.agent";
export { fraudAgent, FraudDetectionAgent } from "./fraud.agent";
export { operationsAgent, OperationsAgent } from "./operations.agent";
export { aiGateway, AIGateway } from "./gateway";
export type {
  // Agent framework
  AgentResult,
  AgentRecommendation,
  AgentConfig,
  AgentStatus,
  ConfidenceLevel,
  DecisionSeverity,
  IntelligenceContext,
  IntelligenceConfig,
  IntelligenceBriefing,
  // Economics
  RouteEconomics,
  CostBreakdown,
  ProfitabilityAnalysis,
  // Fraud
  FraudAssessment,
  FraudSignal,
  FraudPattern,
  FraudRiskLevel,
  // Operations
  DelayPrediction,
  DelayFactor,
  DisruptionForecast,
  OperationalHealth,
  OperationalAlert,
} from "./types";
