import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  ChevronLeft,
  Search,
  Plane,
  Printer,
  CheckCircle2,
  Clock,
  MapPin,
  User,
  Ticket,
  Loader2,
  AlertCircle,
  Armchair,
} from "lucide-react";
import { toast } from "sonner";
import { SeatMap } from "@/components/SeatMap";

interface Passenger {
  id: number;
  title?: string;
  firstName: string;
  lastName: string;
  type: "adult" | "child" | "infant";
  seatNumber?: string;
}

interface BoardingPassFlight {
  flightNumber: string;
  airline: string;
  origin: string;
  originCity: string;
  destination: string;
  destinationCity: string;
  departureTime: Date;
}

// Boarding Pass Component
function BoardingPass({
  passenger,
  flight,
  bookingReference,
  index,
}: {
  passenger: Passenger;
  flight: BoardingPassFlight;
  bookingReference: string;
  index: number;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? "ar-SA" : "en-US";

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="boarding-pass bg-white rounded-xl overflow-hidden shadow-lg border border-gray-200 print:shadow-none print:border print:border-gray-300">
      {/* Header with gradient */}
      <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-800 text-white p-4 print:bg-blue-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plane className="h-6 w-6" />
            <span className="font-bold text-lg">{flight.airline}</span>
          </div>
          <Badge
            variant="secondary"
            className="bg-white/20 text-white hover:bg-white/30"
          >
            {t("checkIn.boardingPass")}
          </Badge>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        {/* Route Section */}
        <div className="flex items-center justify-between mb-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-gray-900">{flight.origin}</p>
            <p className="text-sm text-gray-500">{flight.originCity}</p>
          </div>
          <div className="flex-1 flex items-center justify-center px-4">
            <div className="w-full flex items-center">
              <div className="h-px bg-gray-300 flex-1" />
              <Plane className="h-5 w-5 text-blue-600 mx-2 rotate-90" />
              <div className="h-px bg-gray-300 flex-1" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-gray-900">
              {flight.destination}
            </p>
            <p className="text-sm text-gray-500">{flight.destinationCity}</p>
          </div>
        </div>

        <Separator className="my-4" />

        {/* Details Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t("checkIn.passenger")}
            </p>
            <p className="font-semibold text-gray-900">
              {passenger.title} {passenger.firstName} {passenger.lastName}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t("checkIn.flightNumber")}
            </p>
            <p className="font-semibold text-gray-900">{flight.flightNumber}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t("checkIn.date")}
            </p>
            <p className="font-semibold text-gray-900">
              {formatDate(flight.departureTime)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t("checkIn.boardingTime")}
            </p>
            <p className="font-semibold text-gray-900">
              {formatTime(flight.departureTime)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t("checkIn.seat")}
            </p>
            <p className="font-bold text-2xl text-blue-600">
              {passenger.seatNumber ||
                `${Math.floor(index / 6) + 1}${String.fromCharCode(65 + (index % 6))}`}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t("checkIn.gate")}
            </p>
            <p className="font-semibold text-gray-900">--</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t("checkIn.bookingRef")}
            </p>
            <p className="font-semibold text-gray-900">{bookingReference}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t("checkIn.class")}
            </p>
            <p className="font-semibold text-gray-900">{t("cabin.economy")}</p>
          </div>
        </div>

        <Separator className="my-4" />

        {/* Barcode/QR Code Placeholder */}
        <div className="flex items-center justify-center py-4">
          <div className="text-center">
            <div className="bg-gray-100 rounded-lg p-4 mb-2">
              {/* Barcode representation */}
              <div className="flex items-center justify-center gap-0.5 h-16">
                {Array.from({ length: 40 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-gray-900 h-full"
                    style={{
                      width: `${Math.random() > 0.5 ? 2 : 3}px`,
                      marginRight: `${Math.random() > 0.5 ? 1 : 2}px`,
                    }}
                  />
                ))}
              </div>
            </div>
            <p className="text-xs text-gray-500 font-mono tracking-wider">
              {bookingReference}-{passenger.id.toString().padStart(4, "0")}
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-gray-50 px-6 py-3 text-center print:bg-white">
        <p className="text-xs text-gray-500">{t("checkIn.boardingPassNote")}</p>
      </div>
    </div>
  );
}

