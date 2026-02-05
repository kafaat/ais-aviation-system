import { useState } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronLeft,
  Plus,
  Trash2,
  CreditCard,
  Heart,
  Loader2,
  Plane,
  Clock,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import AncillarySelection, {
  type SelectedAncillary,
} from "@/components/AncillarySelection";

type Passenger = {
  type: "adult" | "child" | "infant";
  title?: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  passportNumber?: string;
  nationality?: string;
};

export default function BookingPage() {
  const { t, i18n } = useTranslation();
  const [, params] = useRoute("/booking/:id");
  const [location] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const flightId = params?.id ? parseInt(params.id) : 0;
  const searchParams = new URLSearchParams(location.split("?")[1]);
  const cabinClass = (searchParams.get("class") || "economy") as
    | "economy"
    | "business";

  const [passengers, setPassengers] = useState<Passenger[]>([
    { type: "adult", firstName: "", lastName: "" },
  ]);
  const [selectedAncillaries, setSelectedAncillaries] = useState<
    SelectedAncillary[]
  >([]);
  const [ancillariesTotalCost, setAncillariesTotalCost] = useState(0);

  const currentLocale = i18n.language === "ar" ? ar : enUS;

  const { data: flight, isLoading } = trpc.flights.getById.useQuery({
    id: flightId,
  });
  const createBooking = trpc.bookings.create.useMutation();
  const createPayment = trpc.payments.create.useMutation();

  // Favorites functionality
  const { data: favorites, refetch: refetchFavorites } =
    trpc.favorites.getAll.useQuery(undefined, {
      enabled: !!user,
    });

  const addFavorite = trpc.favorites.add.useMutation({
    onSuccess: () => {
      toast.success(t("favorites.addToFavorites") + " ✓");
      refetchFavorites();
    },
    onError: (error: { message: string }) => {
      toast.error(error.message);
    },
  });

  // Check if route is favorited
  const isRouteFavorited = () => {
    if (!favorites || !flight) return false;
    return favorites.some(
      (fav: { favorite: { originId: number; destinationId: number } }) =>
        fav.favorite.originId === flight.origin.id &&
        fav.favorite.destinationId === flight.destination.id
    );
  };

  const handleAddToFavorites = () => {
    if (!user) {
      toast.error(t("common.loginRequired"));
      return;
    }
    if (!flight) return;
    addFavorite.mutate({
      originId: flight.origin.id,
      destinationId: flight.destination.id,
    });
  };

  const handleShare = async () => {
    if (!flight) return;
    const url = window.location.href;
    const text = `${flight.origin.city} → ${flight.destination.city}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: t("common.appName"), text, url });
      } catch {
        // User cancelled
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success(t("common.copied"));
    }
  };

  const addPassenger = () => {
    setPassengers([
      ...passengers,
      { type: "adult", firstName: "", lastName: "" },
    ]);
  };

  const removePassenger = (index: number) => {
    if (passengers.length > 1) {
      setPassengers(passengers.filter((_, i) => i !== index));
    }
  };

  const updatePassenger = (
    index: number,
    field: keyof Passenger,
    value: Passenger[keyof Passenger]
  ) => {
    const updated = [...passengers];
    updated[index] = { ...updated[index], [field]: value };
    setPassengers(updated);
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }

    // Validate passengers
    const isValid = passengers.every(p => p.firstName && p.lastName);
    if (!isValid) {
      toast.error(t("common.error"));
      return;
    }

    try {
      // Generate session ID for inventory locking
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Create booking
      const booking = await createBooking.mutateAsync({
        flightId,
        cabinClass,
        passengers,
        sessionId,
        ancillaries:
          selectedAncillaries.length > 0 ? selectedAncillaries : undefined,
      });

      // Process payment
      await createPayment.mutateAsync({
        bookingId: booking.bookingId,
        amount: booking.totalAmount,
        method: "card",
      });

      toast.success(t("common.success"));
      navigate(`/my-bookings`);
    } catch (error: { message?: string } | unknown) {
      const errorMessage =
        error instanceof Error ? error.message : t("common.error");
      toast.error(errorMessage);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
        <SEO title={t("booking.title")} />
        <div className="container py-8">
          <Skeleton className="h-12 w-48 mb-8" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-96 w-full rounded-xl" />
            </div>
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!flight) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <SEO title={t("booking.title")} />
        <Card className="p-12 text-center border-dashed">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-6">
            <Plane className="h-10 w-10 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-4">{t("search.noFlights")}</h2>
          <Button asChild size="lg">
            <Link href="/">{t("common.back")}</Link>
          </Button>
        </Card>
      </div>
    );
  }

  const price =
    cabinClass === "economy" ? flight.economyPrice : flight.businessPrice;
  const baseAmount = (price * passengers.length) / 100;
  const totalAmount = baseAmount + ancillariesTotalCost / 100;

  const handleAncillariesChange = (
    ancillaries: SelectedAncillary[],
    totalCost: number
  ) => {
    setSelectedAncillaries(ancillaries);
    setAncillariesTotalCost(totalCost);
  };

  const isFavorited = isRouteFavorited();

  // Calculate duration
  const calculateDuration = (departure: Date, arrival: Date) => {
    const diff = new Date(arrival).getTime() - new Date(departure).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return i18n.language === "ar"
      ? `${hours}س ${minutes}د`
      : `${hours}h ${minutes}m`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <SEO
        title={`${t("booking.title")} - ${flight.origin.city} ${t("home.search.to")} ${flight.destination.city}`}
        description={t("booking.completeBooking")}
        keywords="flight booking, passenger info, payment"
      />
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/search">
                <Button variant="ghost" size="icon" className="rounded-full">
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold">{t("booking.title")}</h1>
                {flight && (
                  <p className="text-sm text-muted-foreground">
                    {flight.origin.city} → {flight.destination.city}
                  </p>
                )}
              </div>
            </div>

            {flight && (
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`rounded-full ${
                        isFavorited
                          ? "text-rose-500 bg-rose-50"
                          : "hover:text-rose-500 hover:bg-rose-50"
                      }`}
                      onClick={handleAddToFavorites}
                      disabled={addFavorite.isPending || isFavorited}
                    >
                      {addFavorite.isPending ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Heart
                          className={`h-5 w-5 ${isFavorited ? "fill-current" : ""}`}
                        />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isFavorited
                      ? t("favorites.removeFromFavorites")
                      : t("favorites.addToFavorites")}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full hover:text-blue-500 hover:bg-blue-50"
                      onClick={handleShare}
                    >
                      <Share2 className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("common.share")}</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Flight Info Card */}
          <div className="lg:col-span-2 space-y-6">
            {flight && (
              <Card className="p-6 bg-gradient-to-br from-white to-blue-50/50 border-0 shadow-lg">
                <div className="flex items-center gap-4 mb-6">
                  {flight.airline.logo ? (
                    <img
                      src={flight.airline.logo}
                      alt={flight.airline.name}
                      className="h-12 w-12 object-contain rounded-lg"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Plane className="h-6 w-6 text-primary" />
                    </div>
                  )}
                  <div>
                    <p className="font-semibold">{flight.airline.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {flight.flightNumber}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-center">
                    <p className="text-3xl font-bold">
                      {format(new Date(flight.departureTime), "HH:mm", {
                        locale: currentLocale,
                      })}
                    </p>
                    <p className="font-semibold text-primary">
                      {flight.origin.code}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {flight.origin.city}
                    </p>
                  </div>

                  <div className="flex-1 px-8">
                    <div className="relative">
                      <div className="border-t-2 border-dashed border-primary/30"></div>
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-to-br from-white to-blue-50/50 px-3">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>
                            {calculateDuration(
                              flight.departureTime,
                              flight.arrivalTime
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="text-center text-xs text-muted-foreground mt-2">
                      {t("search.directFlight")}
                    </p>
                  </div>

                  <div className="text-center">
                    <p className="text-3xl font-bold">
                      {format(new Date(flight.arrivalTime), "HH:mm", {
                        locale: currentLocale,
                      })}
                    </p>
                    <p className="font-semibold text-primary">
                      {flight.destination.code}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {flight.destination.city}
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {format(
                      new Date(flight.departureTime),
                      "EEEE, d MMMM yyyy",
                      {
                        locale: currentLocale,
                      }
                    )}
                  </span>
                  <span
                    className={`font-semibold ${cabinClass === "business" ? "text-amber-600" : "text-primary"}`}
                  >
                    {cabinClass === "business"
                      ? t("search.business")
                      : t("search.economy")}
                  </span>
                </div>
              </Card>
            )}

            {/* Passenger Details */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">
                  {t("booking.passengerInfo")}
                </h2>
                <Button onClick={addPassenger} variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  {t("booking.addPassenger")}
                </Button>
              </div>

              <div className="space-y-6">
                {passengers.map((passenger, index) => (
                  <div
                    key={index}
                    className="p-4 border rounded-lg hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-medium">
                        {t("booking.passenger")} {index + 1}
                      </h3>
                      {passengers.length > 1 && (
                        <Button
                          onClick={() => removePassenger(index)}
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t("booking.passengerType")}</Label>
                        <Select
                          value={passenger.type}
                          onValueChange={(
                            value: "adult" | "child" | "infant"
                          ) => updatePassenger(index, "type", value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="adult">
                              {t("booking.adult")}
                            </SelectItem>
                            <SelectItem value="child">
                              {t("booking.child")}
                            </SelectItem>
                            <SelectItem value="infant">
                              {t("booking.infant")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>{t("booking.title")}</Label>
                        <Select
                          value={passenger.title || ""}
                          onValueChange={value =>
                            updatePassenger(index, "title", value)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("common.search")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Mr">
                              {t("booking.mr")}
                            </SelectItem>
                            <SelectItem value="Mrs">
                              {t("booking.mrs")}
                            </SelectItem>
                            <SelectItem value="Ms">
                              {t("booking.ms")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>{t("booking.firstName")}</Label>
                        <Input
                          value={passenger.firstName}
                          onChange={e =>
                            updatePassenger(index, "firstName", e.target.value)
                          }
                          placeholder={t("booking.firstName")}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>{t("booking.lastName")}</Label>
                        <Input
                          value={passenger.lastName}
                          onChange={e =>
                            updatePassenger(index, "lastName", e.target.value)
                          }
                          placeholder={t("booking.lastName")}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>{t("booking.passportNumber")}</Label>
                        <Input
                          value={passenger.passportNumber || ""}
                          onChange={e =>
                            updatePassenger(
                              index,
                              "passportNumber",
                              e.target.value
                            )
                          }
                          placeholder={t("booking.passportNumber")}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>{t("booking.nationality")}</Label>
                        <Input
                          value={passenger.nationality || ""}
                          onChange={e =>
                            updatePassenger(
                              index,
                              "nationality",
                              e.target.value
                            )
                          }
                          placeholder={t("booking.nationality")}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Ancillary Services */}
            <AncillarySelection
              cabinClass={cabinClass}
              numberOfPassengers={passengers.length}
              onSelectionChange={handleAncillariesChange}
            />
          </div>

          {/* Booking Summary */}
          <div className="lg:col-span-1">
            <Card className="p-6 sticky top-24 shadow-lg border-0 bg-white/80 backdrop-blur-sm">
              <h2 className="text-xl font-semibold mb-4">
                {t("booking.summary")}
              </h2>

              <div className="space-y-4 mb-6">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("booking.flightNumber")}
                  </p>
                  <p className="font-medium">{flight.flightNumber}</p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("booking.route")}
                  </p>
                  <p className="font-medium">
                    {flight.origin.city} → {flight.destination.city}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("booking.class")}
                  </p>
                  <p className="font-medium">
                    {cabinClass === "economy"
                      ? t("search.economy")
                      : t("search.business")}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("booking.passengers")}
                  </p>
                  <p className="font-medium">{passengers.length}</p>
                </div>

                <div className="border-t pt-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm">{t("booking.ticketPrice")}</span>
                    <span>
                      {(price / 100).toFixed(2)} {t("common.currency")}
                    </span>
                  </div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm">{t("booking.passengers")}</span>
                    <span>× {passengers.length}</span>
                  </div>
                  {ancillariesTotalCost > 0 && (
                    <>
                      <div className="flex justify-between items-center mb-2 pt-2 border-t">
                        <span className="text-sm">
                          {t("ancillary.totalExtras")}
                        </span>
                        <span>
                          {(ancillariesTotalCost / 100).toFixed(2)}{" "}
                          {t("common.currency")}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">
                        {selectedAncillaries.length}{" "}
                        {t("ancillary.servicesSelected")}
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-center text-lg font-bold mt-4 pt-4 border-t">
                    <span>{t("booking.total")}</span>
                    <span className="text-primary">
                      {totalAmount.toFixed(2)} {t("common.currency")}
                    </span>
                  </div>
                </div>
              </div>

              <Button
                onClick={handleSubmit}
                className="w-full shadow-lg"
                size="lg"
                disabled={createBooking.isPending || createPayment.isPending}
              >
                <CreditCard className="h-5 w-5 mr-2" />
                {createBooking.isPending || createPayment.isPending
                  ? t("booking.processing")
                  : t("booking.completeBooking")}
              </Button>

              <p className="text-xs text-muted-foreground text-center mt-4">
                {t("booking.termsAgree")}
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
