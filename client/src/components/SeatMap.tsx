import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface Seat {
  id: string;
  row: number;
  column: string;
  status: "available" | "selected" | "occupied";
  class: "economy" | "business";
}
interface SeatMapProps {
  flightId?: number;
  cabinClass?: "economy" | "business";
  maxSeats?: number;
  aircraftType?: string;
  onSeatSelect?: (seats: Seat[]) => void;
}

/** Every displayed seat comes from the selected flight's physical inventory. */
export function SeatMap({
  flightId,
  cabinClass = "economy",
  maxSeats = 1,
  onSeatSelect,
}: SeatMapProps) {
  const { t } = useTranslation();
  const query = trpc.seatMap.getFlightSeatMap.useQuery(
    { flightId: flightId ?? 0 },
    { enabled: Boolean(flightId), retry: false, refetchOnWindowFocus: true }
  );
  const [selection, setSelection] = useState<{
    flightId?: number;
    cabin: string;
    ids: string[];
  }>({ flightId, cabin: cabinClass, ids: [] });
  const selected =
    selection.flightId === flightId && selection.cabin === cabinClass
      ? selection.ids
      : [];
  const rows =
    query.data?.cabins.find(c => c.cabinClass === cabinClass)?.rows ?? [];
  const seats = useMemo(() => rows.flatMap(row => row.seats), [rows]);
  const choose = (id: string) => {
    const available = new Set(
      seats
        .filter(s => s.status === "available" && s.seatPrice === 0)
        .map(s => s.seatNumber)
    );
    const current = selected.filter(n => available.has(n));
    const next = current.includes(id)
      ? current.filter(n => n !== id)
      : current.length < maxSeats
        ? [...current, id]
        : current;
    setSelection({ flightId, cabin: cabinClass, ids: next });
    onSeatSelect?.(
      next.flatMap(n => {
        const seat = seats.find(s => s.seatNumber === n);
        return seat
          ? [
              {
                id: n,
                row: seat.row,
                column: seat.column,
                status: "selected" as const,
                class: cabinClass,
              },
            ]
          : [];
      })
    );
  };
  return (
    <Card className="p-4 space-y-4">
      <h3 className="font-semibold">{t("checkIn.selectSeats")}</h3>
      {!flightId || query.isError || (!query.isLoading && !rows.length) ? (
        <p role="alert">{t("checkIn.inventoryUnavailable")}</p>
      ) : query.isLoading ? (
        <p role="status">{t("common.loading")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {query.data?.aircraftType} · {t(`cabin.${cabinClass}`)}
          </p>
          <div className="overflow-x-auto space-y-2" dir="ltr">
            {rows.map(row => (
              <div
                key={row.row}
                className="flex items-center justify-center gap-2 min-w-max"
              >
                <span className="w-8 text-sm">{row.row}</span>
                {row.seats.map(seat => (
                  <Button
                    key={seat.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`${seat.seatNumber} ${seat.status}`}
                    aria-pressed={selected.includes(seat.seatNumber)}
                    disabled={
                      seat.status !== "available" ||
                      seat.seatPrice !== 0 ||
                      query.isFetching
                    }
                    title={`${seat.seatNumber} · ${seat.seatType} · ${(seat.seatPrice / 100).toFixed(2)} SAR`}
                    className={cn(
                      "w-12",
                      selected.includes(seat.seatNumber) &&
                        seat.status === "available" &&
                        "bg-primary text-primary-foreground"
                    )}
                    onClick={() => choose(seat.seatNumber)}
                  >
                    {seat.seatNumber}
                  </Button>
                ))}
              </div>
            ))}
          </div>
          <p className="text-sm">
            {t("checkIn.seatAssignments")}:{" "}
            {selected
              .filter(n =>
                seats.some(
                  s =>
                    s.seatNumber === n &&
                    s.status === "available" &&
                    s.seatPrice === 0
                )
              )
              .join(", ") || t("checkIn.autoAssign")}
          </p>
        </>
      )}
    </Card>
  );
}