// Loading Skeleton Component
function CheckInSkeleton() {
  return (
    <Card className="p-6">
      <Skeleton className="h-6 w-32 mb-6" />
      <div className="space-y-4 mb-6">
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
        <Separator />
        <Skeleton className="h-5 w-24 mb-3" />
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
      <Skeleton className="h-12 w-full" />
    </Card>
  );
}

interface SelectedSeat {
  id: string;
  row: number;
  column: string;
  status: "available" | "selected" | "occupied";
  class: "economy" | "business";
}

export default function CheckIn() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [pnr, setPnr] = useState("");
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [showSeatMap, setShowSeatMap] = useState(false);
  const [selectedSeats, setSelectedSeats] = useState<SelectedSeat[]>([]);
  const boardingPassRef = useRef<HTMLDivElement>(null);

  const {
    data: booking,
    isLoading: isBookingLoading,
    error: bookingError,
    refetch,
  } = trpc.bookings.getByPNR.useQuery(
    { pnr },
    { enabled: false, retry: false }
  );

  const { data: passengers, isLoading: isPassengersLoading } =
    trpc.bookings.getPassengers.useQuery(
      { bookingId: booking?.id || 0 },
      { enabled: !!booking?.id }
    );

  const { data: flight, isLoading: isFlightLoading } =
    trpc.flights.getById.useQuery(
      { id: booking?.flightId || 0 },
      { enabled: !!booking?.flightId }
    );

  const checkInMutation = trpc.bookings.checkIn.useMutation({
    onSuccess: () => {
      toast.success(t("checkIn.successMessage"));
      refetch();
    },
    onError: error => {
      toast.error(error.message || t("checkIn.errorMessage"));
    },
  });

  const handleSearch = async () => {
    if (pnr.length !== 6) {
      toast.error(t("checkIn.invalidPnr"));
      return;
    }
    setSearchPerformed(true);
    await refetch();
  };

  const handleSeatSelect = useCallback((seats: SelectedSeat[]) => {
    setSelectedSeats(seats);
  }, []);

  const handleCheckIn = async () => {
    if (!booking || !passengers) return;

    const passengerList = passengers as Passenger[];

    // Use seats selected from SeatMap, or fall back to auto-assignment
    const seatAssignments = passengerList.map((passenger, index) => ({
      passengerId: passenger.id,
      seatNumber:
        selectedSeats[index]?.id ||
        passenger.seatNumber ||
        `${Math.floor(index / 6) + 1}${String.fromCharCode(65 + (index % 6))}`,
    }));

    await checkInMutation.mutateAsync({
      bookingId: booking.id,
      seatAssignments,
    });
  };

  const handlePrint = () => {
    window.print();
  };

  const isLoading = isBookingLoading || isPassengersLoading || isFlightLoading;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
        <Card className="p-8 text-center max-w-md bg-white/80 backdrop-blur-sm shadow-xl border-0">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <User className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            {t("checkIn.loginRequired")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("checkIn.loginRequiredDesc")}
          </p>
          <Button
            asChild
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
          >
            <a href="/login">{t("common.login")}</a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-white/20 sticky top-0 z-50 print:hidden">
        <div className="container py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-blue-50"
                aria-label={t("common.back")}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                {t("checkIn.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("checkIn.subtitle")}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="container py-8 print:py-2">
        <div className="max-w-3xl mx-auto">
          {/* Search Card */}
          <Card className="p-6 mb-8 bg-white/80 backdrop-blur-sm shadow-xl border-0 print:hidden">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                <Ticket className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">
                  {t("checkIn.findBooking")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t("checkIn.pnrHint")}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pnr" className="text-gray-700">
                  {t("checkIn.pnrLabel")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="pnr"
                    value={pnr}
                    onChange={e => setPnr(e.target.value.toUpperCase())}
                    placeholder={t("checkIn.pnrPlaceholder")}
                    maxLength={6}
                    className="flex-1 bg-white/50 border-gray-200 focus:border-blue-500 focus:ring-blue-500"
                    onKeyDown={e => e.key === "Enter" && handleSearch()}
                  />
                  <Button
                    onClick={handleSearch}
                    disabled={isBookingLoading}
                    className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                  >
                    {isBookingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-2" />
                        {t("checkIn.search")}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {/* Loading State */}
          {searchPerformed && isLoading && !bookingError && <CheckInSkeleton />}

          {/* Error State */}
          {searchPerformed && bookingError && (
            <Card
              className="p-12 text-center bg-white/80 backdrop-blur-sm shadow-xl border-0"
              role="alert"
            >
              <div className="w-20 h-20 bg-gradient-to-br from-orange-100 to-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle
                  className="h-10 w-10 text-orange-500"
                  aria-hidden="true"
                />
              </div>
              <h2 className="text-2xl font-semibold mb-2 text-gray-900">
                {t("checkIn.notFound")}
              </h2>
              <p className="text-muted-foreground">
                {t("checkIn.notFoundDesc")}
              </p>
            </Card>
          )}

          {/* Booking Details */}
          {searchPerformed && !isLoading && booking && !bookingError && (
            <>
              {!booking.checkedIn ? (
                <Card className="p-6 bg-white/80 backdrop-blur-sm shadow-xl border-0">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center">
                      <Plane className="h-5 w-5 text-white" />
                    </div>
                    <h2 className="text-xl font-semibold text-gray-900">
                      {t("checkIn.bookingDetails")}
                    </h2>
                  </div>

                  {/* Flight Info */}
                  {flight && (
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 mb-6">
                      <div className="flex items-center justify-between">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-gray-900">
                            {flight.origin.code}
                          </p>
                          <p className="text-sm text-gray-500">
                            {flight.origin.city}
                          </p>
                        </div>
                        <div className="flex-1 flex flex-col items-center px-4">
                          <div className="w-full flex items-center mb-2">
                            <div className="h-px bg-blue-300 flex-1" />
                            <Plane className="h-4 w-4 text-blue-600 mx-2 rotate-90" />
                            <div className="h-px bg-blue-300 flex-1" />
                          </div>
                          <p className="text-sm font-medium text-blue-600">
                            {flight.flightNumber}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-gray-900">
                            {flight.destination.code}
                          </p>
                          <p className="text-sm text-gray-500">
                            {flight.destination.city}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4 mb-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center gap-2">
                        <Ticket className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-sm text-muted-foreground">
                            {t("checkIn.bookingRef")}
                          </p>
                          <p className="font-medium">
                            {booking.bookingReference}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-sm text-muted-foreground">
                            {t("checkIn.departure")}
                          </p>
                          <p className="font-medium">
                            {flight
                              ? new Date(flight.departureTime).toLocaleString()
                              : "-"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-sm text-muted-foreground">
                            {t("checkIn.status")}
                          </p>
                          <Badge
                            variant={
                              booking.status === "confirmed"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {t(`myBookings.status.${booking.status}`)}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-sm text-muted-foreground">
                            {t("checkIn.passengerCount")}
                          </p>
                          <p className="font-medium">
                            {booking.numberOfPassengers}
                          </p>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div>
                      <h3 className="font-semibold mb-3 text-gray-900">
                        {t("checkIn.passengers")}
                      </h3>
                      <div className="space-y-2">
                        {(passengers as Passenger[] | undefined)?.map(
                          (passenger, index) => (
                            <div
                              key={passenger.id || index}
                              className="flex items-center justify-between p-3 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                                  {index + 1}
                                </div>
                                <span className="font-medium">
                                  {passenger.title} {passenger.firstName}{" "}
                                  {passenger.lastName}
                                </span>
                              </div>
                              <Badge variant="outline">
                                {passenger.type === "adult"
                                  ? t("booking.adult")
                                  : passenger.type === "child"
                                    ? t("booking.child")
                                    : t("booking.infant")}
                              </Badge>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Seat Selection Section */}
                  {!showSeatMap ? (
                    <Button
                      variant="outline"
                      onClick={() => setShowSeatMap(true)}
                      className="w-full mb-4 h-12 border-blue-200 text-blue-600 hover:bg-blue-50"
                    >
                      <Armchair className="h-5 w-5 mr-2" />
                      {t("checkIn.selectSeats")}
                    </Button>
                  ) : (
                    <div className="mb-4">
                      <SeatMap
                        cabinClass={
                          (booking.cabinClass as "economy" | "business") ||
                          "economy"
                        }
                        onSeatSelect={handleSeatSelect}
                        maxSeats={booking.numberOfPassengers || 1}
                        aircraftType={
                          (flight as Record<string, unknown>)
                            ?.aircraftType as string
                        }
                      />
                      {selectedSeats.length > 0 &&
                        passengers &&
                        (passengers as Passenger[]).length > 0 && (
                          <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                            <p className="text-sm font-medium text-blue-700 mb-2">
                              {t("checkIn.seatAssignments")}:
                            </p>
                            {(passengers as Passenger[]).map(
                              (passenger, index) => (
                                <div
                                  key={passenger.id}
                                  className="flex items-center justify-between text-sm py-1"
                                >
                                  <span className="text-gray-700">
                                    {passenger.title} {passenger.firstName}{" "}
                                    {passenger.lastName}
                                  </span>
                                  <Badge
                                    variant={
                                      selectedSeats[index]
                                        ? "default"
                                        : "secondary"
                                    }
                                  >
                                    {selectedSeats[index]?.id ||
                                      t("checkIn.autoAssign")}
                                  </Badge>
                                </div>
                              )
                            )}
                          </div>
                        )}
                    </div>
                  )}

                  <Button
                    onClick={handleCheckIn}
                    className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 h-12 text-lg"
                    size="lg"
                    disabled={checkInMutation.isPending}
                  >
                    {checkInMutation.isPending ? (
                      <>
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                        {t("checkIn.processing")}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-5 w-5 mr-2" />
                        {t("checkIn.checkInButton")}
                      </>
                    )}
                  </Button>
                </Card>
              ) : (
                /* Checked In State - Show Boarding Pass */
                <div className="space-y-6">
                  {/* Success Banner */}
                  <Card className="p-6 bg-gradient-to-r from-green-500 to-emerald-600 text-white border-0 print:hidden">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold">
                          {t("checkIn.checkInSuccess")}
                        </h2>
                        <p className="text-green-100">
                          {t("checkIn.checkInSuccessDesc")}
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/* Print Button */}
                  <div className="flex justify-end print:hidden">
                    <Button
                      onClick={handlePrint}
                      variant="outline"
                      className="bg-white/80 hover:bg-white"
                    >
                      <Printer className="h-4 w-4 mr-2" />
                      {t("checkIn.printBoardingPass")}
                    </Button>
                  </div>

                  {/* Boarding Passes */}
                  <div
                    ref={boardingPassRef}
                    className="space-y-6 print:space-y-4"
                  >
                    {flight &&
                      (passengers as Passenger[] | undefined)?.map(
                        (passenger, index) => (
                          <BoardingPass
                            key={passenger.id}
                            passenger={passenger}
                            flight={{
                              flightNumber: flight.flightNumber,
                              airline: flight.airline.name,
                              origin: flight.origin.code,
                              originCity: flight.origin.city,
                              destination: flight.destination.code,
                              destinationCity: flight.destination.city,
                              departureTime: flight.departureTime,
                            }}
                            bookingReference={booking.bookingReference}
                            index={index}
                          />
                        )
                      )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Not Found State */}
          {searchPerformed && !isLoading && !booking && !bookingError && (
            <Card className="p-12 text-center bg-white/80 backdrop-blur-sm shadow-xl border-0">
              <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <Plane className="h-10 w-10 text-gray-400" />
              </div>
              <h2 className="text-2xl font-semibold mb-2 text-gray-900">
                {t("checkIn.notFound")}
              </h2>
              <p className="text-muted-foreground">
                {t("checkIn.notFoundDesc")}
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .boarding-pass {
            page-break-inside: avoid;
            margin-bottom: 20px;
          }
        }
      `}</style>
    </div>
  );
}
