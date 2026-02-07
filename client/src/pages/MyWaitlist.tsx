/**
 * MyWaitlist Page
 * Displays user's waitlist entries and allows managing them
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import {
  ChevronLeft,
  Clock,
  Plane,
  Calendar,
  MapPin,
  Users,
  Search,
  Ticket,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Timer,
  Loader2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { toast } from "sonner";

type WaitlistStatus =
  | "waiting"
  | "offered"
  | "confirmed"
  | "expired"
  | "cancelled";

export default function MyWaitlist() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const dateLocale = isRTL ? ar : enUS;

  const { isAuthenticated, loading: authLoading } = useAuth();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<any>(null);

  const {
    data: waitlistEntries,
    isLoading,
    refetch,
  } = trpc.waitlist.myWaitlist.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const cancelEntry = trpc.waitlist.cancel.useMutation({
    onSuccess: () => {
      toast.success(t("waitlist.cancelSuccess"));
      setCancelDialogOpen(false);
      setSelectedEntry(null);
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const acceptOffer = trpc.waitlist.acceptOffer.useMutation({
    onSuccess: data => {
      toast.success(t("waitlist.offerAccepted"));
      // Redirect to booking page
      window.location.href = `/booking/${data.flightId}?class=${data.cabinClass}&passengers=${data.passengers}&fromWaitlist=true`;
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const declineOffer = trpc.waitlist.declineOffer.useMutation({
    onSuccess: () => {
      toast.success(t("waitlist.offerDeclined"));
      setDeclineDialogOpen(false);
      setSelectedEntry(null);
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const getStatusBadgeStyle = (status: WaitlistStatus) => {
    const styles: Record<WaitlistStatus, string> = {
      waiting:
        "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
      offered:
        "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
      confirmed:
        "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
      expired:
        "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
      cancelled:
        "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
    };
    return styles[status] || styles.waiting;
  };

  const getStatusIcon = (status: WaitlistStatus) => {
    const icons: Record<WaitlistStatus, React.ReactNode> = {
      waiting: <Clock className="h-4 w-4" />,
      offered: <AlertCircle className="h-4 w-4" />,
      confirmed: <CheckCircle2 className="h-4 w-4" />,
      expired: <Timer className="h-4 w-4" />,
      cancelled: <XCircle className="h-4 w-4" />,
    };
    return icons[status] || icons.waiting;
  };

  // Loading Skeleton
  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950">
        <SEO title={t("waitlist.myWaitlist")} />
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
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-48 w-full rounded-xl" />
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
        <SEO title={t("waitlist.myWaitlist")} />
        <Card className="p-8 text-center max-w-md shadow-xl border-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <Clock className="h-8 w-8 text-white" />
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
            <a href="/login">{t("common.login")}</a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950">
      <SEO
        title={t("waitlist.myWaitlist")}
        description={t("waitlist.myWaitlistSubtitle")}
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
                {t("waitlist.myWaitlist")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("waitlist.myWaitlistSubtitle")}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="container py-8">
        {/* Empty State */}
        {!waitlistEntries || waitlistEntries.length === 0 ? (
          <Empty className="border-2 border-dashed border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 rounded-2xl py-16">
            <EmptyMedia>
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 flex items-center justify-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                  <Clock className="h-8 w-8 text-white" />
                </div>
              </div>
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>{t("waitlist.noWaitlistEntries")}</EmptyTitle>
              <EmptyDescription>
                {t("waitlist.noWaitlistDesc")}
                <br />
                <span className="text-slate-500">
                  {t("waitlist.noWaitlistHint")}
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
        ) : (
          <div className="space-y-4">
            {waitlistEntries.map((entry: any) => {
              const isOffered = entry.status === "offered";
              const offerExpiring =
                isOffered &&
                entry.offerExpiresAt &&
                new Date(entry.offerExpiresAt) > new Date();

              return (
                <Card
                  key={entry.id}
                  className={`overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300 bg-white dark:bg-slate-900 ${
                    isOffered ? "ring-2 ring-amber-400" : ""
                  }`}
                >
                  {/* Status gradient bar at top */}
                  <div
                    className={`h-1 ${
                      entry.status === "waiting"
                        ? "bg-gradient-to-r from-blue-400 to-blue-600"
                        : entry.status === "offered"
                          ? "bg-gradient-to-r from-amber-400 to-amber-600"
                          : entry.status === "confirmed"
                            ? "bg-gradient-to-r from-emerald-400 to-emerald-600"
                            : "bg-gradient-to-r from-slate-400 to-slate-600"
                    }`}
                  />

                  {/* Urgent offer notification */}
                  {isOffered && offerExpiring && (
                    <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 px-6 py-3">
                      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                        <AlertCircle className="h-5 w-5" />
                        <span className="font-medium">
                          {t("waitlist.seatAvailable")}
                        </span>
                        <span className="text-sm">
                          -{" "}
                          {t("waitlist.offerExpires", {
                            time: formatDistanceToNow(
                              new Date(entry.offerExpiresAt),
                              { locale: dateLocale, addSuffix: true }
                            ),
                          })}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="p-6">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      {/* Flight Info */}
                      <div className="lg:col-span-8">
                        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                          <div>
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                              <div className="flex items-center gap-2">
                                {entry.airlineLogo ? (
                                  <img
                                    src={entry.airlineLogo}
                                    alt={entry.airlineName}
                                    className="h-8 w-8 object-contain rounded"
                                  />
                                ) : (
                                  <Plane className="h-5 w-5 text-primary" />
                                )}
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                  {entry.flightNumber}
                                </h3>
                              </div>
                              <Badge
                                className={`${getStatusBadgeStyle(entry.status)} border px-3 py-1 font-medium flex items-center gap-1`}
                              >
                                {getStatusIcon(entry.status)}
                                {t(`waitlist.status.${entry.status}`)}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {entry.airlineName}
                            </p>
                          </div>
                          {entry.status === "waiting" && (
                            <div className="text-end">
                              <p className="text-xs text-muted-foreground">
                                {t("waitlist.position")}
                              </p>
                              <p className="text-2xl font-bold text-primary">
                                #{entry.priority}
                              </p>
                            </div>
                          )}
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
                                  {entry.originCode} - {entry.originCity}
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
                                  {entry.destinationCode} -{" "}
                                  {entry.destinationCity}
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
                                    new Date(entry.departureTime),
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
                                  {t("booking.passengers")}
                                </p>
                                <p className="font-semibold text-slate-900 dark:text-white">
                                  {entry.seats}{" "}
                                  {entry.seats === 1
                                    ? t("waitlist.passenger")
                                    : t("waitlist.passengers")}
                                  <span className="text-sm font-normal text-muted-foreground ml-2">
                                    ({t(`cabin.${entry.cabinClass}`)})
                                  </span>
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="lg:col-span-4 flex flex-col justify-between">
                        <div className="text-center lg:text-end mb-4 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-xl">
                          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                            {t("waitlist.joinedOn")}
                          </p>
                          <p className="font-medium">
                            {format(new Date(entry.createdAt), "PPP", {
                              locale: dateLocale,
                            })}
                          </p>
                        </div>

                        <div className="flex flex-col gap-2">
                          {/* Accept/Decline buttons for offered status */}
                          {entry.status === "offered" && (
                            <>
                              <Button
                                className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-md"
                                onClick={() =>
                                  acceptOffer.mutate({ waitlistId: entry.id })
                                }
                                disabled={acceptOffer.isPending}
                              >
                                {acceptOffer.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                  <Ticket className="h-4 w-4 mr-2" />
                                )}
                                {t("waitlist.acceptOffer")}
                              </Button>
                              <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => {
                                  setSelectedEntry(entry);
                                  setDeclineDialogOpen(true);
                                }}
                              >
                                <XCircle className="h-4 w-4 mr-2" />
                                {t("waitlist.declineOffer")}
                              </Button>
                            </>
                          )}

                          {/* Cancel button for waiting status */}
                          {entry.status === "waiting" && (
                            <Button
                              variant="outline"
                              className="w-full hover:bg-red-50 hover:text-red-700 hover:border-red-200 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                              onClick={() => {
                                setSelectedEntry(entry);
                                setCancelDialogOpen(true);
                              }}
                            >
                              <XCircle className="h-4 w-4 mr-2" />
                              {t("waitlist.leaveWaitlist")}
                            </Button>
                          )}

                          {/* Info for confirmed status */}
                          {entry.status === "confirmed" && (
                            <Button asChild className="w-full">
                              <Link href="/my-bookings">
                                <Ticket className="h-4 w-4 mr-2" />
                                {t("waitlist.viewBooking")}
                              </Link>
                            </Button>
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

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("waitlist.confirmLeave")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("waitlist.confirmLeaveDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedEntry) {
                  cancelEntry.mutate({ waitlistId: selectedEntry.id });
                }
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              {cancelEntry.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t("waitlist.leaveWaitlist")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Decline Offer Confirmation Dialog */}
      <AlertDialog open={declineDialogOpen} onOpenChange={setDeclineDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("waitlist.confirmDecline")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("waitlist.confirmDeclineDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedEntry) {
                  declineOffer.mutate({ waitlistId: selectedEntry.id });
                }
              }}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {declineOffer.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t("waitlist.declineOffer")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
