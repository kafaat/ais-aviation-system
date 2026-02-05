import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Plane, Clock, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

interface Flight {
  id: number;
  flightNumber: string;
  airline: { name: string; logo?: string };
  origin: { code: string; city: string };
  destination: { code: string; city: string };
  departureTime: Date;
  arrivalTime: Date;
  economyPrice: number;
  businessPrice: number;
  economyAvailable: number;
  businessAvailable: number;
  duration?: string;
}

interface FlightComparisonProps {
  flights: Flight[];
  onRemove: (flightId: number) => void;
  onSelect: (flight: Flight) => void;
}

export function FlightComparison({
  flights,
  onRemove,
  onSelect,
}: FlightComparisonProps) {
  const { t } = useTranslation();

  if (flights.length === 0) {
    return null;
  }

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatPrice = (price: number) => {
    return `${(price / 100).toFixed(2)} ${t("common.currency")}`;
  };

  const calculateDuration = (departure: Date, arrival: Date) => {
    const diff = new Date(arrival).getTime() - new Date(departure).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-0 left-0 right-0 bg-background border-t shadow-lg z-50 p-4"
    >
      <div className="container">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">
            {t("flights.comparing")} ({flights.length})
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => flights.forEach(f => onRemove(f.id))}
          >
            {t("common.clearAll")}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {flights.map((flight, _index) => (
            <Card key={flight.id} className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-6 w-6"
                onClick={() => onRemove(flight.id)}
              >
                <X className="h-4 w-4" />
              </Button>

              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Plane className="h-4 w-4" />
                  {flight.flightNumber}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {flight.airline.name}
                </p>
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-semibold">{flight.origin.code}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatTime(flight.departureTime)}
                    </p>
                  </div>
                  <div className="text-center">
                    <Clock className="h-4 w-4 mx-auto text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      {calculateDuration(
                        flight.departureTime,
                        flight.arrivalTime
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{flight.destination.code}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatTime(flight.arrivalTime)}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">{t("flights.economy")}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">
                        {formatPrice(flight.economyPrice)}
                      </span>
                      {flight.economyAvailable > 0 ? (
                        <Badge variant="outline" className="text-xs">
                          {flight.economyAvailable} {t("flights.available")}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">
                          {t("flights.full")}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-sm">{t("flights.business")}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">
                        {formatPrice(flight.businessPrice)}
                      </span>
                      {flight.businessAvailable > 0 ? (
                        <Badge variant="outline" className="text-xs">
                          {flight.businessAvailable} {t("flights.available")}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">
                          {t("flights.full")}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <Button
                  className="w-full"
                  onClick={() => onSelect(flight)}
                  disabled={
                    flight.economyAvailable === 0 &&
                    flight.businessAvailable === 0
                  }
                >
                  <Check className="h-4 w-4 mr-2" />
                  {t("flights.selectFlight")}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
