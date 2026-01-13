import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { useTranslation } from "react-i18next";

type SeatStatus = "available" | "selected" | "occupied";

interface Seat {
  id: string;
  row: number;
  column: string;
  status: SeatStatus;
  class: "economy" | "business";
}

interface SeatMapProps {
  cabinClass: "economy" | "business";
  onSeatSelect?: (seats: Seat[]) => void;
  maxSeats?: number;
}

export function SeatMap({
  cabinClass,
  onSeatSelect,
  maxSeats = 1,
}: SeatMapProps) {
  const { t } = useTranslation();

  // Generate seat map
  const generateSeats = (): Seat[] => {
    const seats: Seat[] = [];
    const rows = cabinClass === "business" ? 5 : 20;
    const columns =
      cabinClass === "business"
        ? ["A", "B", "C", "D"]
        : ["A", "B", "C", "D", "E", "F"];

    // Simulate some occupied seats
    const occupiedSeats = new Set([
      "1A",
      "1B",
      "3C",
      "5D",
      "7A",
      "10B",
      "12E",
      "15F",
    ]);

    for (let row = 1; row <= rows; row++) {
      for (const col of columns) {
        const seatId = `${row}${col}`;
        seats.push({
          id: seatId,
          row,
          column: col,
          status: occupiedSeats.has(seatId) ? "occupied" : "available",
          class: cabinClass,
        });
      }
    }

    return seats;
  };

  const [seats, setSeats] = useState<Seat[]>(generateSeats());
  const selectedSeats = seats.filter(s => s.status === "selected");

  const handleSeatClick = (seatId: string) => {
    setSeats(prev => {
      const newSeats = prev.map(seat => {
        if (seat.id === seatId) {
          if (seat.status === "occupied") return seat;

          // Check if we can select more seats
          const currentSelected = prev.filter(
            s => s.status === "selected"
          ).length;

          if (seat.status === "available" && currentSelected >= maxSeats) {
            return seat; // Can't select more
          }

          return {
            ...seat,
            status: seat.status === "available" ? "selected" : "available",
          } as Seat;
        }
        return seat;
      });

      const selected = newSeats.filter(s => s.status === "selected");
      onSeatSelect?.(selected);

      return newSeats;
    });
  };

  const getSeatColor = (status: SeatStatus) => {
    switch (status) {
      case "available":
        return "bg-green-100 hover:bg-green-200 border-green-300 text-green-700";
      case "selected":
        return "bg-primary text-primary-foreground border-primary";
      case "occupied":
        return "bg-gray-200 border-gray-300 text-gray-400 cursor-not-allowed";
    }
  };

  const columns =
    cabinClass === "business"
      ? ["A", "B", "C", "D"]
      : ["A", "B", "C", "D", "E", "F"];
  const rows = cabinClass === "business" ? 5 : 20;

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">
          {cabinClass === "business"
            ? t("search.business")
            : t("search.economy")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("booking.selectSeats", { count: maxSeats })}
        </p>
      </div>

      {/* Legend */}
      <div className="flex gap-6 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded border-2 bg-green-100 border-green-300" />
          <span className="text-sm">{t("seatMap.available")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded border-2 bg-primary border-primary" />
          <span className="text-sm">{t("seatMap.selected")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded border-2 bg-gray-200 border-gray-300" />
          <span className="text-sm">{t("seatMap.occupied")}</span>
        </div>
      </div>

      {/* Seat Map */}
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* Column Headers */}
          <div className="flex gap-2 mb-2 justify-center">
            <div className="w-8" /> {/* Row number spacer */}
            {columns.slice(0, Math.ceil(columns.length / 2)).map(col => (
              <div
                key={col}
                className="w-10 text-center text-sm font-medium text-muted-foreground"
              >
                {col}
              </div>
            ))}
            <div className="w-12" /> {/* Aisle */}
            {columns.slice(Math.ceil(columns.length / 2)).map(col => (
              <div
                key={col}
                className="w-10 text-center text-sm font-medium text-muted-foreground"
              >
                {col}
              </div>
            ))}
          </div>

          {/* Rows */}
          {Array.from({ length: rows }, (_, i) => i + 1).map(row => {
            const rowSeats = seats.filter(s => s.row === row);
            const leftSeats = rowSeats.slice(0, Math.ceil(columns.length / 2));
            const rightSeats = rowSeats.slice(Math.ceil(columns.length / 2));

            return (
              <div key={row} className="flex gap-2 mb-2 justify-center">
                {/* Row Number */}
                <div className="w-8 flex items-center justify-center text-sm font-medium text-muted-foreground">
                  {row}
                </div>

                {/* Left Seats */}
                {leftSeats.map(seat => (
                  <motion.button
                    key={seat.id}
                    whileHover={
                      seat.status !== "occupied" ? { scale: 1.1 } : {}
                    }
                    whileTap={seat.status !== "occupied" ? { scale: 0.95 } : {}}
                    onClick={() => handleSeatClick(seat.id)}
                    disabled={seat.status === "occupied"}
                    className={cn(
                      "w-10 h-10 rounded border-2 text-xs font-medium transition-all",
                      getSeatColor(seat.status)
                    )}
                  >
                    {seat.column}
                  </motion.button>
                ))}

                {/* Aisle */}
                <div className="w-12 flex items-center justify-center">
                  <div className="h-px w-full bg-border" />
                </div>

                {/* Right Seats */}
                {rightSeats.map(seat => (
                  <motion.button
                    key={seat.id}
                    whileHover={
                      seat.status !== "occupied" ? { scale: 1.1 } : {}
                    }
                    whileTap={seat.status !== "occupied" ? { scale: 0.95 } : {}}
                    onClick={() => handleSeatClick(seat.id)}
                    disabled={seat.status === "occupied"}
                    className={cn(
                      "w-10 h-10 rounded border-2 text-xs font-medium transition-all",
                      getSeatColor(seat.status)
                    )}
                  >
                    {seat.column}
                  </motion.button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Seats Summary */}
      {selectedSeats.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 p-4 bg-primary/10 rounded-lg"
        >
          <p className="font-medium mb-2">{t("seatMap.selectedSeats")}:</p>
          <div className="flex gap-2 flex-wrap">
            {selectedSeats.map(seat => (
              <span
                key={seat.id}
                className="px-3 py-1 bg-primary text-primary-foreground rounded-full text-sm"
              >
                {seat.id}
              </span>
            ))}
          </div>
        </motion.div>
      )}
    </Card>
  );
}
