import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "@/hooks/useMobile";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronDown,
  ChevronUp,
  Move,
  X,
} from "lucide-react";

type SeatStatus = "available" | "selected" | "occupied";

interface Seat {
  id: string;
  row: number;
  column: string;
  status: SeatStatus;
  class: "economy" | "business";
}

interface CabinLayout {
  rows: number;
  sections: string[][]; // Groups of column letters, aisles between groups
}

interface AircraftSeatConfig {
  name: string;
  economy: CabinLayout;
  business: CabinLayout;
}

// Aircraft seat configurations based on real layouts
const AIRCRAFT_CONFIGS: Record<string, AircraftSeatConfig> = {
  "Airbus A320": {
    name: "Airbus A320-200",
    economy: {
      rows: 20,
      sections: [
        ["A", "B", "C"],
        ["D", "E", "F"],
      ],
    },
    business: {
      rows: 5,
      sections: [
        ["A", "B"],
        ["C", "D"],
      ],
    },
  },
  "Airbus A330": {
    name: "Airbus A330-300",
    economy: {
      rows: 30,
      sections: [
        ["A", "B"],
        ["C", "D", "E", "F"],
        ["G", "H"],
      ],
    },
    business: {
      rows: 7,
      sections: [
        ["A", "C"],
        ["D", "F"],
      ],
    },
  },
  "Airbus A350": {
    name: "Airbus A350-900",
    economy: {
      rows: 30,
      sections: [
        ["A", "B", "C"],
        ["D", "E", "F"],
        ["G", "H", "K"],
      ],
    },
    business: { rows: 8, sections: [["A"], ["B", "C"], ["D"]] },
  },
  "Boeing 727": {
    name: "Boeing 727-200",
    economy: {
      rows: 22,
      sections: [
        ["A", "B", "C"],
        ["D", "E", "F"],
      ],
    },
    business: {
      rows: 3,
      sections: [
        ["A", "B"],
        ["C", "D"],
      ],
    },
  },
  "Boeing 737": {
    name: "Boeing 737-800",
    economy: {
      rows: 23,
      sections: [
        ["A", "B", "C"],
        ["D", "E", "F"],
      ],
    },
    business: {
      rows: 4,
      sections: [
        ["A", "B"],
        ["C", "D"],
      ],
    },
  },
  "Boeing 777": {
    name: "Boeing 777-300ER",
    economy: {
      rows: 30,
      sections: [
        ["A", "B", "C"],
        ["D", "E", "F", "G"],
        ["H", "J", "K"],
      ],
    },
    business: {
      rows: 6,
      sections: [
        ["A", "B"],
        ["C", "D", "E"],
        ["F", "G"],
      ],
    },
  },
  "Boeing 787": {
    name: "Boeing 787-9",
    economy: {
      rows: 30,
      sections: [
        ["A", "B", "C"],
        ["D", "E", "F"],
        ["G", "H", "K"],
      ],
    },
    business: { rows: 7, sections: [["A"], ["B", "C"], ["D"]] },
  },
};

const DEFAULT_CONFIG: AircraftSeatConfig = {
  name: "",
  economy: {
    rows: 20,
    sections: [
      ["A", "B", "C"],
      ["D", "E", "F"],
    ],
  },
  business: {
    rows: 5,
    sections: [
      ["A", "B"],
      ["C", "D"],
    ],
  },
};

interface SeatMapProps {
  cabinClass: "economy" | "business";
  onSeatSelect?: (seats: Seat[]) => void;
  maxSeats?: number;
  aircraftType?: string;
}

// Touch/gesture state interface
interface GestureState {
  scale: number;
  translateX: number;
  translateY: number;
  initialDistance: number;
  initialScale: number;
  isDragging: boolean;
  startX: number;
  startY: number;
  lastTranslateX: number;
  lastTranslateY: number;
}

// Zoom constraints
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.25;

