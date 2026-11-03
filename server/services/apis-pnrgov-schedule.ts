/**
 * PNRGOV push-time semantics.
 *
 * Authorities receive several pushes of the same flight's PNR data relative
 * to scheduled departure. The usual regime (research note
 * standards_regulation.md, Q2) is a set of pre-departure pushes plus one at
 * departure; the exact KSA timings are not public, so offsets are stored per
 * destination country in `pnrgov_schedules` and the defaults below are a
 * placeholder to be replaced with the NPSC specification.
 *
 * Offsets are minutes relative to the scheduled departure instant (negative
 * before departure). The push instant is zone independent; the airport-local
 * label is attached for operations staff and inspection logs and is computed
 * in the origin airport's IANA zone, so a DST change between the push and the
 * departure shows up as a non-round local interval rather than a wrong push.
 */
import { z } from "zod";
import { isValidTimeZone } from "./civil-day";
import { localCivil } from "./edifact";

/** 24h, 12h and 1h before departure plus at departure; placeholder regime. */
export const DEFAULT_PNRGOV_OFFSETS_MINUTES = [-1440, -720, -60, 0] as const;

export const pnrgovOffsetsSchema = z
  .array(
    z
      .number()
      .int()
      .min(-7 * 1440)
      .max(24 * 60)
  )
  .min(1)
  .max(12)
  .refine(list => new Set(list).size === list.length, {
    message: "Push offsets must be distinct",
  });

export const pnrgovScheduleInputSchema = z.object({
  destinationCountry: z
    .string()
    .regex(/^[A-Za-z]{2,3}$/)
    .transform(v => v.toUpperCase()),
  /** UNB recipient identification agreed with the authority (e.g. NPSC code). */
  authorityCode: z.string().regex(/^[A-Za-z0-9]{2,35}$/),
  messageVersion: z
    .string()
    .regex(/^\d{1,2}:\d{1,2}$/)
    .default("21:1"),
  offsetsMinutes: pnrgovOffsetsSchema,
  /** Where the timing came from (specification reference or "placeholder"). */
  timingSource: z.string().min(1).max(255),
  isActive: z.boolean().default(true),
});
export type PnrgovScheduleInput = z.infer<typeof pnrgovScheduleInputSchema>;

export interface ScheduledPush {
  offsetMinutes: number;
  scheduledAt: Date;
  /** Airport-local wall clock of the push, YYYY-MM-DDTHH:MM, origin zone. */
  localLabel: string;
  /** Whole minutes between the push and departure on the origin wall clock. */
  localMinutesToDeparture: number;
}

export function computePushSchedule(
  departureTime: Date,
  originTimeZone: string,
  offsetsMinutes: readonly number[] = DEFAULT_PNRGOV_OFFSETS_MINUTES
): ScheduledPush[] {
  if (!isValidTimeZone(originTimeZone))
    throw new RangeError("Origin airport time zone is required");
  const offsets = pnrgovOffsetsSchema.parse([...offsetsMinutes]);
  const departureLocal = localCivil(departureTime, originTimeZone);
  const departureWall = wallMinutes(departureLocal);
  return offsets
    .slice()
    .sort((a, b) => a - b)
    .map(offsetMinutes => {
      const scheduledAt = new Date(
        departureTime.getTime() + offsetMinutes * 60_000
      );
      const local = localCivil(scheduledAt, originTimeZone);
      return {
        offsetMinutes,
        scheduledAt,
        localLabel: `${local.ccyymmdd.slice(0, 4)}-${local.ccyymmdd.slice(4, 6)}-${local.ccyymmdd.slice(6, 8)}T${local.hhmm.slice(0, 2)}:${local.hhmm.slice(2, 4)}`,
        localMinutesToDeparture: departureWall - wallMinutes(local),
      };
    });
}

function wallMinutes(civil: ReturnType<typeof localCivil>): number {
  const year = Number(civil.ccyymmdd.slice(0, 4));
  const month = Number(civil.ccyymmdd.slice(4, 6));
  const day = Number(civil.ccyymmdd.slice(6, 8));
  const hours = Number(civil.hhmm.slice(0, 2));
  const minutes = Number(civil.hhmm.slice(2, 4));
  return (
    Date.UTC(year, month - 1, day, hours, minutes) / 60_000 // wall clock as if UTC
  );
}

/** Pushes still ahead of `now`; a late queueing never back-fills missed pushes
 * silently, the caller decides whether to send an immediate catch-up push. */
export function pendingPushes(
  schedule: ScheduledPush[],
  now: Date
): { due: ScheduledPush[]; missed: ScheduledPush[] } {
  return {
    due: schedule.filter(p => p.scheduledAt.getTime() >= now.getTime()),
    missed: schedule.filter(p => p.scheduledAt.getTime() < now.getTime()),
  };
}
