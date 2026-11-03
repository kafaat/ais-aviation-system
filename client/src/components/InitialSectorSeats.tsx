import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { SeatMap } from "./SeatMap";

export interface SectorSeat {
  segmentIndex: number;
  passengerIndex: number;
  seatNumber: string;
}

export function InitialSectorSeats({
  flightIds,
  cabinClass,
  passengers,
  value,
  onChange,
  disabled,
}: {
  flightIds: number[];
  cabinClass: "economy" | "business";
  passengers: { firstName: string; lastName: string; type: string }[];
  value: SectorSeat[];
  onChange: (next: SectorSeat[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [segmentIndex, setSegment] = useState(0);
  const [selectedPassenger, setPassenger] = useState(0);
  const passengerIndex =
    passengers[selectedPassenger]?.type === "infant"
      ? passengers.findIndex(p => p.type !== "infant")
      : selectedPassenger;
  const flightId = flightIds[segmentIndex];
  const flight = trpc.flights.getById.useQuery(
    { id: flightId },
    { enabled: open }
  );
  const isCurrent = (seat: SectorSeat) =>
    seat.segmentIndex === segmentIndex &&
    seat.passengerIndex === passengerIndex;
  const passengerLabel = (index: number) =>
    [
      t("manageAncillaries.passenger"),
      index + 1,
      passengers[index].firstName,
      passengers[index].lastName,
    ]
      .filter(Boolean)
      .join(" ");
  return (
    <section
      aria-label={t("checkIn.seatAssignments")}
      className="space-y-3 rounded-lg border p-4"
    >
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("checkIn.selectSeats")}
      </button>
      {open && (
        <fieldset className="grid gap-3" disabled={disabled}>
          <label>
            {t("manageAncillaries.sector")}{" "}
            <select
              value={segmentIndex}
              onChange={event => setSegment(Number(event.target.value))}
            >
              {flightIds.map((id, i) => (
                <option key={id} value={i}>
                  {i + 1} · {id}
                </option>
              ))}
            </select>
          </label>
          {flight.data && (
            <p>
              {flight.data.flightNumber} ·{" "}
              <bdi>
                {flight.data.origin.code} → {flight.data.destination.code}
              </bdi>
            </p>
          )}
          <label>
            {t("manageAncillaries.passenger")}{" "}
            <select
              value={passengerIndex}
              disabled={passengerIndex < 0}
              onChange={event => setPassenger(Number(event.target.value))}
            >
              {passengers.map((p, i) =>
                p.type === "infant" ? null : (
                  <option key={i} value={i}>
                    {passengerLabel(i)}
                  </option>
                )
              )}
            </select>
          </label>
          {passengerIndex >= 0 && (
            <SeatMap
              flightId={flightId}
              cabinClass={cabinClass}
              selectedSeatNumbers={value
                .filter(isCurrent)
                .map(s => s.seatNumber)}
              excludedSeatNumbers={value
                .filter(
                  s =>
                    s.segmentIndex === segmentIndex &&
                    s.passengerIndex !== passengerIndex
                )
                .map(s => s.seatNumber)}
              onSeatSelect={seats =>
                onChange([
                  ...value.filter(s => !isCurrent(s)),
                  ...seats.map(seat => ({
                    segmentIndex,
                    passengerIndex,
                    seatNumber: seat.id,
                  })),
                ])
              }
            />
          )}
          {value.length > 0 && (
            <ul>
              {value.map(s => (
                <li key={s.segmentIndex + "/" + s.passengerIndex}>
                  {t("manageAncillaries.sector")} {s.segmentIndex + 1} ·{" "}
                  {passengerLabel(s.passengerIndex)} · {s.seatNumber}{" "}
                  <button
                    type="button"
                    aria-label={[
                      t("checkIn.removeSeat"),
                      passengerLabel(s.passengerIndex),
                      t("manageAncillaries.sector"),
                      s.segmentIndex + 1,
                      s.seatNumber,
                    ].join(" ")}
                    onClick={() => onChange(value.filter(item => item !== s))}
                  >
                    {t("checkIn.removeSeat")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}
    </section>
  );
}
