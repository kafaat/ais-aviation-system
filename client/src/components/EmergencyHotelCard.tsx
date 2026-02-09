/**
 * EmergencyHotelCard Component
 *
 * Displays emergency hotel information for disrupted passengers including:
 * - Hotel details (name, star rating, distance, amenities)
 * - Room availability and pricing
 * - Book button with room type selection
 * - Transport option checkbox
 * - Confirmation display after booking
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Hotel,
  Star,
  MapPin,
  Phone,
  Mail,
  Bus,
  UtensilsCrossed,
  Check,
  Loader2,
  CircleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmergencyHotelData {
  id: number;
  name: string;
  airportId: number;
  address: string;
  phone: string;
  email: string;
  starRating: number;
  /** SAR cents */
  standardRate: number;
  distanceKm: number;
  hasTransport: boolean;
  isActive: boolean;
  estimatedNights?: number;
  /** SAR cents */
  estimatedTotalStandard?: number;
  /** SAR cents */
  estimatedTotalSuite?: number;
}

export interface HotelBookingConfirmation {
  id: number;
  confirmationNumber: string;
  hotelName: string;
  hotelAddress: string;
  hotelPhone: string;
  roomType: "standard" | "suite";
  checkIn: Date;
  checkOut: Date;
  nightlyRate: number;
  totalCost: number;
  mealIncluded: boolean;
  transportIncluded: boolean;
  status: string;
}

export interface EmergencyHotelCardProps {
  hotel: EmergencyHotelData;
  onBook?: (params: {
    hotelId: number;
    roomType: "standard" | "suite";
    transportIncluded: boolean;
  }) => void;
  isBooking?: boolean;
  confirmation?: HotelBookingConfirmation | null;
  disabled?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSAR(cents: number): string {
  return (cents / 100).toFixed(2);
}

function renderStars(count: number) {
  return Array.from({ length: 5 }, (_, i) => (
    <Star
      key={i}
      className={cn(
        "h-4 w-4",
        i < count
          ? "fill-amber-400 text-amber-400"
          : "fill-muted text-muted-foreground/30"
      )}
    />
  ));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmergencyHotelCard({
  hotel,
  onBook,
  isBooking = false,
  confirmation = null,
  disabled = false,
  className,
}: EmergencyHotelCardProps) {
  const { t } = useTranslation();
  const [roomType, setRoomType] = useState<"standard" | "suite">("standard");
  const [transportIncluded, setTransportIncluded] = useState(
    hotel.hasTransport
  );

  const handleBook = () => {
    if (onBook) {
      onBook({
        hotelId: hotel.id,
        roomType,
        transportIncluded,
      });
    }
  };

  // ---- Confirmation view ----
  if (confirmation) {
    return (
      <Card
        className={cn(
          "border-green-300 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30",
          className
        )}
      >
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-green-100 p-2 dark:bg-green-900">
              <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <CardTitle className="text-green-800 dark:text-green-200">
                {t("emergencyHotel.bookingConfirmed", "Booking Confirmed")}
              </CardTitle>
              <CardDescription>
                {t("emergencyHotel.confirmationNumber", "Confirmation")}:{" "}
                <span className="font-mono font-semibold">
                  {confirmation.confirmationNumber}
                </span>
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Hotel className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">{confirmation.hotelName}</p>
                <p className="text-sm text-muted-foreground">
                  {confirmation.hotelAddress}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">
                  {t("emergencyHotel.checkIn", "Check-in")}
                </p>
                <p className="font-medium">
                  {new Date(confirmation.checkIn).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  {t("emergencyHotel.checkOut", "Check-out")}
                </p>
                <p className="font-medium">
                  {new Date(confirmation.checkOut).toLocaleDateString()}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <Badge variant="secondary">
                {confirmation.roomType === "suite"
                  ? t("emergencyHotel.suite", "Suite")
                  : t("emergencyHotel.standard", "Standard")}
              </Badge>
              {confirmation.mealIncluded && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <UtensilsCrossed className="h-3.5 w-3.5" />
                  {t("emergencyHotel.mealsIncluded", "Meals included")}
                </span>
              )}
              {confirmation.transportIncluded && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Bus className="h-3.5 w-3.5" />
                  {t("emergencyHotel.transportIncluded", "Transport included")}
                </span>
              )}
            </div>

            <div className="rounded-lg bg-green-100 p-3 dark:bg-green-900/50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-green-800 dark:text-green-200">
                  {t("emergencyHotel.totalCost", "Total Cost")}
                </span>
                <span className="text-lg font-bold text-green-800 dark:text-green-200">
                  {formatSAR(confirmation.totalCost)} {t("common.sar", "SAR")}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{confirmation.hotelPhone}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- Hotel search result / booking view ----
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Hotel className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{hotel.name}</CardTitle>
              <div className="mt-1 flex items-center gap-1">
                {renderStars(hotel.starRating)}
              </div>
            </div>
          </div>
          {hotel.hasTransport && (
            <Badge
              variant="outline"
              className="gap-1 border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
            >
              <Bus className="h-3 w-3" />
              {t("emergencyHotel.shuttleAvailable", "Shuttle")}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          {/* Location & contact */}
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2 text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {hotel.address} ({hotel.distanceKm} km{" "}
                {t("emergencyHotel.fromAirport", "from airport")})
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-4 w-4 shrink-0" />
              <span>{hotel.phone}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4 shrink-0" />
              <span>{hotel.email}</span>
            </div>
          </div>

          {/* Room type selection */}
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {t("emergencyHotel.roomType", "Room Type")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRoomType("standard")}
                disabled={disabled || isBooking}
                className={cn(
                  "rounded-lg border p-3 text-start transition-colors",
                  roomType === "standard"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/50",
                  (disabled || isBooking) && "cursor-not-allowed opacity-50"
                )}
              >
                <p className="text-sm font-medium">
                  {t("emergencyHotel.standard", "Standard")}
                </p>
                <p className="mt-1 text-lg font-bold">
                  {formatSAR(hotel.standardRate)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("common.sar", "SAR")}/
                    {t("emergencyHotel.night", "night")}
                  </span>
                </p>
                {hotel.estimatedTotalStandard !== undefined && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("emergencyHotel.estTotal", "Est. total")}:{" "}
                    {formatSAR(hotel.estimatedTotalStandard)}{" "}
                    {t("common.sar", "SAR")}
                  </p>
                )}
              </button>

              <button
                type="button"
                onClick={() => setRoomType("suite")}
                disabled={disabled || isBooking}
                className={cn(
                  "rounded-lg border p-3 text-start transition-colors",
                  roomType === "suite"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/50",
                  (disabled || isBooking) && "cursor-not-allowed opacity-50"
                )}
              >
                <p className="text-sm font-medium">
                  {t("emergencyHotel.suite", "Suite")}
                </p>
                <p className="mt-1 text-lg font-bold">
                  {formatSAR(Math.round(hotel.standardRate * 1.8))}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("common.sar", "SAR")}/
                    {t("emergencyHotel.night", "night")}
                  </span>
                </p>
                {hotel.estimatedTotalSuite !== undefined && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("emergencyHotel.estTotal", "Est. total")}:{" "}
                    {formatSAR(hotel.estimatedTotalSuite)}{" "}
                    {t("common.sar", "SAR")}
                  </p>
                )}
              </button>
            </div>
          </div>

