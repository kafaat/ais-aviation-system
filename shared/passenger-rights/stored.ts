// Mapping between the claim-type names stored on compensation_claims (legacy
// "delay" included) and the engine's claim types. Shared by server and client.
import type { ClaimType, Jurisdiction } from "./types";

export const CLAIM_TYPE_BY_STORED = {
  delay: "arrival_delay",
  cancellation: "cancellation",
  denied_boarding: "denied_boarding",
  downgrade: "downgrade",
  baggage_delay: "baggage_delay",
  baggage_loss: "baggage_loss",
  baggage_damage: "baggage_damage",
  tarmac_delay: "tarmac_delay",
  care: "care",
} as const satisfies Record<string, ClaimType>;
export type StoredClaimType = keyof typeof CLAIM_TYPE_BY_STORED;

export const JURISDICTION_BY_REGULATION = {
  local: "KSA-GACA-2023",
  eu261: "EU261-2004",
  uk261: "UK261",
  dot: "US-DOT-14CFR260",
} as const satisfies Record<string, Jurisdiction>;
export type RegulationType = keyof typeof JURISDICTION_BY_REGULATION;