export function SeatMap({
  cabinClass,
  onSeatSelect,
  maxSeats = 1,
  aircraftType,
}: SeatMapProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const seatMapRef = useRef<HTMLDivElement>(null);

  // Resolve aircraft configuration
  const aircraftConfig = aircraftType
    ? (AIRCRAFT_CONFIGS[aircraftType] ?? DEFAULT_CONFIG)
    : DEFAULT_CONFIG;
  const cabinLayout = aircraftConfig[cabinClass];
  const allColumns = cabinLayout.sections.flat();

  // State for gestures and zoom
  const [gestureState, setGestureState] = useState<GestureState>({
    scale: 1,
    translateX: 0,
    translateY: 0,
    initialDistance: 0,
    initialScale: 1,
    isDragging: false,
    startX: 0,
    startY: 0,
    lastTranslateX: 0,
    lastTranslateY: 0,
  });

  // State for UI
  const [isLegendOpen, setIsLegendOpen] = useState(!isMobile);
  const [selectedSeatForConfirm, setSelectedSeatForConfirm] =
    useState<Seat | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [activeSeatTooltip, setActiveSeatTooltip] = useState<string | null>(
    null
  );

  // Generate seat map based on aircraft layout
  const generateSeats = (): Seat[] => {
    const seats: Seat[] = [];

    // Simulate some occupied seats (random but deterministic based on aircraft)
    const occupiedSeats = new Set<string>();
    const totalSeats = cabinLayout.rows * allColumns.length;
    const occupiedCount = Math.floor(totalSeats * 0.15); // ~15% occupied
    for (let i = 0; i < occupiedCount; i++) {
      const row = ((i * 7 + 3) % cabinLayout.rows) + 1;
      const col = allColumns[(i * 13 + 5) % allColumns.length];
      occupiedSeats.add(`${row}${col}`);
    }

    for (let row = 1; row <= cabinLayout.rows; row++) {
      for (const col of allColumns) {
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

  // Handle seat click with mobile confirmation
  const handleSeatClick = useCallback(
    (seatId: string) => {
      const seat = seats.find(s => s.id === seatId);
      if (!seat || seat.status === "occupied") return;

      // On mobile, show confirmation dialog
      if (isMobile) {
        setSelectedSeatForConfirm(seat);
        setShowConfirmDialog(true);
        return;
      }

      // Desktop: direct selection
      performSeatSelection(seatId);
    },
    [seats, isMobile]
  );

  const performSeatSelection = useCallback(
    (seatId: string) => {
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
    },
    [maxSeats, onSeatSelect]
  );

  // Confirm seat selection on mobile
  const handleConfirmSeat = useCallback(() => {
    if (selectedSeatForConfirm) {
      performSeatSelection(selectedSeatForConfirm.id);
      setShowConfirmDialog(false);
      setSelectedSeatForConfirm(null);
    }
  }, [selectedSeatForConfirm, performSeatSelection]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setGestureState(prev => ({
      ...prev,
      scale: Math.min(prev.scale + ZOOM_STEP, MAX_ZOOM),
    }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setGestureState(prev => ({
      ...prev,
      scale: Math.max(prev.scale - ZOOM_STEP, MIN_ZOOM),
    }));
  }, []);

  const handleResetZoom = useCallback(() => {
    setGestureState(prev => ({
      ...prev,
      scale: 1,
      translateX: 0,
      translateY: 0,
    }));
  }, []);

  // Calculate distance between two touch points
  const getDistance = (touches: React.TouchList): number => {
    if (touches.length < 2) return 0;
    const touch0 = touches[0];
    const touch1 = touches[1];
    const dx = touch0.clientX - touch1.clientX;
    const dy = touch0.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Touch event handlers for pinch-to-zoom and pan
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch gesture start
        const distance = getDistance(e.touches);
        setGestureState(prev => ({
          ...prev,
          initialDistance: distance,
          initialScale: prev.scale,
        }));
      } else if (e.touches.length === 1 && gestureState.scale > 1) {
        // Pan gesture start (only when zoomed in)
        setGestureState(prev => ({
          ...prev,
          isDragging: true,
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          lastTranslateX: prev.translateX,
          lastTranslateY: prev.translateY,
        }));
      }
    },
    [gestureState.scale]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch gesture
        e.preventDefault();
        const distance = getDistance(e.touches);
        const newScale =
          gestureState.initialScale * (distance / gestureState.initialDistance);
        setGestureState(prev => ({
          ...prev,
          scale: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale)),
        }));
      } else if (e.touches.length === 1 && gestureState.isDragging) {
        // Pan gesture
        e.preventDefault();
        const deltaX = e.touches[0].clientX - gestureState.startX;
        const deltaY = e.touches[0].clientY - gestureState.startY;
        setGestureState(prev => ({
          ...prev,
          translateX: prev.lastTranslateX + deltaX,
          translateY: prev.lastTranslateY + deltaY,
        }));
      }
    },
    [gestureState]
  );

  const handleTouchEnd = useCallback(() => {
    setGestureState(prev => ({
      ...prev,
      isDragging: false,
      initialDistance: 0,
    }));
  }, []);

  // Mouse drag handlers for desktop
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (gestureState.scale > 1 && e.button === 0) {
        setGestureState(prev => ({
          ...prev,
          isDragging: true,
          startX: e.clientX,
          startY: e.clientY,
          lastTranslateX: prev.translateX,
          lastTranslateY: prev.translateY,
        }));
      }
    },
    [gestureState.scale]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (gestureState.isDragging) {
        const deltaX = e.clientX - gestureState.startX;
        const deltaY = e.clientY - gestureState.startY;
        setGestureState(prev => ({
          ...prev,
          translateX: prev.lastTranslateX + deltaX,
          translateY: prev.lastTranslateY + deltaY,
        }));
      }
    },
    [gestureState]
  );

  const handleMouseUp = useCallback(() => {
    setGestureState(prev => ({
      ...prev,
      isDragging: false,
    }));
  }, []);

  // Handle wheel zoom on desktop
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setGestureState(prev => ({
        ...prev,
        scale: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.scale + delta)),
      }));
    }
  }, []);

  // Touch-friendly tooltip handler
  const handleSeatLongPress = useCallback((seatId: string) => {
    setActiveSeatTooltip(seatId);
    // Auto-hide after 2 seconds
    setTimeout(() => setActiveSeatTooltip(null), 2000);
  }, []);

  // Close tooltip on tap elsewhere
  useEffect(() => {
    const handleOutsideClick = () => setActiveSeatTooltip(null);
    if (activeSeatTooltip) {
      document.addEventListener("touchstart", handleOutsideClick);
      return () =>
        document.removeEventListener("touchstart", handleOutsideClick);
    }
  }, [activeSeatTooltip]);

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

  const getSeatStatusText = (status: SeatStatus) => {
    switch (status) {
      case "available":
        return t("seatMap.available");
      case "selected":
        return t("seatMap.selected");
      case "occupied":
        return t("seatMap.occupied");
    }
  };

  const rows = cabinLayout.rows;
  const sections = cabinLayout.sections;

  // Calculate responsive seat size
  const getSeatSize = () => {
    if (isMobile) {
      return "w-8 h-8 text-[10px]";
    }
    return "w-10 h-10 text-xs";
  };

  // Calculate mini-map dimensions
  const miniMapScale = 0.1;
  const viewportIndicatorStyle = {
    width: `${(100 / gestureState.scale) * miniMapScale * 100}%`,
    height: `${(100 / gestureState.scale) * miniMapScale * 100}%`,
    left: `${50 - (gestureState.translateX / 10) * miniMapScale}%`,
    top: `${50 - (gestureState.translateY / 10) * miniMapScale}%`,
    transform: "translate(-50%, -50%)",
  };

  return (
    <Card className="p-4 sm:p-6 overflow-hidden">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <h3 className="text-lg font-semibold mb-1">
          {cabinClass === "business"
            ? t("search.business")
            : t("search.economy")}
        </h3>
        {aircraftConfig.name && (
          <p className="text-sm font-medium text-blue-600 mb-1">
            {aircraftConfig.name}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {t("booking.selectSeats", { count: maxSeats })}
        </p>
      </div>

      {/* Collapsible Legend */}
      <Collapsible open={isLegendOpen} onOpenChange={setIsLegendOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-2 mb-2 sm:hidden"
          >
            <span className="text-sm font-medium">{t("seatMap.legend")}</span>
            {isLegendOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex gap-4 sm:gap-6 mb-4 sm:mb-6 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 sm:w-8 sm:h-8 rounded border-2 bg-green-100 border-green-300" />
              <span className="text-xs sm:text-sm">
                {t("seatMap.available")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 sm:w-8 sm:h-8 rounded border-2 bg-primary border-primary" />
              <span className="text-xs sm:text-sm">
                {t("seatMap.selected")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 sm:w-8 sm:h-8 rounded border-2 bg-gray-200 border-gray-300" />
              <span className="text-xs sm:text-sm">
                {t("seatMap.occupied")}
              </span>
            </div>
          </div>
        </CollapsibleContent>
        {/* Desktop legend (always visible) */}
        <div className="hidden sm:flex gap-6 mb-6 flex-wrap">
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
      </Collapsible>

      {/* Zoom Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleZoomOut}
            disabled={gestureState.scale <= MIN_ZOOM}
            className="h-8 w-8 p-0"
            aria-label={t("seatMap.zoomOut")}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs sm:text-sm text-muted-foreground min-w-[3rem] text-center">
            {Math.round(gestureState.scale * 100)}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleZoomIn}
            disabled={gestureState.scale >= MAX_ZOOM}
            className="h-8 w-8 p-0"
            aria-label={t("seatMap.zoomIn")}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetZoom}
            className="h-8 w-8 p-0"
            aria-label={t("seatMap.resetZoom")}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Pan indicator when zoomed */}
        {gestureState.scale > 1 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Move className="h-3 w-3" />
            <span className="hidden sm:inline">{t("seatMap.dragToPan")}</span>
          </div>
        )}
      </div>

      {/* Seat Map Container with touch/mouse handlers */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg border bg-muted/30"
        style={{
          touchAction: gestureState.scale > 1 ? "none" : "pan-y",
          cursor: gestureState.isDragging
            ? "grabbing"
            : gestureState.scale > 1
              ? "grab"
              : "default",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
          ref={seatMapRef}
          className="p-4 transition-transform duration-100"
          style={{
            transform: `scale(${gestureState.scale}) translate(${gestureState.translateX / gestureState.scale}px, ${gestureState.translateY / gestureState.scale}px)`,
            transformOrigin: "center center",
          }}
        >
          <div className="inline-block min-w-full">
            {/* Aircraft nose indicator */}
            <div className="flex justify-center mb-4">
              <div className="w-16 h-8 bg-muted rounded-t-full border-2 border-b-0 border-muted-foreground/20 flex items-center justify-center">
                <span className="text-[10px] text-muted-foreground">
                  {t("seatMap.front")}
                </span>
              </div>
            </div>

            {/* Column Headers */}
            <div className="flex gap-1 sm:gap-2 mb-2 justify-center">
              <div className="w-6 sm:w-8" /> {/* Row number spacer */}
              {sections.map((section, sIdx) => (
                <div key={sIdx} className="contents">
                  {sIdx > 0 && <div className="w-4 sm:w-10" /> /* Aisle */}
                  {section.map(col => (
                    <div
                      key={col}
                      className={cn(
                        "text-center text-xs sm:text-sm font-medium text-muted-foreground",
                        getSeatSize()
                      )}
                    >
                      {col}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Rows */}
            {Array.from({ length: rows }, (_, i) => i + 1).map(row => {
              const rowSeats = seats.filter(s => s.row === row);

              return (
                <div
                  key={row}
                  className="flex gap-1 sm:gap-2 mb-1 sm:mb-2 justify-center"
                >
                  {/* Row Number */}
                  <div className="w-6 sm:w-8 flex items-center justify-center text-xs sm:text-sm font-medium text-muted-foreground">
                    {row}
                  </div>

                  {/* Seats by section with aisles between */}
                  {sections.map((section, sIdx) => (
                    <div key={sIdx} className="contents">
                      {sIdx > 0 && (
                        <div className="w-4 sm:w-10 flex items-center justify-center">
                          <div className="h-px w-full bg-border" />
                        </div>
                      )}
                      {section.map(col => {
                        const seat = rowSeats.find(s => s.column === col);
                        if (!seat) return null;
                        return (
                          <div key={seat.id} className="relative">
                            <motion.button
                              whileHover={
                                seat.status !== "occupied" && !isMobile
                                  ? { scale: 1.1 }
                                  : {}
                              }
                              whileTap={
                                seat.status !== "occupied"
                                  ? { scale: 0.95 }
                                  : {}
                              }
                              onClick={() => handleSeatClick(seat.id)}
                              onContextMenu={e => {
                                e.preventDefault();
                                handleSeatLongPress(seat.id);
                              }}
                              disabled={seat.status === "occupied"}
                              className={cn(
                                "rounded border-2 font-medium transition-all",
                                getSeatSize(),
                                getSeatColor(seat.status)
                              )}
                              aria-label={`${t("seatMap.seat")} ${seat.id} - ${getSeatStatusText(seat.status)}`}
                            >
                              {seat.column}
                            </motion.button>

                            {/* Touch-friendly tooltip */}
                            <AnimatePresence>
                              {activeSeatTooltip === seat.id && (
                                <motion.div
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: 10 }}
                                  className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-foreground text-background text-xs rounded whitespace-nowrap"
                                >
                                  {seat.id} - {getSeatStatusText(seat.status)}
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-foreground" />
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Aircraft tail indicator */}
            <div className="flex justify-center mt-4">
              <div className="w-12 h-6 bg-muted rounded-b-lg border-2 border-t-0 border-muted-foreground/20 flex items-center justify-center">
                <span className="text-[10px] text-muted-foreground">
                  {t("seatMap.rear")}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Mini-map for navigation (visible when zoomed) */}
        <AnimatePresence>
          {gestureState.scale > 1 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute bottom-2 right-2 w-20 h-28 sm:w-24 sm:h-32 bg-background/90 border rounded-md shadow-lg overflow-hidden"
            >
              <div className="relative w-full h-full p-1">
                {/* Mini seat grid representation */}
                <div className="w-full h-full bg-muted/50 rounded relative">
                  {/* Simplified seat grid */}
                  <div className="absolute inset-2 flex flex-col gap-[2px]">
                    {Array.from({ length: Math.min(rows, 10) }).map(
                      (_, rowIdx) => (
                        <div
                          key={rowIdx}
                          className="flex gap-[1px] justify-center"
                        >
                          {sections.map((section, sIdx) => (
                            <div
                              key={sIdx}
                              className="flex gap-[1px]"
                              style={{
                                marginLeft: sIdx > 0 ? "2px" : 0,
                              }}
                            >
                              {section.map((_, colIdx) => (
                                <div
                                  key={colIdx}
                                  className="w-1 h-1 bg-muted-foreground/30 rounded-[1px]"
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      )
                    )}
                  </div>

                  {/* Viewport indicator */}
                  <div
                    className="absolute border-2 border-primary rounded bg-primary/10"
                    style={viewportIndicatorStyle}
                  />
                </div>

                {/* Close button */}
                <button
                  onClick={handleResetZoom}
                  className="absolute top-0 right-0 p-0.5 bg-background rounded-bl text-muted-foreground hover:text-foreground"
                  aria-label={t("seatMap.resetZoom")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile instructions */}
      {isMobile && (
        <div className="mt-3 text-xs text-muted-foreground text-center">
          {t("seatMap.mobileInstructions")}
        </div>
      )}

      {/* Selected Seats Summary */}
      {selectedSeats.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 sm:mt-6 p-3 sm:p-4 bg-primary/10 rounded-lg"
        >
          <p className="font-medium mb-2 text-sm sm:text-base">
            {t("seatMap.selectedSeats")}:
          </p>
          <div className="flex gap-2 flex-wrap">
            {selectedSeats.map(seat => (
              <span
                key={seat.id}
                className="px-2 sm:px-3 py-1 bg-primary text-primary-foreground rounded-full text-xs sm:text-sm flex items-center gap-1"
              >
                {seat.id}
                <button
                  onClick={() => performSeatSelection(seat.id)}
                  className="ml-1 hover:bg-primary-foreground/20 rounded-full p-0.5"
                  aria-label={`${t("seatMap.removeSeat")} ${seat.id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </motion.div>
      )}

      {/* Mobile Seat Selection Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("seatMap.confirmSelection")}</DialogTitle>
            <DialogDescription>
              {selectedSeatForConfirm?.status === "selected"
                ? t("seatMap.confirmDeselect", {
                    seat: selectedSeatForConfirm?.id,
                  })
                : t("seatMap.confirmSelect", {
                    seat: selectedSeatForConfirm?.id,
                  })}
            </DialogDescription>
          </DialogHeader>

          {selectedSeatForConfirm && (
            <div className="py-4">
              <div className="flex items-center justify-center gap-4">
                <div
                  className={cn(
                    "w-16 h-16 rounded-lg border-2 flex items-center justify-center text-xl font-bold",
                    getSeatColor(selectedSeatForConfirm.status)
                  )}
                >
                  {selectedSeatForConfirm.id}
                </div>
                <div className="text-left">
                  <p className="font-medium">
                    {t("seatMap.row")} {selectedSeatForConfirm.row}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("seatMap.seat")} {selectedSeatForConfirm.column}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {cabinClass === "business"
                      ? t("search.business")
                      : t("search.economy")}
                  </p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
              className="flex-1"
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleConfirmSeat} className="flex-1">
              {selectedSeatForConfirm?.status === "selected"
                ? t("seatMap.deselect")
                : t("seatMap.select")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
