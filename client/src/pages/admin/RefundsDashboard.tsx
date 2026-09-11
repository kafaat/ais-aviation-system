import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SplitRefundCancellation } from "@/components/SplitRefundCancellation";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DollarSign,
  TrendingDown,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { ExportReportButton } from "@/components/ExportReportButton";

export default function RefundsDashboard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = trpc.refunds.getStats.useQuery();
  const {
    data: history,
    isLoading: historyLoading,
    isError: historyError,
    refetch: refetchHistory,
  } = trpc.refunds.getHistory.useQuery({ limit: 20 });
  const {
    data: trends,
    isError: trendsError,
    refetch: refetchTrends,
  } = trpc.refunds.getTrends.useQuery();
  const [cursor, setCursor] = useState<number>();
  const [filter, setFilter] = useState<
    "processing" | "completed" | "review_required"
  >("review_required");
  const [selected, setSelected] = useState<number | null>(null);
  const queue = trpc.refunds.splitCancellationQueue.useQuery({
    beforeBookingId: cursor,
    status: filter,
  });
  const detail = trpc.refunds.splitCancellation.useQuery(
    { bookingId: selected ?? 0 },
    {
      enabled: selected !== null,
      refetchInterval: selected !== null ? 5000 : false,
    }
  );

  if (statsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  // Default date filters for export (last 30 days)
  const exportFilters = {
    startDate: new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("admin.refunds.title")}</h1>
          <p className="text-muted-foreground">{t("admin.refunds.subtitle")}</p>
        </div>
        <ExportReportButton reportType="refunds" filters={exportFilters} />
      </div>

      {/* Statistics Cards */}
      <Card className="p-6 space-y-3">
        <h2 className="text-xl font-semibold">
          {t("cancelBooking.split.track")}
        </h2>
        <select
          aria-label={t("cancelBooking.split.status")}
          value={filter}
          onChange={e => {
            setFilter(e.target.value as typeof filter);
            setCursor(undefined);
          }}
          className="border rounded p-2 w-full"
        >
          {(["review_required", "processing", "completed"] as const).map(s => (
            <option key={s} value={s}>
              {t(`cancelBooking.split.plan.${s}`)}
            </option>
          ))}
        </select>
        {queue.isError && <p role="alert">{queue.error.message}</p>}
        {queue.data?.items.map(item => (
          <div
            className="flex flex-wrap justify-between gap-2 border-t py-2"
            key={item.bookingId}
          >
            <span>
              #{item.bookingId} — {(item.refundAmount / 100).toFixed(2)}{" "}
              {t("common.sar")}
            </span>
            <Button
              variant="outline"
              onClick={() => setSelected(item.bookingId)}
            >
              {t("cancelBooking.split.track")}
            </Button>
          </div>
        ))}
        {!queue.isLoading && queue.data?.items.length === 0 && (
          <p>{t("admin.refunds.noRefunds")}</p>
        )}
        {queue.data?.nextCursor && (
          <Button
            variant="outline"
            onClick={() => setCursor(queue.data!.nextCursor!)}
          >
            {t("cancelBooking.split.more")}
          </Button>
        )}
      </Card>
      <Dialog
        open={selected !== null}
        onOpenChange={open => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancelBooking.split.track")}</DialogTitle>
            <DialogDescription>#{selected}</DialogDescription>
          </DialogHeader>
          {detail.isError && <p role="alert">{detail.error.message}</p>}
          {detail.data && selected !== null && (
            <SplitRefundCancellation
              bookingId={selected}
              data={detail.data}
              onRefresh={() => {
                void detail.refetch();
                void queue.refetch();
                void refetchStats();
                void refetchHistory();
                void refetchTrends();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <p className="text-sm text-muted-foreground">
        {t("admin.refunds.reportingScope")}
      </p>
      {statsError && (
        <div role="alert">
          <p>{t("admin.refunds.loadError")}</p>
          <Button onClick={() => void refetchStats()}>
            {t("admin.refunds.retry")}
          </Button>
        </div>
      )}
      {stats && !statsError && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("admin.refunds.totalRefunds")}
                </p>
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-3xl font-bold">{stats.totalRefunds}</p>
              <p className="text-xs text-muted-foreground mt-2">
                {t("admin.refunds.allRefunds")}
              </p>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("admin.refunds.refundedAmount")}
                </p>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-3xl font-bold">
                {(stats.totalRefundedAmount / 100).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {t("common.sar")}
              </p>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("admin.refunds.refundedBookings")}
                </p>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              </div>
              <p className="text-3xl font-bold">{stats.refundedBookings}</p>
              <p className="text-xs text-muted-foreground mt-2">
                {t("admin.refunds.bookingCountScope")}
              </p>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("admin.refunds.refundRate")}
                </p>
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-3xl font-bold">
                {stats.refundRate.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {t("admin.refunds.ofTotalBookings")}
              </p>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-6">
              <h3>{t("admin.refunds.pendingPayers")}</h3>
              <p className="text-2xl">{stats.pendingRefunds}</p>
              <p>
                {(stats.pendingRefundAmount / 100).toFixed(2)} {t("common.sar")}
              </p>
            </Card>
            <Card className="p-6">
              <h3>{t("admin.refunds.reviewPayers")}</h3>
              <p className="text-2xl">{stats.reviewRequiredRefunds}</p>
              <p>
                {(stats.reviewRequiredAmount / 100).toFixed(2)}{" "}
                {t("common.sar")}
              </p>
            </Card>
            <Card className="p-6">
              <h3>{t("admin.refunds.retainedFees")}</h3>
              <p className="text-2xl">
                {(stats.retainedCancellationFees / 100).toFixed(2)}{" "}
                {t("common.sar")}
              </p>
            </Card>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("admin.refunds.requestScope")}
          </p>
        </>
      )}
      {trendsError && (
        <div role="alert">
          <p>{t("admin.refunds.trendsError")}</p>
          <Button onClick={() => void refetchTrends()}>
            {t("admin.refunds.retry")}
          </Button>
        </div>
      )}
      {/* Refund Trends Chart */}
      {!trendsError && trends && trends.length > 0 && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">
            {t("admin.refunds.trendsTitle")}
          </h2>
          <div className="space-y-2">
            {trends.slice(-10).map((trend, index) => (
              <div
                key={index}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className="text-sm font-medium">
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    }).format(new Date(trend.date))}
                  </div>
                  <Badge variant="secondary">
                    {trend.count} {t("admin.refunds.refund")}
                  </Badge>
                </div>
                <div className="text-sm font-semibold">
                  {(trend.amount / 100).toFixed(2)} {t("common.sar")}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Refund History Table */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">
          {t("admin.refunds.history")}
        </h2>
        {historyLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : historyError ? (
          <div role="alert">
            <p>{t("admin.refunds.historyError")}</p>
            <Button onClick={() => void refetchHistory()}>
              {t("admin.refunds.retry")}
            </Button>
          </div>
        ) : !history || history.length === 0 ? (
          <div className="text-center py-12">
            <RefreshCw className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {t("admin.refunds.noRefunds")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.refunds.bookingRef")}</TableHead>
                  <TableHead>PNR</TableHead>
                  <TableHead>{t("admin.refunds.userId")}</TableHead>
                  <TableHead>{t("admin.refunds.amount")}</TableHead>
                  <TableHead>{t("admin.refunds.status")}</TableHead>
                  <TableHead>{t("admin.refunds.refundDate")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(refund => (
                  <TableRow key={refund.id}>
                    <TableCell className="font-medium">
                      {refund.bookingReference}
                    </TableCell>
                    <TableCell>{refund.pnr}</TableCell>
                    <TableCell>{refund.userId}</TableCell>
                    <TableCell className="font-semibold">
                      {(refund.amount / 100).toFixed(2)} {t("common.sar")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {refund.status === "settled"
                          ? t("admin.refunds.statusSettled")
                          : refund.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "UTC",
                      }).format(new Date(refund.refundedAt))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
