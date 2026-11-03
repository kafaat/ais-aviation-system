import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { airports, flights, type FareRule } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { getApplicableRules } from "./fare-rules.service";
import {
  CIVIL_DATE,
  civilDateInZone,
  civilDayWindowUtc,
  isValidTimeZone,
} from "./civil-day";

const type = z.enum(["adult", "child", "infant"]);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const days = z.number().int().nonnegative();
const advance = z
  .object({
    minDaysBeforeDeparture: days,
    maxDaysBeforeDeparture: days.optional(),
  })
  .strict();
const eligibility = z
  .object({
    passengerTypes: z.array(type).optional(),
    requireCorporateId: z.boolean().optional(),
    requireLoyaltyMembership: z.boolean().optional(),
  })
  .strict();
const application = z
  .object({
    flightNumbers: z.array(z.string()).optional(),
    aircraftTypes: z.array(z.string()).optional(),
    directOnly: z.boolean().optional(),
  })
  .strict();
const dayTime = z
  .object({
    allowedDaysOfWeek: z.array(days.max(6)).optional(),
    departureTimeFrom: clock.optional(),
    departureTimeTo: clock.optional(),
  })
  .strict();
const endpoint = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const blackout = z
  .object({
    blackoutPeriods: z
      .array(
        z
          .object({
            start: endpoint,
            end: endpoint,
            reason: z.string().optional(),
          })
          .strict()
      )
      .optional(),
    periods: z
      .array(
        z
          .object({
            from: endpoint,
            to: endpoint,
            reason: z.string().optional(),
          })
          .strict()
      )
      .optional(),
  })
  .strict();

type SaleFlight = Pick<
  typeof flights.$inferSelect,
  | "id"
  | "originId"
  | "destinationId"
  | "departureTime"
  | "flightNumber"
  | "aircraftType"
>;
function unavailable(message: string): never {
  throw new TRPCError({ code: "PRECONDITION_FAILED", message });
}

/** Gate the named-class sale on evidence available to this channel. Until its
 * pricing/itinerary engine can apply a configured term, do not sell it at the
 * unrestricted cabin price. The signed offer also pins the rule set. */
export function checkSaleFareRules(
  rules: FareRule[],
  flight: SaleFlight,
  passengerTypes: readonly string[],
  segmentCount: number,
  timeZone?: string | null,
  now = new Date()
) {
  for (const rule of rules) {
    const reject = (reason: string) =>
      unavailable(`Fare rule "${rule.ruleName}": ${reason}`);
    let data: unknown;
    try {
      data = JSON.parse(rule.conditions);
    } catch {
      reject("Invalid rule conditions");
    }
    if (
      Number(rule.priceMultiplier ?? 1) !== 1 ||
      (rule.priceAdjustment ?? 0) !== 0
    )
      reject("This rule's price adjustment is unavailable for online sale");
    switch (rule.ruleCategory) {
      case "advance_purchase": {
        const r = advance.parse(data);
        const before = Math.floor(
          (flight.departureTime.getTime() - now.getTime()) / 86_400_000
        );
        if (
          before < r.minDaysBeforeDeparture ||
          (r.maxDaysBeforeDeparture !== undefined &&
            before > r.maxDaysBeforeDeparture)
        )
          reject("Outside the advance purchase period");
        break;
      }
      case "eligibility": {
        const r = eligibility.parse(data);
        if (r.requireCorporateId || r.requireLoyaltyMembership)
          reject("Verified passenger credentials are required");
        if (
          r.passengerTypes?.length &&
          passengerTypes.some(
            t => !r.passengerTypes?.some(allowed => allowed === t)
          )
        )
          reject("Passenger type is ineligible");
        break;
      }
      case "flight_application": {
        const r = application.parse(data);
        if (
          (r.flightNumbers?.length &&
            !r.flightNumbers.includes(flight.flightNumber)) ||
          (r.aircraftTypes?.length &&
            !r.aircraftTypes.includes(flight.aircraftType ?? "")) ||
          (r.directOnly && segmentCount !== 1)
        )
          reject("Flight is ineligible");
        break;
      }
      case "day_time": {
        const r = dayTime.parse(data);
        if (!isValidTimeZone(timeZone))
          return reject("Origin time zone is required");
        const civil = civilDateInZone(flight.departureTime, timeZone);
        const weekday = new Date(civil + "T00:00:00Z").getUTCDay();
        const local = new Intl.DateTimeFormat("en-GB", {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(flight.departureTime);
        const from = r.departureTimeFrom ?? "00:00",
          to = r.departureTimeTo ?? "23:59";
        const inside =
          from <= to
            ? local >= from && local <= to
            : local >= from || local <= to;
        if (
          !inside ||
          (r.allowedDaysOfWeek?.length &&
            !r.allowedDaysOfWeek.includes(weekday))
        )
          reject("Outside permitted local departure day or time");
        break;
      }
      case "blackout_dates": {
        const r = blackout.parse(data);
        const periods = [
          ...(r.blackoutPeriods ?? []),
          ...(r.periods ?? []).map(p => ({ start: p.from, end: p.to })),
        ];
        if (!periods.length) reject("No valid blackout dates configured");
        const instant = (value: string, end: boolean) => {
          if (!CIVIL_DATE.test(value)) return Date.parse(value);
          if (!isValidTimeZone(timeZone))
            return reject("Origin time zone is required");
          const window = civilDayWindowUtc(value, timeZone);
          return end ? window.end.getTime() - 1 : window.start.getTime();
        };
        for (const period of periods) {
          const start = instant(period.start, false);
          const end = instant(period.end, true);
          if (end < start) reject("Blackout ends before it starts");
          const departure = flight.departureTime.getTime();
          if (departure >= start && departure <= end)
            reject("Departure is within a blackout period");
        }
        break;
      }
      default:
        reject(
          "This fare condition requires a servicing channel that supports it"
        );
    }
  }
  return rules.length
    ? createHash("sha256")
        .update(
          JSON.stringify(
            rules.map(r => [
              r.id,
              r.ruleCategory,
              r.conditions,
              r.priceMultiplier,
              r.priceAdjustment,
              r.validFrom,
              r.validUntil,
              r.originAirportId,
              r.destinationAirportId,
            ])
          )
        )
        .digest("hex")
    : undefined;
}

export async function saleFareRuleDigest(
  db: SettlementTx,
  flight: SaleFlight,
  fareClassId: number,
  passengerTypes: readonly string[],
  segmentCount: number
) {
  const rules = await getApplicableRules(
    fareClassId,
    flight.originId,
    flight.destinationId,
    flight.departureTime,
    db
  );
  let zone: string | null = null;
  if (
    rules.some(
      r => r.ruleCategory === "day_time" || r.ruleCategory === "blackout_dates"
    )
  ) {
    const [origin] = await db
      .select({ timezone: airports.timezone })
      .from(airports)
      .where(eq(airports.id, flight.originId))
      .limit(1);
    zone = origin?.timezone ?? null;
  }
  try {
    return checkSaleFareRules(
      rules,
      flight,
      passengerTypes,
      segmentCount,
      zone
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      unavailable("Fare rule conditions cannot be verified for online sale");
    throw error;
  }
}
