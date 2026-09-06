/**
 * NDC Order State Machine
 *
 * Formalizes the IATA ONE Order lifecycle that was previously enforced by
 * ad-hoc inline checks scattered across ndc.service.ts. Centralizing the
 * allowed transitions makes the order lifecycle explicit, testable, and safe to
 * extend (the strategy's "more states + governance"). Pure module — no DB.
 */

import { TRPCError } from "@trpc/server";

export type NdcOrderStatus =
  | "pending" // created, awaiting payment
  | "confirmed" // payment confirmed, tickets pending
  | "ticketed" // tickets issued
  | "partially_ticketed"
  | "changed" // modified
  | "cancelled"
  | "refunded";

/**
 * Allowed forward transitions. Terminal states (`refunded`) have none.
 * `cancelled` may still proceed to `refunded`.
 */
export const NDC_ORDER_TRANSITIONS: Record<NdcOrderStatus, NdcOrderStatus[]> = {
  pending: ["confirmed", "ticketed", "changed", "cancelled"],
  confirmed: ["ticketed", "partially_ticketed", "changed", "cancelled"],
  ticketed: ["changed", "cancelled", "refunded"],
  partially_ticketed: ["ticketed", "changed", "cancelled", "refunded"],
  changed: [
    "confirmed",
    "ticketed",
    "partially_ticketed",
    "cancelled",
    "refunded",
  ],
  cancelled: ["refunded"],
  refunded: [],
};

export function isValidNdcOrderTransition(
  from: NdcOrderStatus,
  to: NdcOrderStatus
): boolean {
  if (from === to) return false;
  return NDC_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidNdcOrderTransitions(
  from: NdcOrderStatus
): NdcOrderStatus[] {
  return NDC_ORDER_TRANSITIONS[from] ?? [];
}

export function isTerminalNdcOrderStatus(status: NdcOrderStatus): boolean {
  return getValidNdcOrderTransitions(status).length === 0;
}

/** Whether an order in `from` may move to `to` (used to guard cancel/change). */
export function canTransitionTo(
  from: NdcOrderStatus,
  to: NdcOrderStatus
): boolean {
  return isValidNdcOrderTransition(from, to);
}

/**
 * Throw a consistent error if a transition is not allowed.
 */
export function assertNdcOrderTransition(
  from: NdcOrderStatus,
  to: NdcOrderStatus,
  action = "transition"
): void {
  if (!isValidNdcOrderTransition(from, to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `NDC order cannot ${action}. Current status: ${from}`,
    });
  }
}
