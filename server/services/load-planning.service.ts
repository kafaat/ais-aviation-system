/**
 * Load Planning Service
 *
 * Handles detailed cargo compartment load planning, optimization,
 * validation, finalization, and post-close amendments (LIR).
 *
 * Works alongside the DCS service for weight & balance, adding
 * compartment-level granularity with ULD calculations.
 */

import { getDb } from "../db";
import {
  flights,
  bookings,
  passengers,
  aircraftTypes,
  baggageItems,
  loadPlans,
} from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ============================================================================
// Inline Schema Types
// ============================================================================

/**
 * cargoCompartments:
 *   id, aircraftTypeId, compartmentCode, name, position(forward/aft/bulk),
 *   maxWeight(int kg*100), maxVolume, uldCompatible(bool), createdAt
 */
export interface CargoCompartment {
  id: number;
  aircraftTypeId: number;
  compartmentCode: string;
  name: string;
  position: "forward" | "aft" | "bulk";
  maxWeight: number; // kg*100
  maxVolume: number; // cubic meters * 100
  uldCompatible: boolean;
  createdAt: string;
}

/**
 * loadPlans (extended):
 *   id, flightId, aircraftTypeId, status(draft/optimized/validated/finalized/amended),
 *   totalPayload, totalBaggage, totalCargo, totalMail, deadload,
 *   lastAmendedAt, finalizedAt, finalizedBy, createdAt, updatedAt
 */
export interface DetailedLoadPlan {
  id: number;
  flightId: number;
  aircraftTypeId: number;
  status: "draft" | "optimized" | "validated" | "finalized" | "amended";
  totalPayload: number;
  totalBaggage: number;
  totalCargo: number;
  totalMail: number;
  deadload: number;
  items: LoadPlanItem[];
  compartments: CompartmentAllocation[];
  lastAmendedAt: string | null;
  finalizedAt: string | null;
  finalizedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * loadPlanItems:
 *   id, loadPlanId, compartmentId, itemType(baggage/cargo/mail/ballast),
 *   description, pieces, weight(int kg*100), volume, uldNumber,
 *   status(planned/loaded/offloaded), createdAt
 */
export interface LoadPlanItem {
  id: number;
  loadPlanId: number;
  compartmentId: number | null;
  itemType: "baggage" | "cargo" | "mail" | "ballast";
  description: string;
  pieces: number;
  weight: number; // kg*100
  volume: number;
  uldNumber: string | null;
  status: "planned" | "loaded" | "offloaded";
  createdAt: string;
}

export interface CompartmentAllocation {
  compartment: CargoCompartment;
  items: LoadPlanItem[];
  totalWeight: number;
  totalVolume: number;
  fillPercentWeight: number;
  fillPercentVolume: number;
}

// ============================================================================
// Standard aircraft compartment layouts
// ============================================================================

const DEFAULT_COMPARTMENT_LAYOUTS: Record<
  string,
  Omit<CargoCompartment, "id" | "aircraftTypeId" | "createdAt">[]
> = {
  // Narrowbody (A320/B737 family)
  narrowbody: [
    {
      compartmentCode: "FWD",
      name: "Forward Cargo Hold",
      position: "forward",
      maxWeight: 340000,
      maxVolume: 1200,
      uldCompatible: false,
    },
    {
      compartmentCode: "AFT",
      name: "Aft Cargo Hold",
      position: "aft",
      maxWeight: 460000,
      maxVolume: 1700,
      uldCompatible: false,
    },
    {
      compartmentCode: "BULK",
      name: "Bulk Cargo Hold",
      position: "bulk",
      maxWeight: 150000,
      maxVolume: 500,
      uldCompatible: false,
    },
  ],
  // Widebody (B777/A330 family)
  widebody: [
    {
      compartmentCode: "FH1",
      name: "Forward Hold 1",
      position: "forward",
      maxWeight: 680000,
      maxVolume: 3000,
      uldCompatible: true,
    },
    {
      compartmentCode: "FH2",
      name: "Forward Hold 2",
      position: "forward",
      maxWeight: 680000,
      maxVolume: 3000,
      uldCompatible: true,
    },
    {
      compartmentCode: "AH1",
      name: "Aft Hold 1",
      position: "aft",
      maxWeight: 1140000,
      maxVolume: 4500,
      uldCompatible: true,
    },
    {
      compartmentCode: "AH2",
      name: "Aft Hold 2",
      position: "aft",
      maxWeight: 680000,
      maxVolume: 2500,
      uldCompatible: true,
    },
    {
      compartmentCode: "BULK",
      name: "Bulk Cargo Compartment",
      position: "bulk",
      maxWeight: 230000,
      maxVolume: 800,
      uldCompatible: false,
    },
  ],
};

// Standard passenger weights (IATA standard averages in kg*100)
const STANDARD_WEIGHTS = {
  adult: 8400,
  child: 3500,
  infant: 1000,
  checkedBagPerPiece: 2000,
};

// ============================================================================
// Helper: get DB or throw
// ============================================================================

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }
  return db;
}

