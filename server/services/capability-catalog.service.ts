/** Technical ownership and evidence requirements, not a claim of operational certification. */
export const capabilityCatalog = [
  {
    id: "ndcUnpaidServicing",
    implementation: "implemented",
    owner: "ndc-unpaid.service and booking-invoice.service",
    consumer: "ndc.changeOrder and ndc.addServices",
    requirement:
      "Unpaid pending invoice, no active checkout, same airline/tenant SAR economy or business offer, canonical passengers; no EMD or external fulfillment certification",
  },
  {
    id: "ndcPaidServicing",
    implementation: "implemented",
    owner: "order-servicing.service and payment-settlement.service",
    consumer:
      "ndc.quotePaidService, ndc.confirmNoChargeService and payments.createModificationCheckout",
    requirement:
      "Local paid SAR itinerary exchange and catalog entitlements before check-in; same tenant/airline and cabin across up to six segments, no unresolved ancillary fulfillment. Original Stripe payer refund receipts required for a lower fare.",
  },
  {
    id: "ndcExternalFulfillment",
    implementation: "blocked",
    owner: "contracted ticket/EMD provider",
    consumer: "order servicing fulfillment",
    requirement:
      "Contracted ticket reissue/EMD acceptance remains separate from local reservation, collection and refund receipts",
  },
  {
    id: "kioskHardware",
    implementation: "blocked",
    owner: "kiosk.service",
    consumer: "kiosk",
    requirement:
      "Authenticated device heartbeat and physical printer/scanner acceptance; digital documents are separate",
  },
  {
    id: "dcsDispatch",
    implementation: "demo",
    owner: "dcs.service",
    consumer: "dcs",
    requirement: "Verified departure-control provider and dispatch acceptance",
  },
  {
    id: "gdsSynchronization",
    implementation: "demo",
    owner: "gds.service",
    consumer: "gds",
    requirement:
      "Contracted GDS connection and round-trip order synchronization",
  },
  {
    id: "biometricIdentity",
    implementation: "demo",
    owner: "biometric.service",
    consumer: "biometric",
    requirement:
      "Approved biometric processor, measured verification and privacy controls",
  },
  {
    id: "multiRegionFailover",
    implementation: "demo",
    owner: "multi-region.service",
    consumer: "multiRegion",
    requirement:
      "Infrastructure adapter, replication evidence and controlled failover drill",
  },
  {
    id: "apisSubmission",
    implementation: "blocked",
    owner: "apis.service",
    consumer: "apis.submit",
    requirement:
      "Authority transport, credentials, acknowledgement and rejection fixtures",
  },
  {
    id: "alternatePayments",
    implementation: "blocked",
    owner: "payment-providers",
    consumer: "payments",
    requirement:
      "Invoice/session binding, amount/currency verification, settlement and refund acceptance for each provider",
  },
  {
    id: "bagDropHardware",
    implementation: "demo",
    owner: "bag-drop.service",
    consumer: "bagDrop",
    requirement:
      "Certified scale, printer, conveyor and device heartbeat adapter",
  },
  {
    id: "weightBalance",
    implementation: "demo",
    owner: "weight-balance.service",
    consumer: "weightBalance",
    requirement:
      "Approved aircraft data, calculation validation and operational sign-off",
  },
  {
    id: "loadPlanning",
    implementation: "demo",
    owner: "load-planning.service",
    consumer: "loadPlanning",
    requirement:
      "Aircraft configuration, measured cargo and approved dispatch workflow",
  },
  {
    id: "disasterRecovery",
    implementation: "demo",
    owner: "disaster-recovery.service",
    consumer: "disasterRecovery",
    requirement:
      "Infrastructure adapter and observed restore/failover exercise",
  },
  {
    id: "warehouseExports",
    implementation: "implemented",
    owner: "data-warehouse.service",
    consumer: "dataWarehouse and authenticated download",
    requirement:
      "Migration applied; shared database and authorized export owner",
  },
  {
    id: "eventInbox",
    implementation: "implemented",
    owner: "event-inbox.service",
    consumer: "outbox and notifications",
    requirement:
      "Migration applied; local transaction or authenticated receiver acknowledgement",
  },
  {
    id: "scheduledTasks",
    implementation: "implemented",
    owner: "scheduled-task.service",
    consumer: "cron and operations",
    requirement: "Shared database lease and observed lastSuccessAt",
  },
  {
    id: "slaObservations",
    implementation: "implemented",
    owner: "sla-monitoring.service",
    consumer: "slaMonitoring",
    requirement:
      "Process-local observations only; fleet and contractual SLA require durable telemetry",
  },
] as const;

export function listCapabilities() {
  const demosEnabled =
    process.env.NODE_ENV !== "production" &&
    process.env.AIS_ENABLE_DEMOS === "true";
  return capabilityCatalog.map(capability => ({
    ...capability,
    available:
      capability.implementation === "implemented" ||
      (capability.implementation === "demo" && demosEnabled),
    evidence:
      "Implementation status; deployment acceptance must be recorded separately" as const,
  }));
}
