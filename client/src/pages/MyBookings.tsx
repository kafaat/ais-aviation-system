import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookingCardSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from "@/components/ui/empty";
import { Link } from "wouter";
import {
  ChevronLeft,
  ChevronDown,
  Plane,
  Calendar,
  Clock,
  MapPin,
  XCircle,
  Edit,
  Package,
  Filter,
  ArrowUpDown,
  Search,
  Ticket,
  Users,
  X,
  Star,
} from "lucide-react";
import { CancelBookingDialog } from "@/components/CancelBookingDialog";
import {
  DownloadETicketButton,
  DownloadBoardingPassButton,
} from "@/components/DownloadTicketButtons";
import { ModifyBookingDialog } from "@/components/ModifyBookingDialog";
import { BookingAncillariesDisplay } from "@/components/BookingAncillariesDisplay";
import { ManageAncillariesDialog } from "@/components/ManageAncillariesDialog";
import { ReviewForm } from "@/components/ReviewForm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FlightStatusBadge,
  FlightDelayNotification,
} from "@/components/FlightStatusBadge";
import {
  useFlightStatus,
  type FlightStatusType,
} from "@/hooks/useFlightStatus";
import { BookingTimeline } from "@/components/BookingTimeline";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { getLoginUrl } from "@/const";

type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";
type PaymentStatus = "pending" | "paid" | "refunded" | "failed";
type SortOption = "dateDesc" | "dateAsc" | "priceDesc" | "priceAsc";

