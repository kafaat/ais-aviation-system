import { TRPCError } from "@trpc/server";
import { providerBoundary } from "../_core/provider-boundary";
import { demoCapabilitiesEnabled } from "./demo-capability";

/** No production Type B sender or authenticated authority receiver is installed.
 * A deployment flag and a locally accepted route cannot supply either adapter.
 */
export function getOperationalTransportCapability() {
  const simulationAvailable =
    demoCapabilitiesEnabled() &&
    process.env.AIS_TYPE_B_TRANSPORT_ENABLED === "true" &&
    providerBoundary() === "open";
  return {
    mode: simulationAvailable ? ("simulation" as const) : ("disabled" as const),
    simulationAvailable,
    externalTransmissionAvailable: false as const,
    productionWorkerAvailable: false as const,
    authenticatedAcknowledgmentAvailable: false as const,
    reason: "accepted_transport_adapter_unavailable" as const,
  };
}

export function requireOperationalTransportSimulation() {
  if (!getOperationalTransportCapability().simulationAvailable)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "No verified operational transport or authenticated acknowledgment adapter is installed; only explicitly enabled nonproduction simulations may execute",
    });
}

export const simulatedTransportOutcome = {
  execution: "simulation" as const,
  externallyTransmitted: false as const,
};
