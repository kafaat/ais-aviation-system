import { getDb } from "../../db";
import {
  bookings,
  flights,
  demandPredictions,
  aiPricingModels,
} from "../../../drizzle/schema";
import { eq, and, gte, lte, lt, sql } from "drizzle-orm";
import { errorMetrics, temporalForecast } from "./temporal-forecast";
export type ForecastAccuracy = ReturnType<typeof errorMetrics>;
export interface DemandForecast {
  flightId: number;
  date: Date;
  cabinClass: "economy" | "business";
  predictedDemand: number;
  confidenceLower: number;
  confidenceUpper: number;
  confidenceLevel: number | null;
  recommendedPrice: number;
  recommendedMultiplier: number;
  featureImportances: Record<string, number>;
  modelVersion: string;
  target: "booked_departing_passengers";
  trainingCutoff: Date;
  sampleCount: number;
  evaluation: ReturnType<typeof temporalForecast>["evaluation"];
}
const VERSION = "v2-rolling-origin-shadow";
export async function forecastFlightDemand(
  flightId: number,
  cabinClass: "economy" | "business",
  horizonDays = 14
): Promise<DemandForecast[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (
    !Number.isSafeInteger(horizonDays) ||
    horizonDays < 1 ||
    horizonDays > 365
  )
    throw new Error("Invalid forecast horizon");
  const [flight] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!flight || flight.departureTime <= new Date())
    throw new Error("A future flight instance is required");
  const cutoff = new Date();
  const from = new Date(cutoff.getTime() - 365 * 86400000);
  // One row per historical flight. Multi-city bookings match a segment once via EXISTS.
  const rows = await db
    .select({
      date: flights.departureTime,
      demand: sql<number>`COALESCE(SUM(${bookings.numberOfPassengers}),0)`,
    })
    .from(flights)
    .leftJoin(
      bookings,
      sql`(${bookings.flightId} = ${flights.id} OR EXISTS (SELECT 1 FROM booking_segments bs WHERE bs.bookingId = ${bookings.id} AND bs.flightId = ${flights.id})) AND ${bookings.cabinClass} = ${cabinClass} AND ${bookings.status} IN ('confirmed','completed') AND ${bookings.createdAt} <= ${flights.departureTime}`
    )
    .where(
      and(
        eq(flights.originId, flight.originId),
        eq(flights.destinationId, flight.destinationId),
        eq(flights.airlineId, flight.airlineId),
        sql`${flights.tenantId} <=> ${flight.tenantId}`,
        gte(flights.departureTime, from),
        lt(flights.departureTime, cutoff),
        eq(flights.status, "completed")
      )
    )
    .groupBy(flights.id, flights.departureTime)
    .orderBy(flights.departureTime)
    .limit(5001);
  if (rows.length > 5000)
    throw new Error("Historical window exceeds forecast limit");
  const result = temporalForecast(
    rows.map(r => ({ date: new Date(r.date), demand: Number(r.demand) })),
    flight.departureTime
  );
  const forecast: DemandForecast = {
    flightId,
    date: flight.departureTime,
    cabinClass,
    predictedDemand: result.predicted,
    confidenceLower: result.lower,
    confidenceUpper: result.upper,
    confidenceLevel: result.evaluation.empiricalCoverage,
    recommendedPrice:
      cabinClass === "economy" ? flight.economyPrice : flight.businessPrice,
    recommendedMultiplier: 1,
    featureImportances: {},
    modelVersion: VERSION,
    target: "booked_departing_passengers",
    trainingCutoff: result.trainingCutoff,
    sampleCount: result.sampleCount,
    evaluation: result.evaluation,
  };
  await db.transaction(async tx => {
    const [existing] = await tx
      .select()
      .from(aiPricingModels)
      .where(
        and(
          eq(aiPricingModels.modelType, "demand_forecast"),
          eq(aiPricingModels.version, VERSION)
        )
      )
      .limit(1);
    const modelId =
      existing?.id ??
      Number(
        (
          await tx.insert(aiPricingModels).values({
            name: "Temporal baseline comparison (shadow)",
            version: VERSION,
            modelType: "demand_forecast",
            config: JSON.stringify({
              target: forecast.target,
              temporalSelection: 14,
              validation: 14,
              nominalCoverage: 0.9,
            }),
            status: "validating",
          })
        )[0].insertId
      );
    await tx.insert(demandPredictions).values({
      modelId,
      flightId,
      predictionDate: forecast.date,
      cabinClass,
      predictedDemand: forecast.predictedDemand.toFixed(2),
      confidenceLower: forecast.confidenceLower.toFixed(2),
      confidenceUpper: forecast.confidenceUpper.toFixed(2),
      confidenceLevel: forecast.confidenceLevel?.toFixed(4) ?? null,
      recommendedPrice: forecast.recommendedPrice,
      recommendedMultiplier: "1",
      featureImportances: "{}",
      trainingCutoffAt: forecast.trainingCutoff,
      diagnostics: {
        ...forecast.evaluation,
        sampleCount: forecast.sampleCount,
        model: result.model,
        target: forecast.target,
      },
    });
  });
  return [forecast];
}
export async function forecastRouteDemand(
  originId: number,
  destinationId: number,
  cabinClass: "economy" | "business",
  startDate: Date,
  endDate: Date
): Promise<DemandForecast[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (
    !(startDate instanceof Date) ||
    !(endDate instanceof Date) ||
    endDate < startDate
  )
    throw new Error("Invalid route forecast interval");
  const rows = await db
    .select({ id: flights.id })
    .from(flights)
    .where(
      and(
        eq(flights.originId, originId),
        eq(flights.destinationId, destinationId),
        gte(flights.departureTime, startDate),
        lte(flights.departureTime, endDate),
        eq(flights.status, "scheduled")
      )
    )
    .limit(101);
  if (rows.length > 100) throw new Error("Narrow the route forecast interval");
  const results: DemandForecast[] = [];
  for (const row of rows)
    results.push(...(await forecastFlightDemand(row.id, cabinClass)));
  return results;
}
/** Observe completed flight outcomes; no client-supplied actuals are accepted. */
export async function reconcileForecastOutcomes(modelId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [model] = await db
    .select()
    .from(aiPricingModels)
    .where(
      and(eq(aiPricingModels.id, modelId), eq(aiPricingModels.version, VERSION))
    )
    .limit(1);
  if (!model)
    throw new Error("Outcome definition is unavailable for this model version");
  return db.transaction(async tx => {
    const predictions = await tx
      .select()
      .from(demandPredictions)
      .where(
        and(
          eq(demandPredictions.modelId, modelId),
          lt(demandPredictions.predictionDate, new Date()),
          sql`${demandPredictions.actualDemand} IS NULL`
        )
      )
      .limit(1000)
      .for("update");
    let observed = 0;
    for (const prediction of predictions) {
      if (
        !prediction.flightId ||
        prediction.createdAt >= prediction.predictionDate
      )
        continue;
      const [flight] = await tx
        .select()
        .from(flights)
        .where(
          and(
            eq(flights.id, prediction.flightId),
            eq(flights.status, "completed")
          )
        )
        .limit(1);
      if (!flight) continue;
      const [outcome] = await tx
        .select({
          demand: sql<number>`COALESCE(SUM(${bookings.numberOfPassengers}),0)`,
        })
        .from(bookings)
        .where(
          sql`(${bookings.flightId} = ${flight.id} OR EXISTS (SELECT 1 FROM booking_segments bs WHERE bs.bookingId = ${bookings.id} AND bs.flightId = ${flight.id})) AND ${bookings.cabinClass} = ${prediction.cabinClass} AND ${bookings.status} IN ('confirmed','completed') AND ${bookings.createdAt} <= ${prediction.predictionDate}`
        );
      const demand = Number(outcome?.demand);
      if (!Number.isSafeInteger(demand) || demand < 0)
        throw new Error("Invalid flight outcome");
      await tx
        .update(demandPredictions)
        .set({ actualDemand: String(demand) })
        .where(eq(demandPredictions.id, prediction.id));
      observed++;
    }
    return { observed, examined: predictions.length };
  });
}

