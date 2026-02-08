import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import {
  ArrowLeft,
  CreditCard,
  CheckCircle,
  XCircle,
  Clock,
  RotateCcw,
  Plane,
  Filter,
} from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { icon: typeof CheckCircle; color: string; label: string }
  > = {
    completed: {
      icon: CheckCircle,
      color: "text-green-600 bg-green-50",
      label: "Completed",
    },
    pending: {
      icon: Clock,
      color: "text-yellow-600 bg-yellow-50",
      label: "Pending",
    },
    failed: { icon: XCircle, color: "text-red-600 bg-red-50", label: "Failed" },
    refunded: {
      icon: RotateCcw,
      color: "text-blue-600 bg-blue-50",
      label: "Refunded",
    },
  };

  const { icon: Icon, color, label } = config[status] || config.pending;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${color}`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

export default function PaymentHistory() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [methodFilter, setMethodFilter] = useState<string>("");

  const { data: payments, isLoading } = trpc.payments.getHistory.useQuery({
    status: statusFilter || undefined,
    method: methodFilter || undefined,
    limit: 50,
  });

  const { data: stats } = trpc.payments.getStats.useQuery();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/profile">
            <button
              className="p-2 rounded-lg hover:bg-white/50 dark:hover:bg-slate-700 transition-colors"
              aria-label={t("common.back")}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">
              {t("paymentHistory.title", "Payment History")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t(
                "paymentHistory.subtitle",
                "View all your payment transactions"
              )}
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <CreditCard className="w-4 h-4" />
                {t("paymentHistory.totalPayments", "Total Payments")}
              </div>
              <div className="text-2xl font-bold">{stats.totalPayments}</div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border">
              <div className="flex items-center gap-2 text-green-600 text-sm mb-1">
                <CheckCircle className="w-4 h-4" />
                {t("paymentHistory.completed", "Completed")}
              </div>
              <div className="text-2xl font-bold text-green-600">
                {(stats.completedAmount / 100).toFixed(2)} SAR
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border">
              <div className="flex items-center gap-2 text-blue-600 text-sm mb-1">
                <RotateCcw className="w-4 h-4" />
                {t("paymentHistory.refunded", "Refunded")}
              </div>
              <div className="text-2xl font-bold text-blue-600">
                {(stats.refundedAmount / 100).toFixed(2)} SAR
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border">
              <div className="flex items-center gap-2 text-yellow-600 text-sm mb-1">
                <Clock className="w-4 h-4" />
                {t("paymentHistory.pending", "Pending")}
              </div>
              <div className="text-2xl font-bold text-yellow-600">
                {stats.pendingCount}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {t("paymentHistory.filters", "Filters")}
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-background text-sm"
            >
              <option value="">
                {t("paymentHistory.allStatuses", "All Statuses")}
              </option>
              <option value="completed">
                {t("paymentHistory.completed", "Completed")}
              </option>
              <option value="pending">
                {t("paymentHistory.pending", "Pending")}
              </option>
              <option value="refunded">
                {t("paymentHistory.refunded", "Refunded")}
              </option>
              <option value="failed">
                {t("paymentHistory.failed", "Failed")}
              </option>
            </select>
            <select
              value={methodFilter}
              onChange={e => setMethodFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border bg-background text-sm"
            >
              <option value="">
                {t("paymentHistory.allMethods", "All Methods")}
              </option>
              <option value="card">{t("paymentHistory.card", "Card")}</option>
              <option value="wallet">
                {t("paymentHistory.wallet", "Wallet")}
              </option>
              <option value="bank_transfer">
                {t("paymentHistory.bankTransfer", "Bank Transfer")}
              </option>
            </select>
          </div>
        </div>

        {/* Payment List */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              {t("common.loading", "Loading...")}
            </div>
          ) : !payments || payments.length === 0 ? (
            <div className="p-8 text-center">
              <CreditCard className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">
                {t("paymentHistory.noPayments", "No payments found")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-start p-4 text-xs font-medium text-muted-foreground uppercase">
                      {t("paymentHistory.flight", "Flight")}
                    </th>
                    <th className="text-start p-4 text-xs font-medium text-muted-foreground uppercase">
                      {t("paymentHistory.booking", "Booking")}
                    </th>
                    <th className="text-start p-4 text-xs font-medium text-muted-foreground uppercase">
                      {t("paymentHistory.amount", "Amount")}
                    </th>
                    <th className="text-start p-4 text-xs font-medium text-muted-foreground uppercase">
                      {t("paymentHistory.method", "Method")}
                    </th>
                    <th className="text-start p-4 text-xs font-medium text-muted-foreground uppercase">
                      {t("paymentHistory.status", "Status")}
                    </th>
                    <th className="text-start p-4 text-xs font-medium text-muted-foreground uppercase">
                      {t("paymentHistory.date", "Date")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payments.map(payment => (
                    <tr
                      key={payment.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Plane className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium text-sm">
                              {payment.flightNumber}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {payment.origin} → {payment.destination}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-mono text-sm">
                          {payment.bookingReference}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          PNR: {payment.pnr}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-semibold text-sm">
                          {(payment.amount / 100).toFixed(2)} {payment.currency}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center gap-1 text-sm capitalize">
                          <CreditCard className="w-3 h-3" />
                          {payment.method.replace("_", " ")}
                        </span>
                      </td>
                      <td className="p-4">
                        <StatusBadge status={payment.status} />
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {new Date(payment.createdAt).toLocaleDateString(
                          "en-US",
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
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
