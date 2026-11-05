import { TRPCError } from "@trpc/server";
import { demoCapabilitiesEnabled } from "./demo-capability";

/** Configuration rows and published carrier support do not install an adapter. */
export function getGdsExecutionCapability() {
  return {
    externalExecutionAvailable: false as const,
    simulationAvailable: demoCapabilitiesEnabled(),
    reason: "accepted_gds_adapter_unavailable" as const,
  };
}

export function getNdcExecutionCapability() {
  return {
    localDirectOrdersAvailable: true as const,
    externalExecutionAvailable: false as const,
    reason: "accepted_external_ndc_adapter_unavailable" as const,
  };
}

export function getInterlineExecutionCapability() {
  return {
    scope: "local_agreement_planning" as const,
    externalExecutionAvailable: false as const,
    reason: "accepted_interline_transport_unavailable" as const,
  };
}

/** Applies at service boundaries too, including calls outside the tRPC router. */
export function requireLocalNdcOrigin(input: {
  channel?: string | null;
  distributorId?: string | null;
}) {
  if (
    (input.channel != null && input.channel !== "direct") ||
    input.distributorId != null
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "External NDC channels and sellers require an accepted provider adapter; only local direct orders are executable",
    });
  }
}
