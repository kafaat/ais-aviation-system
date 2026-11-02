import { TRPCError } from "@trpc/server";

/** Simulators are explicit development fixtures, never production integrations. */
export function demoCapabilitiesEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.AIS_ENABLE_DEMOS === "true"
  );
}

export function requireDemoCapability(capability: string) {
  if (!demoCapabilitiesEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${capability} has no verified production adapter configured`,
    });
  }
}
