/**
 * Emergency Hotel Management Page
 *
 * Admin interface for managing emergency hotel accommodations for disrupted
 * passengers (IROPS). Covers contracted hotel management, booking oversight,
 * cost reporting, and adding new hotel partnerships.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect } from "wouter";
import {
  Building,
  Bed,
  DollarSign,
  CheckCircle2,
  XCircle,
  Plus,
  MapPin,
  Users,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

type BookingStatus =
  | "reserved"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show";

// ============================================================================
// Helpers
// ============================================================================

function formatSAR(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ============================================================================
// Status Badge
// ============================================================================

function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const { t } = useTranslation();

  const config: Record<
    BookingStatus,
    {
      variant: "default" | "secondary" | "destructive" | "outline";
      label: string;
    }
  > = {
    reserved: {
      variant: "secondary",
      label: t("emergencyHotel.status.reserved", "Reserved"),
    },
    checked_in: {
      variant: "default",
      label: t("emergencyHotel.status.checkedIn", "Checked In"),
    },
    checked_out: {
      variant: "outline",
      label: t("emergencyHotel.status.checkedOut", "Checked Out"),
    },
    cancelled: {
      variant: "destructive",
      label: t("emergencyHotel.status.cancelled", "Cancelled"),
    },
    no_show: {
      variant: "destructive",
      label: t("emergencyHotel.status.noShow", "No Show"),
    },
  };

  const c = config[status] ?? config.reserved;

  return <Badge variant={c.variant}>{c.label}</Badge>;
}

// ============================================================================
// Star Rating Display
// ============================================================================

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-500">
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={
            i < rating ? "text-amber-500" : "text-gray-300 dark:text-gray-600"
          }
        >
          &#9733;
        </span>
      ))}
    </span>
  );
}

// ============================================================================
// Mock Fallback Data
// ============================================================================

const MOCK_HOTELS = [
  {
    id: 1,
    name: "Riyadh Airport Hotel",
    airportId: 1,
    address: "King Khalid International Airport, Riyadh",
    phone: "+966-11-555-0001",
    email: "reservations@riyadhairporthotel.com",
    starRating: 4,
    standardRate: 45000,
    distanceKm: "2.50",
    hasTransport: true,
    isActive: true,
    createdAt: new Date("2025-10-15"),
    airportCode: "RUH",
    airportCity: "Riyadh",
  },
  {
    id: 2,
    name: "Jeddah Crown Plaza",
    airportId: 2,
    address: "King Abdulaziz International Airport Road, Jeddah",
    phone: "+966-12-555-0002",
    email: "front@jeddahcrown.com",
    starRating: 5,
    standardRate: 65000,
    distanceKm: "4.80",
    hasTransport: true,
    isActive: true,
    createdAt: new Date("2025-11-01"),
    airportCode: "JED",
    airportCity: "Jeddah",
  },
  {
    id: 3,
    name: "Dammam Transit Lodge",
    airportId: 3,
    address: "Near King Fahd Airport, Dammam",
    phone: "+966-13-555-0003",
    email: "info@dammamtransit.com",
    starRating: 3,
    standardRate: 30000,
    distanceKm: "1.20",
    hasTransport: false,
    isActive: true,
    createdAt: new Date("2025-12-01"),
    airportCode: "DMM",
    airportCity: "Dammam",
  },
];

const MOCK_BOOKINGS = [
  {
    id: 1,
    hotelId: 1,
    bookingId: 1042,
    flightId: 305,
    passengerId: 2001,
    roomType: "standard" as const,
    checkIn: new Date("2026-02-08T22:00:00"),
    checkOut: new Date("2026-02-09T12:00:00"),
    nightlyRate: 45000,
    totalCost: 45000,
    mealIncluded: true,
    transportIncluded: true,
    status: "reserved" as const,
    confirmationNumber: "EH-A3K9B2XP",
    notes: null,
    createdAt: new Date("2026-02-08T20:00:00"),
    hotelName: "Riyadh Airport Hotel",
    hotelAddress: "King Khalid International Airport, Riyadh",
    hotelPhone: "+966-11-555-0001",
    hotelStarRating: 4,
  },
  {
    id: 2,
    hotelId: 2,
    bookingId: 1050,
    flightId: 305,
    passengerId: 2002,
    roomType: "suite" as const,
    checkIn: new Date("2026-02-08T22:00:00"),
    checkOut: new Date("2026-02-09T12:00:00"),
    nightlyRate: 117000,
    totalCost: 117000,
    mealIncluded: true,
    transportIncluded: true,
    status: "checked_in" as const,
    confirmationNumber: "EH-M7P3Q1NZ",
    notes: "VIP passenger - loyalty gold member",
    createdAt: new Date("2026-02-08T20:30:00"),
    hotelName: "Jeddah Crown Plaza",
    hotelAddress: "King Abdulaziz International Airport Road, Jeddah",
    hotelPhone: "+966-12-555-0002",
    hotelStarRating: 5,
  },
  {
    id: 3,
    hotelId: 1,
    bookingId: 1055,
    flightId: 310,
    passengerId: 2010,
    roomType: "standard" as const,
    checkIn: new Date("2026-02-07T23:00:00"),
    checkOut: new Date("2026-02-08T11:00:00"),
    nightlyRate: 45000,
    totalCost: 45000,
    mealIncluded: true,
    transportIncluded: false,
    status: "checked_out" as const,
    confirmationNumber: "EH-W2J5R8LD",
    notes: null,
    createdAt: new Date("2026-02-07T21:00:00"),
    hotelName: "Riyadh Airport Hotel",
    hotelAddress: "King Khalid International Airport, Riyadh",
    hotelPhone: "+966-11-555-0001",
    hotelStarRating: 4,
  },
  {
    id: 4,
    hotelId: 3,
    bookingId: 1060,
    flightId: 315,
    passengerId: 2020,
    roomType: "standard" as const,
    checkIn: new Date("2026-02-06T21:00:00"),
    checkOut: new Date("2026-02-07T10:00:00"),
    nightlyRate: 30000,
    totalCost: 30000,
    mealIncluded: false,
    transportIncluded: false,
    status: "cancelled" as const,
    confirmationNumber: "EH-X9C4F6HA",
    notes: "Passenger rebooked on earlier flight",
    createdAt: new Date("2026-02-06T19:00:00"),
    hotelName: "Dammam Transit Lodge",
    hotelAddress: "Near King Fahd Airport, Dammam",
    hotelPhone: "+966-13-555-0003",
    hotelStarRating: 3,
  },
];

const MOCK_COSTS = {
  summary: {
    totalCost: 237000,
    activeTotalCost: 207000,
    totalBookings: 4,
    cancelledBookings: 1,
    activeBookings: 3,
  },
  byHotel: [
    {
      hotelId: 1,
      hotelName: "Riyadh Airport Hotel",
      totalCost: 90000,
      bookingCount: 2,
    },
    {
      hotelId: 2,
      hotelName: "Jeddah Crown Plaza",
      totalCost: 117000,
      bookingCount: 1,
    },
    {
      hotelId: 3,
      hotelName: "Dammam Transit Lodge",
      totalCost: 0,
      bookingCount: 0,
    },
  ],
  dateRange: {
    from: new Date("2026-02-01"),
    to: new Date("2026-02-28"),
  },
};

// ============================================================================
// Summary Cards
// ============================================================================

function SummaryCards() {
  const { t } = useTranslation();

  const { data: hotels, isLoading: hotelsLoading } =
    trpc.emergencyHotel.getHotels.useQuery(undefined, {
      retry: false,
    });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59
  );

  const { data: costs, isLoading: costsLoading } =
    trpc.emergencyHotel.getCosts.useQuery(
      { from: monthStart, to: monthEnd },
      { retry: false }
    );

  const isLoading = hotelsLoading || costsLoading;

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  const hotelData = hotels ?? MOCK_HOTELS;
  const costData = costs ?? MOCK_COSTS;

  const contractedHotels = hotelData.length;
  const activeBookings = costData.summary.activeBookings;
  const pendingAssignments =
    costData.summary.totalBookings -
    costData.summary.activeBookings -
    costData.summary.cancelledBookings;
  const monthlyCost = costData.summary.activeTotalCost;

  const cards = [
    {
      title: t("emergencyHotel.contractedHotels", "Contracted Hotels"),
      value: contractedHotels,
      icon: <Building className="h-5 w-5 text-muted-foreground" />,
      detail: `${hotelData.filter(h => h.isActive).length} ${t("emergencyHotel.active", "active")}`,
    },
    {
      title: t("emergencyHotel.activeBookings", "Active Bookings"),
      value: activeBookings,
      icon: <Bed className="h-5 w-5 text-muted-foreground" />,
      detail: `${costData.summary.totalBookings} ${t("emergencyHotel.totalThisMonth", "total this month")}`,
    },
    {
      title: t("emergencyHotel.pendingAssignments", "Pending Assignments"),
      value: Math.max(0, pendingAssignments),
      icon: <Users className="h-5 w-5 text-muted-foreground" />,
      detail: `${costData.summary.cancelledBookings} ${t("emergencyHotel.cancelled", "cancelled")}`,
    },
    {
      title: t("emergencyHotel.monthlyCost", "Monthly Cost (SAR)"),
      value: `${formatSAR(monthlyCost)}`,
      icon: <DollarSign className="h-5 w-5 text-muted-foreground" />,
      detail: `${formatSAR(costData.summary.totalCost)} SAR ${t("emergencyHotel.grossTotal", "gross total")}`,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, i) => (
        <Card key={i} className="shadow-sm rounded-xl">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{card.title}</p>
                <p className="mt-1 text-2xl font-bold">{card.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {card.detail}
                </p>
              </div>
              {card.icon}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// Bookings Tab
// ============================================================================

function BookingsTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? ar : enUS;
  const [flightIdFilter, setFlightIdFilter] = useState("");

  const {
    data: bookings,
    isLoading,
    refetch,
  } = trpc.emergencyHotel.getFlightHotelBookings.useQuery(
    { flightId: parseInt(flightIdFilter) },
    {
      enabled: !!flightIdFilter && !isNaN(parseInt(flightIdFilter)),
      retry: false,
    }
  );

  const cancelMutation = trpc.emergencyHotel.cancelBooking.useMutation({
    onSuccess: () => {
      toast.success(
        t(
          "emergencyHotel.bookingCancelled",
          "Hotel booking cancelled successfully"
        )
      );
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleCancel = (hotelBookingId: number) => {
    cancelMutation.mutate({ hotelBookingId });
  };

  const displayBookings = bookings ?? (flightIdFilter ? [] : MOCK_BOOKINGS);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Flight filter */}
      <div className="flex flex-wrap gap-3">
        <div className="w-64">
          <Input
            type="number"
            value={flightIdFilter}
            onChange={e => setFlightIdFilter(e.target.value)}
            placeholder={t(
              "emergencyHotel.enterFlightId",
              "Enter Flight ID to filter..."
            )}
          />
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={!flightIdFilter || isLoading}
        >
          {t("emergencyHotel.search", "Search")}
        </Button>
        {flightIdFilter && (
          <Button variant="ghost" onClick={() => setFlightIdFilter("")}>
            {t("emergencyHotel.clearFilter", "Clear")}
          </Button>
        )}
      </div>

      {!flightIdFilter && (
        <p className="text-sm text-muted-foreground">
          {t(
            "emergencyHotel.bookingsHint",
            "Enter a Flight ID above to view hotel bookings for a disrupted flight. Showing sample data below."
          )}
        </p>
      )}

      {/* Bookings Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">
                {t("emergencyHotel.confirmation", "Confirmation")}
              </TableHead>
              <TableHead>{t("emergencyHotel.hotel", "Hotel")}</TableHead>
              <TableHead>
                {t("emergencyHotel.guest", "Guest / Booking")}
              </TableHead>
              <TableHead>{t("emergencyHotel.flight", "Flight")}</TableHead>
              <TableHead>{t("emergencyHotel.roomType", "Room")}</TableHead>
              <TableHead>
                {t("emergencyHotel.dates", "Check-in / Out")}
              </TableHead>
              <TableHead>{t("emergencyHotel.cost", "Cost")}</TableHead>
              <TableHead>{t("emergencyHotel.includes", "Includes")}</TableHead>
              <TableHead>{t("emergencyHotel.status", "Status")}</TableHead>
              <TableHead className="w-28">
                {t("emergencyHotel.actions", "Actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayBookings.length > 0 ? (
              displayBookings.map(booking => (
                <TableRow key={booking.id}>
                  <TableCell className="font-mono text-xs">
                    {booking.confirmationNumber}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <span className="font-medium">{booking.hotelName}</span>
                      <div className="text-xs text-muted-foreground">
                        <StarRating rating={booking.hotelStarRating} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <span className="font-medium">
                        P-{booking.passengerId}
                      </span>
                      <div className="text-xs text-muted-foreground">
                        B-{booking.bookingId}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    F-{booking.flightId}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize text-xs">
                      {booking.roomType}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">
                      <div>
                        {format(new Date(booking.checkIn), "PP p", { locale })}
                      </div>
                      <div className="text-muted-foreground">
                        {format(new Date(booking.checkOut), "PP p", { locale })}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <span className="font-medium">
                        {formatSAR(booking.totalCost)} SAR
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {formatSAR(booking.nightlyRate)} SAR/
                        {t("emergencyHotel.night", "night")}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {booking.mealIncluded && (
                        <Badge
                          variant="outline"
                          className="text-xs border-green-300 text-green-700 dark:border-green-700 dark:text-green-300"
                        >
                          {t("emergencyHotel.meals", "Meals")}
                        </Badge>
                      )}
                      {booking.transportIncluded && (
                        <Badge
                          variant="outline"
                          className="text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300"
                        >
                          {t("emergencyHotel.transport", "Transport")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <BookingStatusBadge status={booking.status} />
                  </TableCell>
                  <TableCell>
                    {(booking.status === "reserved" ||
                      booking.status === "checked_in") && (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={cancelMutation.isPending}
                        onClick={() => handleCancel(booking.id)}
                      >
                        <XCircle className="me-1 h-3 w-3" />
                        {t("emergencyHotel.cancel", "Cancel")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="py-8 text-center text-muted-foreground"
                >
                  <Bed className="mx-auto mb-2 h-8 w-8" />
                  {t(
                    "emergencyHotel.noBookings",
                    "No hotel bookings found for this flight"
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {displayBookings.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("emergencyHotel.totalBookings", "Total bookings")}:{" "}
          {displayBookings.length} |{" "}
          {t("emergencyHotel.totalCostLabel", "Total cost")}:{" "}
          {formatSAR(
            displayBookings
              .filter(b => b.status !== "cancelled")
              .reduce((sum, b) => sum + b.totalCost, 0)
          )}{" "}
          SAR
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Hotels Tab
// ============================================================================

function HotelsTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? ar : enUS;

  const {
    data: hotels,
    isLoading,
    refetch,
  } = trpc.emergencyHotel.getHotels.useQuery(undefined, {
    retry: false,
  });

  const updateMutation = trpc.emergencyHotel.updateHotel.useMutation({
    onSuccess: () => {
      toast.success(
        t("emergencyHotel.hotelUpdated", "Hotel updated successfully")
      );
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleToggleActive = (hotelId: number, currentActive: boolean) => {
    updateMutation.mutate({
      hotelId,
      isActive: !currentActive,
    });
  };

  const displayHotels = hotels ?? MOCK_HOTELS;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">
                {t("emergencyHotel.id", "ID")}
              </TableHead>
              <TableHead>
                {t("emergencyHotel.hotelName", "Hotel Name")}
              </TableHead>
              <TableHead>{t("emergencyHotel.airport", "Airport")}</TableHead>
              <TableHead>{t("emergencyHotel.rating", "Rating")}</TableHead>
              <TableHead>
                {t("emergencyHotel.standardRate", "Nightly Rate")}
              </TableHead>
              <TableHead>{t("emergencyHotel.distance", "Distance")}</TableHead>
              <TableHead>
                {t("emergencyHotel.transportAvailable", "Transport")}
              </TableHead>
              <TableHead>{t("emergencyHotel.contact", "Contact")}</TableHead>
              <TableHead>{t("emergencyHotel.added", "Added")}</TableHead>
              <TableHead>{t("emergencyHotel.status", "Status")}</TableHead>
              <TableHead className="w-28">
                {t("emergencyHotel.actions", "Actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayHotels.length > 0 ? (
              displayHotels.map(hotel => (
                <TableRow
                  key={hotel.id}
                  className={!hotel.isActive ? "opacity-60 bg-muted/30" : ""}
                >
                  <TableCell className="font-mono text-sm">
                    #{hotel.id}
                  </TableCell>
                  <TableCell>
                    <div>
                      <span className="font-medium">{hotel.name}</span>
                      <div className="text-xs text-muted-foreground">
                        <MapPin className="me-1 inline h-3 w-3" />
                        {hotel.address}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {hotel.airportCode ?? `ID-${hotel.airportId}`}
                    </Badge>
                    {hotel.airportCity && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {hotel.airportCity}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <StarRating rating={hotel.starRating} />
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {formatSAR(hotel.standardRate)} SAR
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {hotel.distanceKm} km
                  </TableCell>
                  <TableCell>
                    {hotel.hasTransport ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-400" />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">
                      <div>{hotel.phone}</div>
                      <div className="text-muted-foreground">{hotel.email}</div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(hotel.createdAt), "PP", { locale })}
                  </TableCell>
                  <TableCell>
                    {hotel.isActive ? (
                      <Badge
                        variant="default"
                        className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0"
                      >
                        {t("emergencyHotel.active", "Active")}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        {t("emergencyHotel.inactive", "Inactive")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant={hotel.isActive ? "outline" : "default"}
                      size="sm"
                      disabled={updateMutation.isPending}
                      onClick={() =>
                        handleToggleActive(hotel.id, hotel.isActive)
                      }
                    >
                      {hotel.isActive
                        ? t("emergencyHotel.deactivate", "Deactivate")
                        : t("emergencyHotel.activate", "Activate")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={11}
                  className="py-8 text-center text-muted-foreground"
                >
                  <Building className="mx-auto mb-2 h-8 w-8" />
                  {t(
                    "emergencyHotel.noHotels",
                    "No contracted hotels found. Add a hotel to get started."
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ============================================================================
// Costs Tab
// ============================================================================

function CostsTab() {
  const { t } = useTranslation();

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 0);
    return d.toISOString().split("T")[0];
  });

  const {
    data: costs,
    isLoading,
    refetch,
  } = trpc.emergencyHotel.getCosts.useQuery(
    {
      from: new Date(fromDate),
      to: new Date(toDate + "T23:59:59"),
    },
    {
      enabled: !!fromDate && !!toDate,
      retry: false,
    }
  );

  const displayCosts = costs ?? MOCK_COSTS;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Date range filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="mb-1 block text-sm font-medium text-muted-foreground">
            {t("emergencyHotel.from", "From")}
          </label>
          <Input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-muted-foreground">
            {t("emergencyHotel.to", "To")}
          </label>
          <Input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          {t("emergencyHotel.refresh", "Refresh")}
        </Button>
      </div>

      {/* Cost Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-sm rounded-xl">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              {t("emergencyHotel.activeHotelCost", "Active Hotel Cost")}
            </p>
            <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-400">
              {formatSAR(displayCosts.summary.activeTotalCost)} SAR
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {displayCosts.summary.activeBookings}{" "}
              {t("emergencyHotel.activeBookingsLabel", "active bookings")}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm rounded-xl">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              {t("emergencyHotel.grossCost", "Gross Cost (inc. cancelled)")}
            </p>
            <p className="mt-1 text-2xl font-bold">
              {formatSAR(displayCosts.summary.totalCost)} SAR
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {displayCosts.summary.totalBookings}{" "}
              {t("emergencyHotel.totalBookingsLabel", "total bookings")}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm rounded-xl">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              {t("emergencyHotel.cancelledSavings", "Cancelled (Savings)")}
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
              {formatSAR(
                displayCosts.summary.totalCost -
                  displayCosts.summary.activeTotalCost
              )}{" "}
              SAR
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {displayCosts.summary.cancelledBookings}{" "}
              {t("emergencyHotel.cancelledBookingsLabel", "cancellations")}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm rounded-xl">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              {t("emergencyHotel.avgPerBooking", "Avg. Cost per Booking")}
            </p>
            <p className="mt-1 text-2xl font-bold">
              {displayCosts.summary.activeBookings > 0
                ? formatSAR(
                    Math.round(
                      displayCosts.summary.activeTotalCost /
                        displayCosts.summary.activeBookings
                    )
                  )
                : "0.00"}{" "}
              SAR
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("emergencyHotel.perActiveBooking", "per active booking")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cost by Hotel Breakdown */}
      <Card className="shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building className="h-5 w-5" />
            {t("emergencyHotel.costByHotel", "Cost Breakdown by Hotel")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {displayCosts.byHotel.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("emergencyHotel.hotelName", "Hotel")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("emergencyHotel.bookingCount", "Bookings")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("emergencyHotel.totalCostColumn", "Total Cost")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("emergencyHotel.share", "Share")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayCosts.byHotel.map(item => (
                    <TableRow key={item.hotelId}>
                      <TableCell className="font-medium">
                        {item.hotelName}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.bookingCount}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatSAR(item.totalCost)} SAR
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {displayCosts.summary.activeTotalCost > 0
                          ? (
                              (item.totalCost /
                                displayCosts.summary.activeTotalCost) *
                              100
                            ).toFixed(1)
                          : "0.0"}
                        %
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="py-8 text-center text-muted-foreground">
              {t(
                "emergencyHotel.noCostData",
                "No cost data for the selected period"
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Add Hotel Tab
// ============================================================================

function AddHotelTab() {
  const { t } = useTranslation();

  const [name, setName] = useState("");
  const [airportId, setAirportId] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [starRating, setStarRating] = useState("4");
  const [standardRate, setStandardRate] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [hasTransport, setHasTransport] = useState(false);

  const addMutation = trpc.emergencyHotel.addHotel.useMutation({
    onSuccess: data => {
      toast.success(
        t("emergencyHotel.hotelAdded", "Hotel '{{name}}' added successfully", {
          name: data?.name ?? name,
        })
      );
      resetForm();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setName("");
    setAirportId("");
    setAddress("");
    setPhone("");
    setEmail("");
    setStarRating("4");
    setStandardRate("");
    setDistanceKm("");
    setHasTransport(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !name ||
      !airportId ||
      !address ||
      !phone ||
      !email ||
      !standardRate ||
      !distanceKm
    ) {
      toast.error(
        t("emergencyHotel.fillRequired", "Please fill in all required fields")
      );
      return;
    }

    addMutation.mutate({
      name,
      airportId: parseInt(airportId),
      address,
      phone,
      email,
      starRating: parseInt(starRating),
      standardRate: Math.round(parseFloat(standardRate) * 100),
      distanceKm: parseFloat(distanceKm),
      hasTransport,
    });
  };

  return (
    <Card className="shadow-sm rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Plus className="h-5 w-5" />
          {t("emergencyHotel.addNewHotel", "Add New Contracted Hotel")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Hotel Details */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("emergencyHotel.hotelNameLabel", "Hotel Name")} *
              </label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t(
                  "emergencyHotel.hotelNamePlaceholder",
                  "e.g. Riyadh Airport Hotel"
                )}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("emergencyHotel.airportId", "Airport ID")} *
              </label>
              <Input
                type="number"
                value={airportId}
                onChange={e => setAirportId(e.target.value)}
                placeholder={t(
                  "emergencyHotel.airportIdPlaceholder",
                  "e.g. 1 (for RUH)"
                )}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t("emergencyHotel.addressLabel", "Address")} *
            </label>
            <Input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder={t(
                "emergencyHotel.addressPlaceholder",
                "Full hotel address"
              )}
              required
            />
          </div>

          {/* Contact */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("emergencyHotel.phoneLabel", "Phone")} *
              </label>
              <Input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+966-XX-XXX-XXXX"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("emergencyHotel.emailLabel", "Email")} *
              </label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="reservations@hotel.com"
                required
              />
            </div>
          </div>

          {/* Rating, Rate, Distance */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("emergencyHotel.starRatingLabel", "Star Rating")} *
              </label>
              <Input
                type="number"
                min="1"
                max="5"
                value={starRating}
                onChange={e => setStarRating(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("emergencyHotel.nightlyRateLabel", "Nightly Rate (SAR)")} *
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={standardRate}
                onChange={e => setStandardRate(e.target.value)}
                placeholder={t(
                  "emergencyHotel.nightlyRatePlaceholder",
                  "e.g. 450.00"
                )}
                required
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  "emergencyHotel.rateHint",
                  "Enter amount in SAR (will be stored as cents internally)"
                )}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t(
                  "emergencyHotel.distanceLabel",
                  "Distance from Airport (km)"
                )}{" "}
                *
              </label>
              <Input
                type="number"
                min="0"
                step="0.1"
                value={distanceKm}
                onChange={e => setDistanceKm(e.target.value)}
                placeholder="e.g. 2.5"
                required
              />
            </div>
          </div>

          {/* Transport */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="hasTransport"
              checked={hasTransport}
              onChange={e => setHasTransport(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="hasTransport" className="text-sm font-medium">
              {t(
                "emergencyHotel.hasTransportLabel",
                "Hotel provides airport shuttle / transport"
              )}
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button type="submit" disabled={addMutation.isPending}>
              <Plus className="me-2 h-4 w-4" />
              {addMutation.isPending
                ? t("emergencyHotel.adding", "Adding...")
                : t("emergencyHotel.addHotel", "Add Hotel")}
            </Button>
            <Button type="button" variant="outline" onClick={resetForm}>
              {t("emergencyHotel.reset", "Reset")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function EmergencyHotelManagement() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("bookings");

  if (authLoading) {
    return (
      <div className="container mx-auto max-w-7xl space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return <Redirect to="/" />;
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <SEO
        title={t("emergencyHotel.title", "Emergency Hotel Management")}
        description={t(
          "emergencyHotel.description",
          "Manage emergency hotel accommodations for disrupted passengers"
        )}
      />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          <Building className="me-2 inline h-6 w-6" />
          {t("emergencyHotel.title", "Emergency Hotel Management")}
        </h1>
        <p className="text-muted-foreground">
          {t(
            "emergencyHotel.subtitle",
            "IROPS hotel accommodation for disrupted flights - bookings, contracted hotels, and cost analysis"
          )}
        </p>
      </div>

      {/* Summary Cards */}
      <SummaryCards />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="bookings" className="gap-2">
            <Bed className="h-4 w-4" />
            {t("emergencyHotel.bookings", "Bookings")}
          </TabsTrigger>
          <TabsTrigger value="hotels" className="gap-2">
            <Building className="h-4 w-4" />
            {t("emergencyHotel.hotels", "Hotels")}
          </TabsTrigger>
          <TabsTrigger value="costs" className="gap-2">
            <DollarSign className="h-4 w-4" />
            {t("emergencyHotel.costs", "Costs")}
          </TabsTrigger>
          <TabsTrigger value="add-hotel" className="gap-2">
            <Plus className="h-4 w-4" />
            {t("emergencyHotel.addHotelTab", "Add Hotel")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bookings" className="mt-4">
          <BookingsTab />
        </TabsContent>

        <TabsContent value="hotels" className="mt-4">
          <HotelsTab />
        </TabsContent>

        <TabsContent value="costs" className="mt-4">
          <CostsTab />
        </TabsContent>

        <TabsContent value="add-hotel" className="mt-4">
          <AddHotelTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