          {/* Amenities */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="gap-1">
              <UtensilsCrossed className="h-3 w-3" />
              {t("emergencyHotel.mealsIncluded", "Meals included")}
            </Badge>
            {hotel.estimatedNights !== undefined && (
              <Badge variant="outline">
                {hotel.estimatedNights}{" "}
                {hotel.estimatedNights === 1
                  ? t("emergencyHotel.night", "night")
                  : t("emergencyHotel.nights", "nights")}
              </Badge>
            )}
          </div>

          {/* Transport option */}
          {hotel.hasTransport && (
            <div className="flex items-start gap-3 rounded-lg border border-dashed p-3">
              <Checkbox
                id={`transport-${hotel.id}`}
                checked={transportIncluded}
                onCheckedChange={(checked: boolean) =>
                  setTransportIncluded(checked)
                }
                disabled={disabled || isBooking}
              />
              <div className="grid gap-1">
                <Label
                  htmlFor={`transport-${hotel.id}`}
                  className="text-sm font-medium leading-none"
                >
                  {t(
                    "emergencyHotel.includeTransport",
                    "Include airport transfer"
                  )}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "emergencyHotel.transportDesc",
                    "Complimentary shuttle service between the airport and hotel"
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="flex-col gap-3">
        {!hotel.isActive && (
          <div className="flex w-full items-center gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <CircleAlert className="h-4 w-4 shrink-0" />
            {t(
              "emergencyHotel.hotelUnavailable",
              "This hotel is currently unavailable"
            )}
          </div>
        )}
        <Button
          className="w-full"
          onClick={handleBook}
          disabled={disabled || isBooking || !hotel.isActive}
        >
          {isBooking ? (
            <>
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
              {t("emergencyHotel.booking", "Booking...")}
            </>
          ) : (
            <>
              <Hotel className="me-2 h-4 w-4" />
              {t("emergencyHotel.bookRoom", "Book Room")}
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

export function EmergencyHotelCardSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-10 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