// ============================================================================
// Helper: get flight data for load planning
// ============================================================================

async function getFlightLoadData(flightId: number) {
  const db = await requireDb();

  const [flight] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  // Get passenger counts by type
  const paxResult = await db
    .select({
      type: passengers.type,
      count: sql<number>`COUNT(*)`,
    })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    )
    .groupBy(passengers.type);

  // Get baggage data
  const [bagResult] = await db
    .select({
      totalWeight: sql<number>`COALESCE(SUM(${baggageItems.weight}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(baggageItems)
    .innerJoin(bookings, eq(baggageItems.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    );

  let passengerWeight = 0;
  let passengerCount = 0;
  for (const row of paxResult) {
    const type = row.type as keyof typeof STANDARD_WEIGHTS;
    const weight = STANDARD_WEIGHTS[type] ?? STANDARD_WEIGHTS.adult;
    passengerWeight += weight * Number(row.count);
    passengerCount += Number(row.count);
  }

  const baggageWeight = Math.round(Number(bagResult?.totalWeight ?? 0) * 100); // convert to kg*100
  const baggageCount = Number(bagResult?.count ?? 0);

  return {
    flight,
    passengerCount,
    passengerWeight,
    baggageWeight,
    baggageCount,
  };
}

// ============================================================================
// In-memory store for detailed load plans (simulates extended load plan tables)
// In production these would be in the cargoCompartments / loadPlanItems tables
// ============================================================================

interface StoredLoadPlan {
  plan: DetailedLoadPlan;
  nextItemId: number;
}

const loadPlanStore = new Map<number, StoredLoadPlan>();
let nextPlanId = 100000;

function getStoredPlan(flightId: number): StoredLoadPlan | undefined {
  return loadPlanStore.get(flightId);
}

function recalcPlanTotals(stored: StoredLoadPlan) {
  const plan = stored.plan;
  const activeItems = plan.items.filter(i => i.status !== "offloaded");

  plan.totalBaggage = activeItems
    .filter(i => i.itemType === "baggage")
    .reduce((sum, i) => sum + i.weight, 0);
  plan.totalCargo = activeItems
    .filter(i => i.itemType === "cargo")
    .reduce((sum, i) => sum + i.weight, 0);
  plan.totalMail = activeItems
    .filter(i => i.itemType === "mail")
    .reduce((sum, i) => sum + i.weight, 0);
  plan.deadload = plan.totalBaggage + plan.totalCargo + plan.totalMail;
  plan.totalPayload = plan.deadload;

  // Recalculate compartment allocations
  plan.compartments = plan.compartments.map(ca => {
    const compItems = activeItems.filter(
      i => i.compartmentId === ca.compartment.id
    );
    const totalWeight = compItems.reduce((sum, i) => sum + i.weight, 0);
    const totalVolume = compItems.reduce((sum, i) => sum + i.volume, 0);
    return {
      ...ca,
      items: compItems,
      totalWeight,
      totalVolume,
      fillPercentWeight:
        ca.compartment.maxWeight > 0
          ? Math.round((totalWeight / ca.compartment.maxWeight) * 100)
          : 0,
      fillPercentVolume:
        ca.compartment.maxVolume > 0
          ? Math.round((totalVolume / ca.compartment.maxVolume) * 100)
          : 0,
    };
  });

  plan.updatedAt = new Date().toISOString();
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Create a new detailed load plan for a flight.
 * Generates initial items from passenger baggage data and sets up compartments.
 */
export async function createLoadPlan(flightId: number) {
  const db = await requireDb();

  // Check for existing detailed load plan
  const existing = getStoredPlan(flightId);
  if (
    existing &&
    (existing.plan.status === "finalized" ||
      existing.plan.status === "validated")
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `A ${existing.plan.status} load plan already exists for this flight. Use amend to make changes.`,
    });
  }

  const {
    flight,
    passengerCount: _paxCount,
    baggageWeight,
    baggageCount,
  } = await getFlightLoadData(flightId);

  // Determine aircraft type for compartment layout
  let aircraftTypeId: number | null = null;
  let aircraftData: typeof aircraftTypes.$inferSelect | null = null;

  // Try to find aircraft type from the flight's aircraft type string
  if (flight.aircraftType) {
    const [acType] = await db
      .select()
      .from(aircraftTypes)
      .where(eq(aircraftTypes.code, flight.aircraftType))
      .limit(1);
    if (acType) {
      aircraftTypeId = acType.id;
      aircraftData = acType;
    }
  }

  // If no aircraft type found, try from any existing load plan
  if (!aircraftTypeId) {
    const [existingLP] = await db
      .select()
      .from(loadPlans)
      .where(eq(loadPlans.flightId, flightId))
      .orderBy(sql`${loadPlans.createdAt} DESC`)
      .limit(1);
    if (existingLP) {
      aircraftTypeId = existingLP.aircraftTypeId;
      const [acType] = await db
        .select()
        .from(aircraftTypes)
        .where(eq(aircraftTypes.id, existingLP.aircraftTypeId))
        .limit(1);
      if (acType) aircraftData = acType;
    }
  }

  // Default to first active aircraft type if none found
  if (!aircraftTypeId) {
    const [firstAc] = await db
      .select()
      .from(aircraftTypes)
      .where(eq(aircraftTypes.active, true))
      .limit(1);
    if (firstAc) {
      aircraftTypeId = firstAc.id;
      aircraftData = firstAc;
    }
  }

  if (!aircraftTypeId || !aircraftData) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "No aircraft type configured. Please create an aircraft type first.",
    });
  }

  const validAircraftTypeId = aircraftTypeId;

  // Determine compartment layout
  const isWidebody = aircraftData.totalSeats > 200;
  const layoutKey = isWidebody ? "widebody" : "narrowbody";
  const layoutTemplate = DEFAULT_COMPARTMENT_LAYOUTS[layoutKey];

  // Build compartments with IDs
  const compartments: CargoCompartment[] = layoutTemplate.map((tmpl, idx) => ({
    ...tmpl,
    id: nextPlanId * 100 + idx + 1,
    aircraftTypeId: validAircraftTypeId,
    createdAt: new Date().toISOString(),
  }));

  // Create initial baggage item (all baggage as a single lot)
  const items: LoadPlanItem[] = [];
  let itemIdCounter = 1;

  if (baggageCount > 0) {
    items.push({
      id: itemIdCounter++,
      loadPlanId: nextPlanId,
      compartmentId: null, // unassigned initially
      itemType: "baggage",
      description: `Checked baggage (${baggageCount} pieces)`,
      pieces: baggageCount,
      weight: baggageWeight,
      volume: Math.round(baggageCount * 50), // ~0.5 m3 per bag * 100
      uldNumber: null,
      status: "planned",
      createdAt: new Date().toISOString(),
    });
  }

  // Build compartment allocations
  const compartmentAllocations: CompartmentAllocation[] = compartments.map(
    comp => ({
      compartment: comp,
      items: [],
      totalWeight: 0,
      totalVolume: 0,
      fillPercentWeight: 0,
      fillPercentVolume: 0,
    })
  );

  const plan: DetailedLoadPlan = {
    id: nextPlanId++,
    flightId,
    aircraftTypeId,
    status: "draft",
    totalPayload: baggageWeight,
    totalBaggage: baggageWeight,
    totalCargo: 0,
    totalMail: 0,
    deadload: baggageWeight,
    items,
    compartments: compartmentAllocations,
    lastAmendedAt: null,
    finalizedAt: null,
    finalizedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const stored: StoredLoadPlan = { plan, nextItemId: itemIdCounter };
  loadPlanStore.set(flightId, stored);

  return plan;
}

/**
 * Get the current detailed load plan for a flight.
 */
export function getLoadPlan(flightId: number) {
  const stored = getStoredPlan(flightId);
  if (!stored) {
    return null;
  }
  return stored.plan;
}

/**
 * Assign an item (baggage, cargo, mail) to a specific compartment.
 */
export function assignCompartment(
  flightId: number,
  itemId: number,
  compartmentId: number
) {
  const stored = getStoredPlan(flightId);
  if (!stored) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No load plan found for this flight. Create one first.",
    });
  }

  if (stored.plan.status === "finalized") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Load plan is finalized. Use amend to make changes.",
    });
  }

  const item = stored.plan.items.find(i => i.id === itemId);
  if (!item) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Item not found in load plan.",
    });
  }

  const compartment = stored.plan.compartments.find(
    c => c.compartment.id === compartmentId
  );
  if (!compartment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Compartment not found.",
    });
  }

  // Check weight capacity
  const newWeight = compartment.totalWeight + item.weight;
  if (newWeight > compartment.compartment.maxWeight) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Assigning this item would exceed compartment ${compartment.compartment.compartmentCode} weight limit. Current: ${compartment.totalWeight}, adding: ${item.weight}, max: ${compartment.compartment.maxWeight} (all in kg*100).`,
    });
  }

  // Remove from old compartment if reassigning
  if (item.compartmentId !== null) {
    const oldCompartment = stored.plan.compartments.find(
      c => c.compartment.id === item.compartmentId
    );
    if (oldCompartment) {
      oldCompartment.items = oldCompartment.items.filter(i => i.id !== itemId);
    }
  }

  item.compartmentId = compartmentId;

  recalcPlanTotals(stored);

  return stored.plan;
}

