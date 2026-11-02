/**
 * ArrivalDayOffset
 *
 * The small "+1" next to an arrival time when the flight lands on a different
 * calendar day (in the destination's zone) than it departs (in the origin's).
 * Renders nothing for a same-day arrival.
 */

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { formatDayOffset } from "@/lib/flight-time";

export interface ArrivalDayOffsetProps {
  /** From `dayOffset()` in `@/lib/flight-time`. */
  offset: number;
  className?: string;
}

export function ArrivalDayOffset({ offset, className }: ArrivalDayOffsetProps) {
  const { t } = useTranslation();
  const label = formatDayOffset(offset);
  if (!label) return null;
  const title = t("flightTime.dayOffset", { offset: label });
  return (
    <sup
      className={cn(
        "ms-0.5 text-[0.45em] font-semibold text-amber-600 dark:text-amber-400",
        className
      )}
      title={title}
      aria-label={title}
      data-testid="arrival-day-offset"
    >
      {label}
    </sup>
  );
}

export default ArrivalDayOffset;