/** Scores only predictions created before their target and with observed outcomes. */
export async function evaluateForecastAccuracy(
  modelId: number,
  periodDays = 30
): Promise<ForecastAccuracy> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (!Number.isSafeInteger(periodDays) || periodDays < 1 || periodDays > 365)
    throw new Error("Invalid evaluation interval");
  const now = new Date();
  const from = new Date(now.getTime() - periodDays * 86400000);
  const rows = await db
    .select()
    .from(demandPredictions)
    .where(
      and(
        eq(demandPredictions.modelId, modelId),
        gte(demandPredictions.predictionDate, from),
        lt(demandPredictions.predictionDate, now),
        sql`${demandPredictions.createdAt} < ${demandPredictions.predictionDate}`,
        sql`${demandPredictions.actualDemand} IS NOT NULL`
      )
    )
    .limit(10001);
  if (rows.length > 10000) throw new Error("Evaluation window exceeds limit");
  // One earliest forecast per flight/cabin/target, preventing frequent queries from overweighting a flight.
  const unique = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.flightId}:${row.cabinClass}:${row.predictionDate.toISOString()}`;
    const prior = unique.get(key);
    if (!prior || row.createdAt < prior.createdAt) unique.set(key, row);
  }
  return errorMetrics(
    [...unique.values()].map(r => ({
      predicted: Number(r.predictedDemand),
      actual: Number(r.actualDemand),
    }))
  );
}
export const DemandForecastingService = {
  forecastFlightDemand,
  forecastRouteDemand,
  evaluateForecastAccuracy,
  reconcileForecastOutcomes,
};