/**
 * Optimize load distribution for CG balance.
 * Distributes unassigned items across compartments to achieve balanced loading.
 */
export function optimizeDistribution(flightId: number) {
  const stored = getStoredPlan(flightId);
  if (!stored) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No load plan found for this flight.",
    });
  }

  if (stored.plan.status === "finalized") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot optimize a finalized load plan.",
    });
  }

  const plan = stored.plan;
  const activeItems = plan.items.filter(i => i.status !== "offloaded");

  // Sort items by weight descending (heaviest first for better distribution)
  const unassigned = activeItems
    .filter(i => i.compartmentId === null)
    .sort((a, b) => b.weight - a.weight);

  if (unassigned.length === 0 && plan.status !== "draft") {
    return plan; // Nothing to optimize
  }

  // Get compartments sorted by position for balanced distribution
  // Strategy: distribute evenly between forward and aft for CG balance
  const forwardComps = plan.compartments.filter(
    c => c.compartment.position === "forward"
  );
  const aftComps = plan.compartments.filter(
    c => c.compartment.position === "aft"
  );
  const bulkComps = plan.compartments.filter(
    c => c.compartment.position === "bulk"
  );

  // Reset all compartment assignments for full re-optimization
  for (const item of activeItems) {
    item.compartmentId = null;
  }

  // Sort all active items by weight descending
  const allItems = [...activeItems].sort((a, b) => b.weight - a.weight);

  // Track running totals per compartment
  const compWeights = new Map<number, number>();
  for (const ca of plan.compartments) {
    compWeights.set(ca.compartment.id, 0);
  }

  // Distribute items using a balanced approach:
  // - Baggage: split between forward and aft holds
  // - Cargo: distribute evenly
  // - Mail: bulk compartment first, then overflow
  // - Ballast: as needed for CG

  const baggageItems_ = allItems.filter(i => i.itemType === "baggage");
  const cargoItems = allItems.filter(i => i.itemType === "cargo");
  const mailItems = allItems.filter(i => i.itemType === "mail");
  const ballastItems = allItems.filter(i => i.itemType === "ballast");

  // Helper: assign to compartment with most remaining capacity in a group
  function assignToBestFit(
    item: LoadPlanItem,
    preferredComps: CompartmentAllocation[]
  ): boolean {
    // Sort by remaining capacity descending
    const candidates = preferredComps
      .map(c => ({
        comp: c,
        remaining:
          c.compartment.maxWeight - (compWeights.get(c.compartment.id) ?? 0),
      }))
      .filter(c => c.remaining >= item.weight)
      .sort((a, b) => b.remaining - a.remaining);

    if (candidates.length > 0) {
      const target = candidates[0];
      item.compartmentId = target.comp.compartment.id;
      compWeights.set(
        target.comp.compartment.id,
        (compWeights.get(target.comp.compartment.id) ?? 0) + item.weight
      );
      return true;
    }
    return false;
  }

  // Distribute baggage: alternate forward/aft for balance
  let fwdTurn = true;
  for (const item of baggageItems_) {
    const primary = fwdTurn ? forwardComps : aftComps;
    const secondary = fwdTurn ? aftComps : forwardComps;
    if (!assignToBestFit(item, primary)) {
      if (!assignToBestFit(item, secondary)) {
        assignToBestFit(item, bulkComps);
      }
    }
    fwdTurn = !fwdTurn;
  }

  // Distribute cargo: prefer aft holds, overflow to forward
  for (const item of cargoItems) {
    if (!assignToBestFit(item, aftComps)) {
      if (!assignToBestFit(item, forwardComps)) {
        assignToBestFit(item, bulkComps);
      }
    }
  }

  // Distribute mail: prefer bulk
  for (const item of mailItems) {
    if (!assignToBestFit(item, bulkComps)) {
      if (!assignToBestFit(item, aftComps)) {
        assignToBestFit(item, forwardComps);
      }
    }
  }

  // Distribute ballast: wherever needed for balance
  for (const item of ballastItems) {
    // Check current forward/aft balance
    const fwdWeight = forwardComps.reduce(
      (sum, c) => sum + (compWeights.get(c.compartment.id) ?? 0),
      0
    );
    const aftWeight = aftComps.reduce(
      (sum, c) => sum + (compWeights.get(c.compartment.id) ?? 0),
      0
    );
    const lighter = fwdWeight <= aftWeight ? forwardComps : aftComps;
    assignToBestFit(item, lighter);
  }

  plan.status = "optimized";
  recalcPlanTotals(stored);

  return plan;
}

