import { useState, useEffect } from "react";
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
  Armchair,
  ChevronLeft,
  Plus,
  Trash2,
  CreditCard,
  Heart,
  Loader2,
  Plane,
  Clock,
  Share2,
  Users,
  Split,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import AncillarySelection, {
  type SelectedAncillary,
} from "@/components/AncillarySelection";
import { SeatMap } from "@/components/SeatMap";
import {
  SavedPassengerSelect,
  type PassengerData,
} from "@/components/SavedPassengerSelect";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SplitPaymentForm from "@/components/SplitPaymentForm";
import { VoucherInput } from "@/components/VoucherInput";
import { CreditBalance } from "@/components/CreditBalance";
import { CarbonOffset } from "@/components/CarbonOffset";
import { TravelRequirements } from "@/components/TravelRequirements";

type Passenger = {
  type: "adult" | "child" | "infant";
  title?: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  passportNumber?: string;
  nationality?: string;
  email?: string;
  phone?: string;
  saveForFuture?: boolean;
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
  const rebookParam = searchParams.get("rebook");
  const rebookFromId = rebookParam ? parseInt(rebookParam) : null;

  const [passengers, setPassengers] = useState<Passenger[]>([
    { type: "adult", firstName: "", lastName: "" },
  ]);
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>(
    {}
  );
  const [rebookLoaded, setRebookLoaded] = useState(false);
  const [selectedAncillaries, setSelectedAncillaries] = useState<
    SelectedAncillary[]
  >([]);
  const [ancillariesTotalCost, setAncillariesTotalCost] = useState(0);
  const [selectedSeats, setSelectedSeats] = useState<
    { id: string; row: number; column: string }[]
  >([]);
  const [showSplitPayment, setShowSplitPayment] = useState(false);
  const [createdBookingId, setCreatedBookingId] = useState<number | null>(null);
  const [createdBookingRef, setCreatedBookingRef] = useState<string | null>(
    null
  );
  const [createdBookingAmount, setCreatedBookingAmount] = useState<number>(0);
  const [smsNotification, setSmsNotification] = useState(false);
  const [smsPhoneNumber, setSmsPhoneNumber] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState<{
    code: string;
    discount: number;
  } | null>(null);
  const [creditsToUse, setCreditsToUse] = useState(0);

  const currentLocale = i18n.language === "ar" ? ar : enUS;

  const { data: flight, isLoading } = trpc.flights.getById.useQuery({
    id: flightId,
  });
  const createBooking = trpc.bookings.create.useMutation();
  const createPayment = trpc.payments.create.useMutation();
  const savePassengerMutation = trpc.savedPassengers.add.useMutation();

  // Get user preferences for SMS phone number
  const { data: userPrefs } = trpc.userPreferences.getMyPreferences.useQuery(
    undefined,
    {
      enabled: !!user,
    }
  );

  // Update state when user preferences are loaded
  useEffect(() => {
    if (userPrefs?.phoneNumber && !smsPhoneNumber) {
      setSmsPhoneNumber(userPrefs.phoneNumber);
    }
    if (userPrefs?.smsNotifications != null) {
      setSmsNotification(userPrefs.smsNotifications);
    }
  }, [userPrefs]);

  // Rebooking: fetch previous booking data to pre-fill passengers
  const { data: rebookData } = trpc.rebooking.getRebookData.useQuery(
    { bookingId: rebookFromId ?? 0 },
    { enabled: !!rebookFromId && isAuthenticated }
  );

  // Pre-fill passengers from previous booking
  useEffect(() => {
    if (rebookData && !rebookLoaded) {
      const prefilled: Passenger[] = rebookData.passengers.map(p => ({
        type: p.type,
        title: p.title ?? undefined,
        firstName: p.firstName,
        lastName: p.lastName,
        dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : undefined,
        passportNumber: p.passportNumber ?? undefined,
        nationality: p.nationality ?? undefined,
      }));
      if (prefilled.length > 0) {
        setPassengers(prefilled);
      }
      setRebookLoaded(true);
    }
  }, [rebookData, rebookLoaded]);

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

  const fillFromSaved = (index: number, data: PassengerData | null) => {
    if (!data) return;
    const updated = [...passengers];
    updated[index] = {
      ...updated[index],
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth,
      passportNumber: data.passportNumber,
      nationality: data.nationality,
    };
    setPassengers(updated);
  };

  const markTouched = (field: string) => {
    setTouchedFields(prev => ({ ...prev, [field]: true }));
  };

  const getFieldError = (
    index: number,
    field: string,
    value: string | undefined
  ): string | null => {
    const key = `${index}-${field}`;
    if (!touchedFields[key]) return null;
    if (!value || value.trim() === "") {
      if (field === "firstName" || field === "lastName") {
        return t("validation.required");
      }
    }
    if (value && value.trim().length > 0 && value.trim().length < 2) {
      if (field === "firstName" || field === "lastName") {
        return t("validation.nameTooShort");
      }
    }
    return null;
  };

  const handleSubmit = async () => {
    if (!isAuthenticated) {
      window.location.href = "/login";
      return;
    }

    // Validate passengers - mark all fields as touched for feedback
    const isValid = passengers.every(p => p.firstName && p.lastName);
    if (!isValid) {
      const allTouched: Record<string, boolean> = {};
      passengers.forEach((_, i) => {
        allTouched[`${i}-firstName`] = true;
        allTouched[`${i}-lastName`] = true;
      });
      setTouchedFields(prev => ({ ...prev, ...allTouched }));
      toast.error(t("validation.required"));
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

      // Save passengers that are marked for future use
      for (const p of passengers) {
        if (p.saveForFuture) {
          try {
            await savePassengerMutation.mutateAsync({
              firstName: p.firstName,
              lastName: p.lastName,
              dateOfBirth: p.dateOfBirth,
              nationality: p.nationality,
              passportNumber: p.passportNumber,
            });
          } catch {
            // Silently fail - don't block booking for save failure
          }
        }
      }

      toast.success(t("common.success"));
      navigate(`/my-bookings`);
    } catch (error: { message?: string } | unknown) {
      const errorMessage =
        error instanceof Error ? error.message : t("common.error");
      toast.error(errorMessage);
    }
  };

  const handleSplitPayment = async () => {
    if (!isAuthenticated) {
      window.location.href = "/login";
      return;
    }

    // Validate passengers - mark all fields as touched for feedback
    const isValid = passengers.every(p => p.firstName && p.lastName);
    if (!isValid) {
      const allTouched: Record<string, boolean> = {};
      passengers.forEach((_, i) => {
        allTouched[`${i}-firstName`] = true;
        allTouched[`${i}-lastName`] = true;
      });
      setTouchedFields(prev => ({ ...prev, ...allTouched }));
      toast.error(t("validation.required"));
      return;
    }

    try {
      // Generate session ID for inventory locking
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Create booking (without processing payment)
      const booking = await createBooking.mutateAsync({
        flightId,
        cabinClass,
        passengers,
        sessionId,
        ancillaries:
          selectedAncillaries.length > 0 ? selectedAncillaries : undefined,
      });

      // Save passengers that are marked for future use
      for (const p of passengers) {
        if (p.saveForFuture) {
          try {
            await savePassengerMutation.mutateAsync({
              firstName: p.firstName,
              lastName: p.lastName,
              dateOfBirth: p.dateOfBirth,
              nationality: p.nationality,
              passportNumber: p.passportNumber,
            });
          } catch {
            // Silently fail - don't block booking for save failure
          }
        }
      }

      // Store booking details for split payment form
      setCreatedBookingId(booking.bookingId);
      setCreatedBookingRef(booking.bookingReference);
      setCreatedBookingAmount(booking.totalAmount);
      setShowSplitPayment(true);
    } catch (error: { message?: string } | unknown) {
      const errorMessage =
        error instanceof Error ? error.message : t("common.error");
      toast.error(errorMessage);
    }
  };

  const handleSplitPaymentSuccess = () => {
    setShowSplitPayment(false);
    toast.success(t("splitPayment.initiateSuccess"));
    navigate(`/my-bookings`);
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
  const subtotal = baseAmount + ancillariesTotalCost / 100;
  const voucherDiscount = appliedVoucher ? appliedVoucher.discount / 100 : 0;
  const creditDiscount = creditsToUse / 100;
  const totalAmount = Math.max(0, subtotal - voucherDiscount - creditDiscount);
  const subtotalInCents = Math.round(subtotal * 100);

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
      <header
        className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm"
        role="banner"
      >
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/search">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  aria-label={t("common.back")}
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
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
                      aria-label={
                        isFavorited
                          ? t("favorites.removeFromFavorites")
                          : t("favorites.addToFavorites")
                      }
                    >
                      {addFavorite.isPending ? (
                        <Loader2
                          className="h-5 w-5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Heart
                          className={`h-5 w-5 ${isFavorited ? "fill-current" : ""}`}
                          aria-hidden="true"
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
                      aria-label={t("common.share")}
                    >
                      <Share2 className="h-5 w-5" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("common.share")}</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Flight Info Card */}
          <div className="lg:col-span-2 space-y-6">
            {flight && (
              <Card
                className="p-6 bg-gradient-to-br from-white to-blue-50/50 border-0 shadow-lg"
                data-testid="flight-info"
              >
                <div className="flex items-center gap-4 mb-6">
                  {flight.airline.logo ? (
                    <img
                      src={flight.airline.logo}
                      alt={flight.airline.name}
                      className="h-12 w-12 object-contain rounded-lg"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Plane
                        className="h-6 w-6 text-primary"
                        aria-hidden="true"
                      />
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
                    <p className="text-2xl sm:text-3xl font-bold">
                      {format(new Date(flight.departureTime), "HH:mm", {
                        locale: currentLocale,
                      })}
                    </p>
                    <p className="font-semibold text-primary">
                      {flight.origin.code}
                    </p>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {flight.origin.city}
                    </p>
                  </div>

                  <div className="flex-1 px-4 sm:px-8">
                    <div className="relative">
                      <div className="border-t-2 border-dashed border-primary/30"></div>
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-to-br from-white to-blue-50/50 px-3">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" aria-hidden="true" />
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

            {/* Rebook Banner */}
            {rebookFromId && rebookData && (
              <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-800 rounded-xl">
                <RefreshCw className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                <div>
                  <p className="font-medium text-blue-900 dark:text-blue-200">
                    {t("rebook.prefilledBanner")}
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-400">
                    {t("rebook.prefilledBannerDesc", {
                      ref: rebookData.originalBookingRef,
                    })}
                  </p>
                </div>
              </div>
            )}

            {/* Passenger Details */}
            <Card className="p-6" data-testid="passenger-form">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">
                  {t("booking.passengerInfo")}
                </h2>
                <Button onClick={addPassenger} variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
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
                          aria-label={`${t("booking.removePassenger")} ${index + 1}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>

                    {/* Saved Passenger Select */}
                    {isAuthenticated && (
                      <div className="mb-4">
                        <Label className="flex items-center gap-2 mb-2">
                          <Users className="h-4 w-4" />
                          {t("savedPassengers.selectSaved")}
                        </Label>
                        <SavedPassengerSelect
                          onSelect={data => fillFromSaved(index, data)}
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor={`pax-type-${index}`}>
                          {t("booking.passengerType")}
                        </Label>
                        <Select
                          value={passenger.type}
                          onValueChange={(
                            value: "adult" | "child" | "infant"
                          ) => updatePassenger(index, "type", value)}
                        >
                          <SelectTrigger id={`pax-type-${index}`}>
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
                        <Label htmlFor={`pax-title-${index}`}>
                          {t("booking.honorific")}
                        </Label>
                        <Select
                          value={passenger.title || ""}
                          onValueChange={value =>
                            updatePassenger(index, "title", value)
                          }
                        >
                          <SelectTrigger id={`pax-title-${index}`}>
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
                        <Label htmlFor={`pax-firstname-${index}`}>
                          {t("booking.firstName")}{" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id={`pax-firstname-${index}`}
                          value={passenger.firstName}
                          onChange={e =>
                            updatePassenger(index, "firstName", e.target.value)
                          }
                          onBlur={() => markTouched(`${index}-firstName`)}
                          placeholder={t("booking.firstName")}
                          className={
                            getFieldError(
                              index,
                              "firstName",
                              passenger.firstName
                            )
                              ? "border-destructive focus-visible:ring-destructive"
                              : ""
                          }
                          aria-invalid={
                            !!getFieldError(
                              index,
                              "firstName",
                              passenger.firstName
                            )
                          }
                        />
                        {getFieldError(
                          index,
                          "firstName",
                          passenger.firstName
                        ) && (
                          <p className="text-xs text-destructive mt-1">
                            {getFieldError(
                              index,
                              "firstName",
                              passenger.firstName
                            )}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`pax-lastname-${index}`}>
                          {t("booking.lastName")}{" "}
                          <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id={`pax-lastname-${index}`}
                          value={passenger.lastName}
                          onChange={e =>
                            updatePassenger(index, "lastName", e.target.value)
                          }
                          onBlur={() => markTouched(`${index}-lastName`)}
                          placeholder={t("booking.lastName")}
                          className={
                            getFieldError(index, "lastName", passenger.lastName)
                              ? "border-destructive focus-visible:ring-destructive"
                              : ""
                          }
                          aria-invalid={
                            !!getFieldError(
                              index,
                              "lastName",
                              passenger.lastName
                            )
                          }
                        />
                        {getFieldError(
                          index,
                          "lastName",
                          passenger.lastName
                        ) && (
                          <p className="text-xs text-destructive mt-1">
                            {getFieldError(
                              index,
                              "lastName",
                              passenger.lastName
                            )}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`pax-passport-${index}`}>
                          {t("booking.passportNumber")}
                        </Label>
                        <Input
                          id={`pax-passport-${index}`}
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
                        <Label htmlFor={`pax-nationality-${index}`}>
                          {t("booking.nationality")}
                        </Label>
                        <Input
                          id={`pax-nationality-${index}`}
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

                    {/* Save for future checkbox */}
                    {isAuthenticated && (
                      <div className="flex items-center space-x-2 mt-4 pt-4 border-t">
                        <Checkbox
                          id={`save-passenger-${index}`}
                          checked={passenger.saveForFuture || false}
                          onCheckedChange={(checked: boolean) =>
                            updatePassenger(index, "saveForFuture", checked)
                          }
                        />
                        <Label
                          htmlFor={`save-passenger-${index}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {t("savedPassengers.saveThisPassenger")}
                        </Label>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            {/* Seat Selection */}
            <Card className="p-6" data-testid="seat-selection">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Armchair
                    className="h-5 w-5 text-primary"
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">
                    {t("booking.selectSeats")}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t("seatMap.sectionDescription")}
                  </p>
                </div>
              </div>
              <SeatMap
                cabinClass={cabinClass}
                maxSeats={passengers.length}
                aircraftType={flight.aircraftType ?? undefined}
                onSeatSelect={seats =>
                  setSelectedSeats(
                    seats.map(s => ({
                      id: s.id,
                      row: s.row,
                      column: s.column,
                    }))
                  )
                }
              />
            </Card>

            {/* Ancillary Services */}
            <AncillarySelection
              cabinClass={cabinClass}
              numberOfPassengers={passengers.length}
              onSelectionChange={handleAncillariesChange}
            />

            {/* Travel Requirements & Carbon Offset */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TravelRequirements flightId={flightId} />
              <CarbonOffset flightId={flightId} cabinClass={cabinClass} />
            </div>
          </div>

          {/* Booking Summary */}
          <div className="lg:col-span-1">
            <Card
              className="p-6 sticky top-24 shadow-lg border-0 bg-white/80 backdrop-blur-sm"
              data-testid="booking-summary"
            >
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

                {selectedSeats.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("seatMap.selectedSeats")}
                    </p>
                    <div className="flex gap-1.5 flex-wrap mt-1">
                      {selectedSeats.map(seat => (
                        <span
                          key={seat.id}
                          className="px-2 py-0.5 bg-primary/10 text-primary rounded text-sm font-medium"
                        >
                          {seat.id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

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
                  {voucherDiscount > 0 && (
                    <div className="flex justify-between items-center mb-2 text-green-600">
                      <span className="text-sm">{t("voucher.title")}</span>
                      <span>
                        -{voucherDiscount.toFixed(2)} {t("common.currency")}
                      </span>
                    </div>
                  )}
                  {creditDiscount > 0 && (
                    <div className="flex justify-between items-center mb-2 text-green-600">
                      <span className="text-sm">{t("credits.title")}</span>
                      <span>
                        -{creditDiscount.toFixed(2)} {t("common.currency")}
                      </span>
                    </div>
                  )}
                  <div
                    className="flex justify-between items-center text-lg font-bold mt-4 pt-4 border-t"
                    data-testid="total-price"
                  >
                    <span>{t("booking.total")}</span>
                    <span className="text-primary">
                      {totalAmount.toFixed(2)} {t("common.currency")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Voucher Input */}
              {isAuthenticated && (
                <VoucherInput
                  amount={subtotalInCents}
                  appliedVoucher={appliedVoucher}
                  onVoucherApplied={(discount, code) =>
                    setAppliedVoucher({ discount, code })
                  }
                  onVoucherRemoved={() => setAppliedVoucher(null)}
                  className="mb-4"
                />
              )}

              {/* Credit Balance */}
              {isAuthenticated && (
                <CreditBalance
                  maxAmount={subtotalInCents - (appliedVoucher?.discount ?? 0)}
                  selectedCredits={creditsToUse}
                  onUseCredits={setCreditsToUse}
                  showUsageOption
                  className="mb-4"
                />
              )}

              {/* SMS Notification Option */}
              <div className="mb-6 p-4 border rounded-lg bg-muted/30">
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="sms-notification"
                    checked={smsNotification}
                    onCheckedChange={(checked: boolean) =>
                      setSmsNotification(checked)
                    }
                  />
                  <div className="space-y-1 flex-1">
                    <Label
                      htmlFor="sms-notification"
                      className="text-sm font-medium cursor-pointer flex items-center gap-2"
                    >
                      <MessageSquare className="h-4 w-4" />
                      {t("sms.receiveNotifications")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("sms.notificationDescription")}
                    </p>
                    {smsNotification && (
                      <div className="mt-2">
                        <Input
                          type="tel"
                          placeholder={t("sms.phoneNumberPlaceholder")}
                          value={smsPhoneNumber}
                          onChange={e => setSmsPhoneNumber(e.target.value)}
                          className="h-9 text-sm"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={handleSubmit}
                  className="w-full shadow-lg"
                  size="lg"
                  disabled={createBooking.isPending || createPayment.isPending}
                >
                  <CreditCard className="h-5 w-5 mr-2" aria-hidden="true" />
                  {createBooking.isPending || createPayment.isPending
                    ? t("booking.processing")
                    : t("booking.completeBooking")}
                </Button>

                <Button
                  onClick={handleSplitPayment}
                  variant="outline"
                  className="w-full"
                  size="lg"
                  disabled={createBooking.isPending || createPayment.isPending}
                >
                  <Split className="h-5 w-5 mr-2" aria-hidden="true" />
                  {t("splitPayment.splitWithOthers")}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground text-center mt-4">
                {t("booking.termsAgree")}
              </p>
            </Card>
          </div>
        </div>
      </main>

      {/* Split Payment Dialog */}
      <Dialog open={showSplitPayment} onOpenChange={setShowSplitPayment}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("splitPayment.title")}</DialogTitle>
            <DialogDescription>
              {t("splitPayment.description")}
            </DialogDescription>
          </DialogHeader>
          {createdBookingId && createdBookingRef && (
            <SplitPaymentForm
              bookingId={createdBookingId}
              totalAmount={createdBookingAmount}
              bookingReference={createdBookingRef}
              onSuccess={handleSplitPaymentSuccess}
              onCancel={() => setShowSplitPayment(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
