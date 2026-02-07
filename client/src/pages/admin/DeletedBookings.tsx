import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import {
  ArrowLeft,
  Trash2,
  RotateCcw,
  AlertTriangle,
  Archive,
  Plane,
} from "lucide-react";

export default function DeletedBookings() {
  const { t } = useTranslation();
  const [purging, setPurging] = useState(false);
  const [retentionDays, setRetentionDays] = useState(90);

  const {
    data: deletedBookings,
    isLoading,
    refetch,
  } = trpc.softDelete.getDeletedBookings.useQuery({ limit: 50 });
  const { data: deletedCount } = trpc.softDelete.getDeletedCount.useQuery();

  const restoreMutation = trpc.softDelete.restoreBooking.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const purgeMutation = trpc.softDelete.purgeDeleted.useMutation({
    onSuccess: data => {
      setPurging(false);
      refetch();
      alert(
        t(
          "deletedBookings.purgeSuccess",
          `Permanently deleted ${data.purgedCount} bookings`
        )
      );
    },
    onError: () => {
      setPurging(false);
    },
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <button className="p-2 rounded-lg hover:bg-white/50 dark:hover:bg-slate-700 transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">
                {t("deletedBookings.title", "Deleted Bookings")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t(
                  "deletedBookings.subtitle",
                  "Manage soft-deleted bookings and data recovery"
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-3 py-1.5 rounded-full text-sm font-medium">
              <Trash2 className="w-4 h-4 inline mr-1" />
              {deletedCount ?? 0} {t("deletedBookings.deleted", "deleted")}
            </span>
          </div>
        </div>

        {/* Purge Section */}
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-amber-800 dark:text-amber-300">
                {t("deletedBookings.purgeTitle", "Permanent Deletion")}
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                {t(
                  "deletedBookings.purgeDescription",
                  "Permanently remove bookings that have been in the trash for longer than the retention period. This action cannot be undone."
                )}
              </p>
              <div className="flex items-center gap-3 mt-3">
                <label className="text-sm text-amber-700 dark:text-amber-400">
                  {t("deletedBookings.retentionDays", "Retention (days)")}:
                </label>
                <input
                  type="number"
                  min={30}
                  max={365}
                  value={retentionDays}
                  onChange={e => setRetentionDays(Number(e.target.value))}
                  className="w-20 px-2 py-1 rounded border text-sm"
                />
                <button
                  onClick={() => {
                    if (
                      confirm(
                        t(
                          "deletedBookings.purgeConfirm",
                          "Are you sure? This will permanently delete old bookings."
                        )
                      )
                    ) {
                      setPurging(true);
                      purgeMutation.mutate({ retentionDays });
                    }
                  }}
                  disabled={purging}
                  className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
                >
                  {purging
                    ? t("common.loading", "Loading...")
                    : t("deletedBookings.purgeButton", "Purge Old Bookings")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Deleted Bookings Table */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              {t("common.loading", "Loading...")}
            </div>
          ) : !deletedBookings || deletedBookings.length === 0 ? (
            <div className="p-8 text-center">
              <Archive className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">
                {t("deletedBookings.noDeleted", "No deleted bookings found")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-4 text-xs font-medium text-muted-foreground uppercase">
                      {t("deletedBookings.booking", "Booking")}
                    </th>
                    <th className="text-left p-4 text-xs font-medium text-muted-foreground uppercase">
                      {t("deletedBookings.flight", "Flight")}
                    </th>
                    <th className="text-left p-4 text-xs font-medium text-muted-foreground uppercase">
                      {t("deletedBookings.amount", "Amount")}
                    </th>
                    <th className="text-left p-4 text-xs font-medium text-muted-foreground uppercase">
                      {t("deletedBookings.status", "Status")}
                    </th>
                    <th className="text-left p-4 text-xs font-medium text-muted-foreground uppercase">
                      {t("deletedBookings.deletedOn", "Deleted On")}
                    </th>
                    <th className="text-left p-4 text-xs font-medium text-muted-foreground uppercase">
                      {t("deletedBookings.actions", "Actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {deletedBookings.map(booking => (
                    <tr
                      key={booking.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="p-4">
                        <div className="font-mono text-sm font-medium">
                          {booking.bookingReference}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          PNR: {booking.pnr}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Plane className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium text-sm">
                              {booking.flightNumber}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {booking.origin} → {booking.destination}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-semibold text-sm">
                          {(booking.totalAmount / 100).toFixed(2)}{" "}
                          {t("common.sar")}
                        </div>
                        <div className="text-xs text-muted-foreground capitalize">
                          {booking.cabinClass} &middot;{" "}
                          {booking.numberOfPassengers} pax
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600">
                          {booking.status}
                        </span>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {booking.deletedAt
                          ? new Date(booking.deletedAt).toLocaleDateString(
                              "en-US",
                              {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              }
                            )
                          : "-"}
                      </td>
                      <td className="p-4">
                        <button
                          onClick={() =>
                            restoreMutation.mutate({
                              bookingId: booking.id,
                            })
                          }
                          disabled={restoreMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-lg text-sm hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {t("deletedBookings.restore", "Restore")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