/**
 * Validate the load plan against weight limits, volume limits, and CG envelope.
 */
export async function validateLoadPlan(flightId: number) {
  const db = await requireDb();
  const stored = getStoredPlan(flightId);
  if (!stored) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No load plan found for this flight.",
    });
  }

  const plan = stored.plan;
  const warnings: string[] = [];
  const errors: string[] = [];
  let valid = true;

  // Load aircraft type data
  const [aircraft] = await db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, plan.aircraftTypeId))
    .limit(1);

  if (!aircraft) {
    errors.push("Aircraft type not found in database.");
    return { valid: false, warnings, errors };
  }

  // 1. Check unassigned items
  const unassigned = plan.items.filter(
    i => i.compartmentId === null && i.status !== "offloaded"
  );
  if (unassigned.length > 0) {
    errors.push(
      `${unassigned.length} item(s) are not assigned to any compartment.`
    );
    valid = false;
  }

  // 2. Check compartment weight limits
  for (const ca of plan.compartments) {
    if (ca.totalWeight > ca.compartment.maxWeight) {
      errors.push(
        `Compartment ${ca.compartment.compartmentCode} (${ca.compartment.name}): weight ${(ca.totalWeight / 100).toFixed(1)} kg exceeds max ${(ca.compartment.maxWeight / 100).toFixed(1)} kg.`
      );
      valid = false;
    }
    if (ca.fillPercentWeight > 90 && ca.fillPercentWeight <= 100) {
      warnings.push(
        `Compartment ${ca.compartment.compartmentCode}: ${ca.fillPercentWeight}% weight capacity used.`
      );
    }
    if (ca.totalVolume > ca.compartment.maxVolume) {
      errors.push(
        `Compartment ${ca.compartment.compartmentCode}: volume exceeds limit.`
      );
      valid = false;
    }
  }

  // 3. Check overall payload against aircraft max payload (kg*100)
  const totalDeadloadKg = plan.deadload / 100;
  if (totalDeadloadKg > aircraft.maxPayload) {
    errors.push(
      `Total deadload (${totalDeadloadKg.toFixed(0)} kg) exceeds aircraft max payload (${aircraft.maxPayload} kg).`
    );
    valid = false;
  }

  // 4. CG balance check - forward vs aft weight ratio
  const forwardWeight = plan.compartments
    .filter(c => c.compartment.position === "forward")
    .reduce((sum, c) => sum + c.totalWeight, 0);
  const aftWeight = plan.compartments
    .filter(c => c.compartment.position === "aft")
    .reduce((sum, c) => sum + c.totalWeight, 0);
  const totalDistributed = forwardWeight + aftWeight;

  if (totalDistributed > 0) {
    const fwdRatio = forwardWeight / totalDistributed;
    // Acceptable CG range: forward weight should be between 30-70% of total
    if (fwdRatio < 0.25) {
      errors.push(
        `Load is too aft-heavy. Forward holds have only ${Math.round(fwdRatio * 100)}% of total weight.`
      );
      valid = false;
    } else if (fwdRatio > 0.75) {
      errors.push(
        `Load is too forward-heavy. Forward holds have ${Math.round(fwdRatio * 100)}% of total weight.`
      );
      valid = false;
    } else if (fwdRatio < 0.35 || fwdRatio > 0.65) {
      warnings.push(
        `CG balance is marginal. Forward weight ratio: ${Math.round(fwdRatio * 100)}%.`
      );
    }
  }

  // 5. Check that baggage count makes sense
  const { baggageCount } = await getFlightLoadData(flightId);
  const plannedBagPieces = plan.items
    .filter(i => i.itemType === "baggage" && i.status !== "offloaded")
    .reduce((sum, i) => sum + i.pieces, 0);

  if (plannedBagPieces < baggageCount) {
    warnings.push(
      `Only ${plannedBagPieces} of ${baggageCount} checked bags are in the load plan.`
    );
  }

  if (valid && plan.status !== "finalized" && plan.status !== "amended") {
    plan.status = "validated";
    plan.updatedAt = new Date().toISOString();
  }

  return {
    valid,
    warnings,
    errors,
    summary: {
      totalItems: plan.items.filter(i => i.status !== "offloaded").length,
      assignedItems: plan.items.filter(
        i => i.compartmentId !== null && i.status !== "offloaded"
      ).length,
      totalWeightKg: Math.round(plan.deadload / 100),
      forwardWeightKg: Math.round(forwardWeight / 100),
      aftWeightKg: Math.round(aftWeight / 100),
      bulkWeightKg: Math.round(
        plan.compartments
          .filter(c => c.compartment.position === "bulk")
          .reduce((sum, c) => sum + c.totalWeight, 0) / 100
      ),
      compartmentFill: plan.compartments.map(c => ({
        code: c.compartment.compartmentCode,
        name: c.compartment.name,
        position: c.compartment.position,
        weightPercent: c.fillPercentWeight,
        volumePercent: c.fillPercentVolume,
      })),
    },
  };
}