export default function MyBookings() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const dateLocale = isRTL ? ar : enUS;

  const { user: _user, isAuthenticated, loading } = useAuth();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const [manageAncillariesOpen, setManageAncillariesOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<any>(null);

  // Filter states
  const [statusFilter, setStatusFilter] = useState<BookingStatus | "all">(
    "all"
  );
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Sort state
  const [sortOption, setSortOption] = useState<SortOption>("dateDesc");

  const { data: bookings, isLoading } = trpc.bookings.myBookings.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  // Get flight IDs for WebSocket subscription
  const flightIds = useMemo<number[]>(
    () =>
      bookings
        ? bookings
            .map(b => b.flightId)
            .filter((id): id is number => typeof id === "number")
        : [],
    [bookings]
  );

  // Subscribe to real-time flight status updates
  const { statuses: flightStatuses, isConnected: wsConnected } =
    useFlightStatus({
      flightIds,
      enabled: isAuthenticated && flightIds.length > 0,
    });

  // Filter and sort bookings
  const filteredAndSortedBookings = useMemo(() => {
    if (!bookings) return [];

    let filtered = [...bookings];

    // Apply status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(booking => booking.status === statusFilter);
    }

    // Apply date range filter
    if (startDate) {
      const start = new Date(startDate);
      filtered = filtered.filter(
        booking => new Date(booking.flight.departureTime) >= start
      );
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter(
        booking => new Date(booking.flight.departureTime) <= end
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortOption) {
        case "dateDesc":
          return (
            new Date(b.flight.departureTime).getTime() -
            new Date(a.flight.departureTime).getTime()
          );
        case "dateAsc":
          return (
            new Date(a.flight.departureTime).getTime() -
            new Date(b.flight.departureTime).getTime()
          );
        case "priceDesc":
          return b.totalAmount - a.totalAmount;
        case "priceAsc":
          return a.totalAmount - b.totalAmount;
        default:
          return 0;
      }
    });

    return filtered;
  }, [bookings, statusFilter, startDate, endDate, sortOption]);

  const hasActiveFilters =
    statusFilter !== "all" || startDate !== "" || endDate !== "";

  const clearFilters = () => {
    setStatusFilter("all");
    setStartDate("");
    setEndDate("");
  };

  const getStatusBadgeStyle = (status: BookingStatus) => {
    const styles: Record<BookingStatus, string> = {
      pending:
        "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
      confirmed:
        "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
      cancelled:
        "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
      completed:
        "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
    };
    return styles[status] || styles.pending;
  };

  const getPaymentBadgeStyle = (status: PaymentStatus) => {
    const styles: Record<PaymentStatus, string> = {
      pending:
        "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      paid: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
      refunded:
        "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800",
      failed:
        "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
    };
    return styles[status] || styles.pending;
  };

  // Loading Skeleton
  if (loading || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950 animate-in fade-in duration-500">
        <SEO title={t("myBookings.title")} />
        <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b sticky top-0 z-50">
          <div className="container py-4">
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          </div>
        </header>
        <div className="container py-8">
          {/* Filter skeleton */}
          <div className="bg-white dark:bg-slate-900 rounded-xl p-4 mb-6 shadow-sm animate-in fade-in slide-in-from-top-4">
            <div className="flex flex-wrap gap-4">
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-10 w-40" />
            </div>
          </div>
          {/* Booking cards skeleton */}
          <div className="space-y-4">
            {[1, 2, 3].map((i, index) => (
              <div
                key={i}
                className="animate-in fade-in slide-in-from-bottom-4"
                style={{
                  animationDelay: `${index * 100}ms`,
                  animationFillMode: "backwards",
                }}
              >
                <BookingCardSkeleton />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated state
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950 flex items-center justify-center p-4">
        <SEO title={t("myBookings.title")} />
        <Card className="p-8 text-center max-w-md shadow-xl border-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <Ticket className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2">
            {t("myBookings.loginRequired")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("myBookings.loginRequiredDesc")}
          </p>
          <Button
            asChild
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md"
          >
            <a href={getLoginUrl()}>{t("common.login")}</a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950">
      <SEO
        title={t("myBookings.title")}
        description={t("myBookings.subtitle")}
        keywords="my bookings, reservations, travel history"
      />
      {/* Header */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm">
        <div className="container py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                {t("myBookings.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("myBookings.subtitle")}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="container py-8">
        {/* Filters and Sort Section */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 md:p-6 mb-6 shadow-sm border border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-4">
            {/* Filter Icon */}
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
              <Filter className="h-5 w-5" />
              <span className="font-medium hidden sm:inline">
                {t("myBookings.filters.title")}
              </span>
            </div>

            {/* Status Filter */}
            <Select
              value={statusFilter}
              onValueChange={value =>
                setStatusFilter(value as BookingStatus | "all")
              }
            >
              <SelectTrigger className="w-[160px] rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                <SelectValue placeholder={t("myBookings.filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("myBookings.filters.allStatuses")}
                </SelectItem>
                <SelectItem value="pending">
                  {t("myBookings.status.pending")}
                </SelectItem>
                <SelectItem value="confirmed">
                  {t("myBookings.status.confirmed")}
                </SelectItem>
                <SelectItem value="completed">
                  {t("myBookings.status.completed")}
                </SelectItem>
                <SelectItem value="cancelled">
                  {t("myBookings.status.cancelled")}
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Date Range */}
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="h-9 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t("myBookings.filters.startDate")}
              />
              <span className="text-muted-foreground">-</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="h-9 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t("myBookings.filters.endDate")}
              />
            </div>

            {/* Clear Filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <X className="h-4 w-4 mr-1" />
                {t("myBookings.filters.clearFilters")}
              </Button>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Sort */}
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
              <ArrowUpDown className="h-4 w-4" />
            </div>
            <Select
              value={sortOption}
              onValueChange={value => setSortOption(value as SortOption)}
            >
              <SelectTrigger className="w-[160px] rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                <SelectValue placeholder={t("myBookings.sort.title")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dateDesc">
                  {t("myBookings.sort.dateDesc")}
                </SelectItem>
                <SelectItem value="dateAsc">
                  {t("myBookings.sort.dateAsc")}
                </SelectItem>
                <SelectItem value="priceDesc">
                  {t("myBookings.sort.priceDesc")}
                </SelectItem>
                <SelectItem value="priceAsc">
                  {t("myBookings.sort.priceAsc")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Results count */}
          {bookings && bookings.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <p className="text-sm text-muted-foreground">
                {t("myBookings.resultsCount", {
                  count: filteredAndSortedBookings.length,
                })}
              </p>
            </div>
          )}
        </div>

        {/* Bookings List */}
        {!bookings || bookings.length === 0 ? (
          // Empty state - no bookings at all
          <Empty className="border-2 border-dashed border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 rounded-2xl py-16">
            <EmptyMedia>
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 flex items-center justify-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                  <Plane className="h-8 w-8 text-white" />
                </div>
              </div>
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>{t("myBookings.noBookings")}</EmptyTitle>
              <EmptyDescription>
                {t("myBookings.noBookingsDesc")}
                <br />
                <span className="text-slate-500">
                  {t("myBookings.noBookingsHint")}
                </span>
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                asChild
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md"
              >
                <Link href="/">
                  <Search className="mr-2 h-4 w-4" />
                  {t("myBookings.searchFlights")}
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        ) : filteredAndSortedBookings.length === 0 ? (
          // Empty state - no matching results
          <Empty className="border-2 border-dashed border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 rounded-2xl py-16">
            <EmptyMedia variant="icon">
              <Filter className="h-6 w-6" />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>{t("myBookings.noResults")}</EmptyTitle>
              <EmptyDescription>
                {t("myBookings.noResultsHint")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={clearFilters}>
                {t("myBookings.filters.clearFilters")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="space-y-4">
            {filteredAndSortedBookings.map(booking => {
              const liveStatus = booking.flightId
                ? flightStatuses.get(booking.flightId)
                : undefined;
              const displayFlightStatus: FlightStatusType =
                liveStatus?.status ||
                (booking.flight?.status as FlightStatusType) ||
                "scheduled";

              return (
                <Card
                  key={booking.id}
                  className="overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300 bg-white dark:bg-slate-900"
                >
                  {/* Status gradient bar at top */}
                  <div
                    className={`h-1 ${
                      booking.status === "confirmed"
                        ? "bg-gradient-to-r from-emerald-400 to-emerald-600"
                        : booking.status === "pending"
                          ? "bg-gradient-to-r from-amber-400 to-amber-600"
                          : booking.status === "completed"
                            ? "bg-gradient-to-r from-blue-400 to-blue-600"
                            : "bg-gradient-to-r from-red-400 to-red-600"
                    }`}
                  />

                  {/* Flight Delay/Cancellation Notification */}
                  {(displayFlightStatus === "delayed" ||
                    displayFlightStatus === "cancelled") && (
                    <div className="px-6 pt-4">
                      <FlightDelayNotification
                        status={displayFlightStatus}
                        delayMinutes={liveStatus?.delayMinutes}
                        flightNumber={booking.flight.flightNumber}
                      />
                    </div>
                  )}

                  <div className="p-6">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      {/* Booking Info */}
                      <div className="lg:col-span-8">
                        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                          <div>
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                {booking.flight.flightNumber}
                              </h3>
                              {/* Live Flight Status Badge */}
                              <FlightStatusBadge
                                status={displayFlightStatus}
                                delayMinutes={liveStatus?.delayMinutes}
                                isLive={!!liveStatus}
                                isConnected={wsConnected}
                                size="sm"
                              />
                              <Badge
                                className={`${getStatusBadgeStyle(booking.status as BookingStatus)} border px-3 py-1 font-medium`}
                              >
                                {t(`myBookings.status.${booking.status}`)}
                              </Badge>
                              <Badge
                                className={`${getPaymentBadgeStyle(booking.paymentStatus as PaymentStatus)} border px-3 py-1 font-medium`}
                              >
                                {t(
                                  `myBookings.payment.${booking.paymentStatus}`
                                )}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                              <span>
                                {t("myBookings.bookingRef")}:{" "}
                                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                                  {booking.bookingReference}
                                </span>
                              </span>
                              <span className="hidden sm:inline">|</span>
                              <span>
                                {t("myBookings.pnr")}:{" "}
                                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                                  {booking.pnr}
                                </span>
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Flight route and details */}
                        <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-800/50 dark:to-slate-800/30 rounded-xl p-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                                <MapPin className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                                  {t("myBookings.from")}
                                </p>
                                <p className="font-semibold text-slate-900 dark:text-white">
                                  {booking.flight.origin}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                                <MapPin className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                                  {t("myBookings.to")}
                                </p>
                                <p className="font-semibold text-slate-900 dark:text-white">
                                  {booking.flight.destination}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                <Calendar className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                                  {t("myBookings.departureDate")}
                                </p>
                                <p className="font-semibold text-slate-900 dark:text-white">
                                  {format(
                                    new Date(booking.flight.departureTime),
                                    "PPP",
                                    { locale: dateLocale }
                                  )}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                                <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                                  {t("myBookings.passengers")}
                                </p>
                                <p className="font-semibold text-slate-900 dark:text-white">
                                  {t("myBookings.passengerCount", {
                                    count: booking.numberOfPassengers,
                                  })}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Booking Timeline - Collapsible */}
                        <Collapsible className="mt-4">
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full justify-between text-muted-foreground hover:text-foreground"
                            >
                              <span className="flex items-center gap-2">
                                <Clock className="h-4 w-4" />
                                {t("bookingTimeline.title")}
                              </span>
                              <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="pt-3">
                            <BookingTimeline
                              bookingStatus={
                                booking.status as
                                  | "pending"
                                  | "confirmed"
                                  | "cancelled"
                                  | "completed"
                              }
                              paymentStatus={
                                booking.paymentStatus as
                                  | "pending"
                                  | "paid"
                                  | "refunded"
                                  | "failed"
                              }
                              createdAt={booking.createdAt}
                              paidAt={
                                booking.paymentStatus === "paid"
                                  ? booking.createdAt
                                  : null
                              }
                              checkedInAt={
                                booking.checkedIn ? booking.createdAt : null
                              }
                              completedAt={
                                booking.status === "completed"
                                  ? booking.createdAt
                                  : null
                              }
                              cancelledAt={
                                booking.status === "cancelled"
                                  ? booking.createdAt
                                  : null
                              }
                              showRelativeTime
                            />
                          </CollapsibleContent>
                        </Collapsible>
                      </div>

                      {/* Actions */}
                      <div className="lg:col-span-4 flex flex-col justify-between">
                        <div className="text-center lg:text-right mb-4 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-xl">
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                            {t("myBookings.totalAmount")}
                          </p>
                          <p className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                            {(booking.totalAmount / 100).toFixed(2)}{" "}
                            {t("common.currency")}
                          </p>
                        </div>

                        <div className="flex flex-col gap-2">
                          {booking.status === "confirmed" &&
                            !booking.checkedIn && (
                              <Button
                                asChild
                                className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-md"
                              >
                                <Link href="/check-in">
                                  {t("myBookings.checkInNow")}
                                </Link>
                              </Button>
                            )}
                          {booking.checkedIn && (
                            <Badge className="w-full justify-center py-2.5 bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
                              {t("myBookings.checkedIn")}
                            </Badge>
                          )}
                          {booking.paymentStatus === "paid" && (
                            <div className="space-y-3">
                              {/* Passengers List with Download Buttons */}
                              <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                                <p className="text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">
                                  {t("myBookings.passengers")} (
                                  {booking.passengers.length})
                                </p>
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                  {booking.passengers.map(
                                    (passenger: any, index: number) => (
                                      <div
                                        key={passenger.id}
                                        className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700"
                                      >
                                        <div className="flex-1">
                                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                                            {index + 1}. {passenger.firstName}{" "}
                                            {passenger.lastName}
                                          </p>
                                          <p className="text-xs text-muted-foreground">
                                            {passenger.type === "adult"
                                              ? t("myBookings.adult")
                                              : passenger.type === "child"
                                                ? t("myBookings.child")
                                                : t("myBookings.infant")}
                                            {passenger.seatNumber &&
                                              ` | ${t("myBookings.seat")} ${passenger.seatNumber}`}
                                          </p>
                                        </div>
                                        <div className="flex gap-1">
                                          <DownloadETicketButton
                                            bookingId={booking.id}
                                            passengerId={passenger.id}
                                          />
                                          {(booking.status === "confirmed" ||
                                            booking.status === "completed") && (
                                            <DownloadBoardingPassButton
                                              bookingId={booking.id}
                                              passengerId={passenger.id}
                                            />
                                          )}
                                        </div>
                                      </div>
                                    )
                                  )}
                                </div>
                              </div>

                              {/* Ancillaries Display */}
                              <BookingAncillariesDisplay
                                bookingId={booking.id}
                              />

                              {/* Leave Review Button for Completed Bookings */}
                              {booking.status === "completed" && (
                                <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                                  <Button
                                    variant="outline"
                                    className="w-full rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 hover:border-amber-400 text-amber-700 hover:text-amber-800 dark:from-amber-900/20 dark:to-orange-900/20 dark:border-amber-800 dark:text-amber-400"
                                    onClick={() => {
                                      setSelectedBooking(booking);
                                      setReviewDialogOpen(true);
                                    }}
                                  >
                                    <Star className="mr-2 h-4 w-4 fill-amber-400 text-amber-400" />
                                    {t("reviews.leaveReview")}
                                  </Button>
                                </div>
                              )}

                              {/* Modify/Cancel/Manage Buttons */}
                              {booking.status !== "cancelled" &&
                                booking.status !== "completed" && (
                                  <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                                    <div className="flex gap-2">
                                      <Button
                                        variant="outline"
                                        className="flex-1 rounded-xl hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 dark:hover:bg-blue-950/30 dark:hover:text-blue-400"
                                        onClick={() => {
                                          setSelectedBooking(booking);
                                          setModifyDialogOpen(true);
                                        }}
                                      >
                                        <Edit className="mr-2 h-4 w-4" />
                                        {t("myBookings.modify")}
                                      </Button>
                                      <Button
                                        variant="outline"
                                        className="flex-1 rounded-xl hover:bg-red-50 hover:text-red-700 hover:border-red-200 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                                        onClick={() => {
                                          setSelectedBooking(booking);
                                          setCancelDialogOpen(true);
                                        }}
                                      >
                                        <XCircle className="mr-2 h-4 w-4" />
                                        {t("myBookings.cancelBooking")}
                                      </Button>
                                    </div>
                                    <Button
                                      variant="outline"
                                      className="w-full rounded-xl hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200 dark:hover:bg-purple-950/30 dark:hover:text-purple-400"
                                      onClick={() => {
                                        setSelectedBooking(booking);
                                        setManageAncillariesOpen(true);
                                      }}
                                    >
                                      <Package className="mr-2 h-4 w-4" />
                                      {t("myBookings.manageServices")}
                                    </Button>
                                  </div>
                                )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Cancel Booking Dialog */}
      {selectedBooking && (
        <CancelBookingDialog
          bookingId={selectedBooking.id}
          bookingReference={selectedBooking.bookingReference}
          totalAmount={selectedBooking.totalAmount}
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          onSuccess={() => {
            setSelectedBooking(null);
          }}
        />
      )}

      {/* Modify Booking Dialog */}
      {selectedBooking && (
        <ModifyBookingDialog
          open={modifyDialogOpen}
          onOpenChange={setModifyDialogOpen}
          booking={{
            id: selectedBooking.id,
            bookingReference: selectedBooking.bookingReference,
            flightNumber: selectedBooking.flightNumber,
            cabinClass: selectedBooking.cabinClass,
            totalAmount: selectedBooking.totalAmount,
            originName: selectedBooking.originName,
            destinationName: selectedBooking.destinationName,
          }}
        />
      )}

      {/* Manage Ancillaries Dialog */}
      {selectedBooking && (
        <ManageAncillariesDialog
          open={manageAncillariesOpen}
          onOpenChange={setManageAncillariesOpen}
          bookingId={selectedBooking.id}
          cabinClass={selectedBooking.cabinClass}
          numberOfPassengers={selectedBooking.numberOfPassengers}
        />
      )}

      {/* Review Dialog */}
      {selectedBooking && (
        <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("reviews.writeReview")}</DialogTitle>
            </DialogHeader>
            <ReviewForm
              flightId={selectedBooking.flightId}
              bookingId={selectedBooking.id}
              flightInfo={{
                flightNumber: selectedBooking.flight.flightNumber,
                origin: selectedBooking.flight.origin,
                destination: selectedBooking.flight.destination,
              }}
              onSuccess={() => {
                setReviewDialogOpen(false);
                setSelectedBooking(null);
              }}
              onCancel={() => setReviewDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