/**
 * Update bulk cargo weight for a specific compartment.
 * Adds or updates a cargo item in the specified compartment.
 */
export function updateBulkLoad(
  flightId: number,
  compartmentCode: string,
  weight: number
) {
  const stored = getStoredPlan(flightId);
  if (!stored) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No load plan found for this flight.",
    });
  }

  if (stored.plan.status === "finalized") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Load plan is finalized. Use amend to make changes.",
    });
  }

  const compartment = stored.plan.compartments.find(
    c => c.compartment.compartmentCode === compartmentCode
  );
  if (!compartment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Compartment ${compartmentCode} not found.`,
    });
  }

  // Look for existing bulk cargo item in this compartment
  const existingBulk = stored.plan.items.find(
    i =>
      i.compartmentId === compartment.compartment.id &&
      i.itemType === "cargo" &&
      i.description.startsWith("Bulk cargo")
  );

  if (existingBulk) {
    existingBulk.weight = weight;
  } else {
    const newItem: LoadPlanItem = {
      id: stored.nextItemId++,
      loadPlanId: stored.plan.id,
      compartmentId: compartment.compartment.id,
      itemType: "cargo",
      description: `Bulk cargo - ${compartmentCode}`,
      pieces: 1,
      weight,
      volume: Math.round(weight * 0.6), // rough volume estimate
      uldNumber: null,
      status: "planned",
      createdAt: new Date().toISOString(),
    };
    stored.plan.items.push(newItem);
  }

  // Reset status to draft if was previously validated/optimized
  if (
    stored.plan.status === "validated" ||
    stored.plan.status === "optimized"
  ) {
    stored.plan.status = "draft";
  }

  recalcPlanTotals(stored);

  return stored.plan;
}

/**
 * Get cargo compartment layout for an aircraft type.
 */
export async function getCompartmentLayout(aircraftTypeId: number) {
  const db = await requireDb();

  const [aircraft] = await db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, aircraftTypeId))
    .limit(1);

  if (!aircraft) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Aircraft type not found.",
    });
  }

  const isWidebody = aircraft.totalSeats > 200;
  const layoutKey = isWidebody ? "widebody" : "narrowbody";
  const layout = DEFAULT_COMPARTMENT_LAYOUTS[layoutKey];

  // Parse custom cargo zones from aircraft type if available
  let customZones: Array<{ zone: string; maxWeight: number }> = [];
  if (aircraft.cargoZones) {
    try {
      customZones = JSON.parse(aircraft.cargoZones);
    } catch {
      // Ignore parse errors
    }
  }

  const compartments: CargoCompartment[] = layout.map((tmpl, idx) => {
    // Override max weight from custom zones if available
    const customZone = customZones.find(z => z.zone === tmpl.compartmentCode);
    return {
      ...tmpl,
      id: aircraftTypeId * 100 + idx + 1,
      aircraftTypeId,
      maxWeight: customZone ? customZone.maxWeight * 100 : tmpl.maxWeight,
      createdAt: new Date().toISOString(),
    };
  });

  return {
    aircraftType: {
      id: aircraft.id,
      code: aircraft.code,
      name: aircraft.name,
      manufacturer: aircraft.manufacturer,
      totalSeats: aircraft.totalSeats,
      isWidebody,
    },
    compartments,
    totalMaxWeight: compartments.reduce((sum, c) => sum + c.maxWeight, 0),
    totalMaxVolume: compartments.reduce((sum, c) => sum + c.maxVolume, 0),
  };
}

/**
 * Calculate ULD (Unit Load Device) requirements for the load plan.
 */
export function calculateULD(flightId: number) {
  const stored = getStoredPlan(flightId);
  if (!stored) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No load plan found for this flight.",
    });
  }

  const plan = stored.plan;

  // Standard ULD types
  const uldTypes = {
    LD3: {
      code: "LD3",
      name: "LD-3 Container",
      maxWeight: 158800,
      maxVolume: 450,
      tareWeight: 7100,
    },
    LD7: {
      code: "LD7",
      name: "LD-7 Container",
      maxWeight: 453600,
      maxVolume: 990,
      tareWeight: 10200,
    },
    PMC: {
      code: "PMC",
      name: "P6 Pallet (PMC)",
      maxWeight: 680400,
      maxVolume: 1200,
      tareWeight: 11000,
    },
  };

  const uldAssignments: Array<{
    compartmentCode: string;
    compartmentName: string;
    uldCompatible: boolean;
    ulds: Array<{
      type: string;
      name: string;
      uldNumber: string;
      contentWeight: number;
      contentVolume: number;
      remainingWeight: number;
      items: Array<{ id: number; description: string; weight: number }>;
    }>;
    bulkItems: Array<{ id: number; description: string; weight: number }>;
  }> = [];

  let uldCounter = 1;

  for (const ca of plan.compartments) {
    const compItems = plan.items.filter(
      i => i.compartmentId === ca.compartment.id && i.status !== "offloaded"
    );

    if (!ca.compartment.uldCompatible) {
      // Bulk hold - no ULDs
      uldAssignments.push({
        compartmentCode: ca.compartment.compartmentCode,
        compartmentName: ca.compartment.name,
        uldCompatible: false,
        ulds: [],
        bulkItems: compItems.map(i => ({
          id: i.id,
          description: i.description,
          weight: i.weight,
        })),
      });
      continue;
    }

    // ULD-compatible compartment: pack items into ULDs
    // Use LD3 for baggage, LD7/PMC for cargo
    const ulds: (typeof uldAssignments)[number]["ulds"] = [];
    const baggageItems__ = compItems.filter(i => i.itemType === "baggage");
    const otherItems = compItems.filter(i => i.itemType !== "baggage");

    // Pack baggage into LD3 containers
    let currentUld: (typeof ulds)[number] | null = null;
    for (const item of baggageItems__) {
      if (
        !currentUld ||
        currentUld.contentWeight + item.weight > uldTypes.LD3.maxWeight
      ) {
        currentUld = {
          type: uldTypes.LD3.code,
          name: uldTypes.LD3.name,
          uldNumber: `AIS${String(uldCounter++).padStart(5, "0")}`,
          contentWeight: 0,
          contentVolume: 0,
          remainingWeight: uldTypes.LD3.maxWeight,
          items: [],
        };
        ulds.push(currentUld);
      }
      currentUld.contentWeight += item.weight;
      currentUld.contentVolume += item.volume;
      currentUld.remainingWeight =
        uldTypes.LD3.maxWeight - currentUld.contentWeight;
      currentUld.items.push({
        id: item.id,
        description: item.description,
        weight: item.weight,
      });
    }

    // Pack cargo/mail into PMC pallets
    let currentPallet: (typeof ulds)[number] | null = null;
    for (const item of otherItems) {
      if (
        !currentPallet ||
        currentPallet.contentWeight + item.weight > uldTypes.PMC.maxWeight
      ) {
        currentPallet = {
          type: uldTypes.PMC.code,
          name: uldTypes.PMC.name,
          uldNumber: `AIS${String(uldCounter++).padStart(5, "0")}`,
          contentWeight: 0,
          contentVolume: 0,
          remainingWeight: uldTypes.PMC.maxWeight,
          items: [],
        };
        ulds.push(currentPallet);
      }
      currentPallet.contentWeight += item.weight;
      currentPallet.contentVolume += item.volume;
      currentPallet.remainingWeight =
        uldTypes.PMC.maxWeight - currentPallet.contentWeight;
      currentPallet.items.push({
        id: item.id,
        description: item.description,
        weight: item.weight,
      });
    }

    uldAssignments.push({
      compartmentCode: ca.compartment.compartmentCode,
      compartmentName: ca.compartment.name,
      uldCompatible: true,
      ulds,
      bulkItems: [],
    });
  }

  const totalULDs = uldAssignments.reduce((sum, a) => sum + a.ulds.length, 0);
  const totalULDWeight = uldAssignments.reduce(
    (sum, a) => sum + a.ulds.reduce((s, u) => s + u.contentWeight, 0),
    0
  );

  return {
    flightId,
    totalULDs,
    totalULDWeightKg: Math.round(totalULDWeight / 100),
    uldTypes: Object.values(uldTypes),
    assignments: uldAssignments,
  };
}

/**
 * Finalize the load plan for departure. Locks the plan and records who finalized it.
 */
export async function finalizeLoadPlan(flightId: number, userId: number) {
  const stored = getStoredPlan(flightId);
  if (!stored) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No load plan found for this flight.",
    });
  }

  const plan = stored.plan;

  if (plan.status === "finalized") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Load plan is already finalized.",
    });
  }

  // Validate before finalizing
  const validation = await validateLoadPlan(flightId);
  if (!validation.valid) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot finalize: ${validation.errors.join("; ")}`,
    });
  }

  plan.status = "finalized";
  plan.finalizedAt = new Date().toISOString();
  plan.finalizedBy = userId;
  plan.updatedAt = new Date().toISOString();

  // Also update the loadPlans table in DB if one exists
  const db = await requireDb();
  const [existingDbPlan] = await db
    .select()
    .from(loadPlans)
    .where(eq(loadPlans.flightId, flightId))
    .orderBy(sql`${loadPlans.createdAt} DESC`)
    .limit(1);

  if (existingDbPlan) {
    await db
      .update(loadPlans)
      .set({
        status: "finalized",
        finalizedBy: userId,
        finalizedAt: new Date(),
      })
      .where(eq(loadPlans.id, existingDbPlan.id));
  }

  return {
    success: true,
    plan,
  };
}

/**
 * Amend a finalized load plan (LIR - Last Info Received).
 * Allows post-close changes such as offloading, adding last-minute items, or weight corrections.
 */
export function amendLoadPlan(
  flightId: number,
  changes: Array<{
    action: "add" | "remove" | "update_weight" | "move";
    itemId?: number;
    newItem?: {
      itemType: "baggage" | "cargo" | "mail" | "ballast";
      description: string;
      pieces: number;
      weight: number;
      volume: number;
      compartmentCode: string;
    };
    newWeight?: number;
    newCompartmentCode?: string;
  }>
) {
  const stored = getStoredPlan(flightId);
  if (!stored) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No load plan found for this flight.",
    });
  }

  const plan = stored.plan;

  if (plan.status !== "finalized" && plan.status !== "amended") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Only finalized or previously amended load plans can be amended via LIR.",
    });
  }

  const amendments: string[] = [];

  for (const change of changes) {
    switch (change.action) {
      case "add": {
        if (!change.newItem) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "newItem is required for add action.",
          });
        }
        const changeNewItem = change.newItem;
        const compartment = plan.compartments.find(
          c => c.compartment.compartmentCode === changeNewItem.compartmentCode
        );
        const newItem: LoadPlanItem = {
          id: stored.nextItemId++,
          loadPlanId: plan.id,
          compartmentId: compartment?.compartment.id ?? null,
          itemType: change.newItem.itemType,
          description: change.newItem.description,
          pieces: change.newItem.pieces,
          weight: change.newItem.weight,
          volume: change.newItem.volume,
          uldNumber: null,
          status: "planned",
          createdAt: new Date().toISOString(),
        };
        plan.items.push(newItem);
        amendments.push(
          `Added ${change.newItem.itemType}: ${change.newItem.description} (${change.newItem.weight} kg*100)`
        );
        break;
      }

      case "remove": {
        if (!change.itemId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "itemId is required for remove action.",
          });
        }
        const item = plan.items.find(i => i.id === change.itemId);
        if (!item) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Item ${change.itemId} not found.`,
          });
        }
        item.status = "offloaded";
        amendments.push(`Offloaded item ${item.id}: ${item.description}`);
        break;
      }

      case "update_weight": {
        if (!change.itemId || change.newWeight === undefined) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "itemId and newWeight are required for update_weight action.",
          });
        }
        const item = plan.items.find(i => i.id === change.itemId);
        if (!item) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Item ${change.itemId} not found.`,
          });
        }
        const oldWeight = item.weight;
        item.weight = change.newWeight;
        amendments.push(
          `Updated weight for item ${item.id} (${item.description}): ${oldWeight} -> ${change.newWeight} kg*100`
        );
        break;
      }

      case "move": {
        if (!change.itemId || !change.newCompartmentCode) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "itemId and newCompartmentCode are required for move action.",
          });
        }
        const item = plan.items.find(i => i.id === change.itemId);
        if (!item) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Item ${change.itemId} not found.`,
          });
        }
        const targetComp = plan.compartments.find(
          c => c.compartment.compartmentCode === change.newCompartmentCode
        );
        if (!targetComp) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Compartment ${change.newCompartmentCode} not found.`,
          });
        }
        const oldCompId = item.compartmentId;
        item.compartmentId = targetComp.compartment.id;
        amendments.push(
          `Moved item ${item.id} (${item.description}) from compartment ${oldCompId} to ${change.newCompartmentCode}`
        );
        break;
      }

      default:
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown action: ${change.action}`,
        });
    }
  }

  plan.status = "amended";
  plan.lastAmendedAt = new Date().toISOString();
  recalcPlanTotals(stored);

  return {
    plan,
    amendments,
  };
}
