import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { toast } from "sonner";

type Data = inferRouterOutputs<AppRouter>["refunds"]["splitCancellation"];
export function SplitRefundCancellation({
  bookingId,
  data,
  onRefresh,
}: {
  bookingId: number;
  data: Data;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState<"requested_by_customer" | "duplicate">(
    "requested_by_customer"
  );
  const cancel = trpc.refunds.cancelSplitBooking.useMutation({
    onSuccess: () => {
      toast.success(t("cancelBooking.split.reserved"));
      onRefresh();
    },
    onError: error => {
      toast.error(error.message);
      onRefresh();
    },
  });
  const resume = trpc.refunds.resumeSplitCancellation.useMutation({
    onSuccess: onRefresh,
    onError: error => {
      toast.error(error.message);
      onRefresh();
    },
  });
  const summary = data.plan ?? data.quote;
  if (!summary)
    return (
      <p role="alert">{data.reason ?? t("cancelBooking.notCancellable")}</p>
    );
  return (
    <div className="space-y-4 overflow-y-auto max-h-[70vh]">
      <p className="text-sm">{t("cancelBooking.split.originalPayers")}</p>
      {data.plan && (
        <p role="status" className="font-medium">
          {t(`cancelBooking.split.plan.${data.plan.status}`)}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>{t("cancelBooking.originalAmount")}</dt>
        <dd>
          {(summary.totalAmount / 100).toFixed(2)} {t("common.sar")}
        </dd>
        <dt>{t("cancelBooking.split.retainedFee")}</dt>
        <dd>
          {(summary.cancellationFee / 100).toFixed(2)} {t("common.sar")}
        </dd>
        <dt>{t("cancelBooking.refundAmount")}</dt>
        <dd className="font-bold">
          {(summary.refundAmount / 100).toFixed(2)} {t("common.sar")}
        </dd>
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-start">
          <caption className="sr-only">
            {t("cancelBooking.split.allocations")}
          </caption>
          <thead>
            <tr>
              <th className="p-2 text-start">
                {t("cancelBooking.split.payer")}
              </th>
              <th className="p-2 text-start">
                {t("cancelBooking.split.paid")}
              </th>
              <th className="p-2 text-start">
                {t("cancelBooking.split.refund")}
              </th>
              {data.plan && (
                <th className="p-2 text-start">
                  {t("cancelBooking.split.status")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {summary.items.map(item => {
              const progress = data.plan?.items.find(
                i => i.splitId === item.splitId
              );
              const canResume =
                progress &&
                (["queued", "requesting", "pending"].includes(
                  progress.status
                ) ||
                  progress.errorCode === "unknown_provider_outcome");
              return (
                <tr key={item.splitId} className="border-t">
                  <td className="p-2">{item.payerName}</td>
                  <td className="p-2">{(item.paidAmount / 100).toFixed(2)}</td>
                  <td className="p-2">
                    {(item.refundAmount / 100).toFixed(2)}
                  </td>
                  {progress && (
                    <td className="p-2">
                      <span>
                        {t(`cancelBooking.split.item.${progress.status}`)}
                      </span>
                      {progress.errorCode === "provider_action_required" && (
                        <p>{t("cancelBooking.split.actionRequired")}</p>
                      )}
                      {canResume && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resume.isPending}
                          onClick={() =>
                            resume.mutate({ bookingId, splitId: item.splitId })
                          }
                        >
                          {t("cancelBooking.split.resume")}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.quote && (
        <>
          <Label htmlFor="split-refund-reason">
            {t("cancelBooking.reasonLabel")}
          </Label>
          <select
            id="split-refund-reason"
            value={reason}
            onChange={e => setReason(e.target.value as typeof reason)}
            className="w-full rounded border p-2"
          >
            <option value="requested_by_customer">
              {t("cancelBooking.reasonChangeOfPlans")}
            </option>
            <option value="duplicate">
              {t("cancelBooking.reasonDuplicate")}
            </option>
          </select>
          <Label htmlFor="split-refund-notes">
            {t("cancelBooking.additionalNotes")}
          </Label>
          <Textarea
            id="split-refund-notes"
            maxLength={500}
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          <p className="text-sm text-amber-700">
            {t("cancelBooking.warningMessage")}
          </p>
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() =>
              cancel.mutate({
                bookingId,
                quoteHash: data.quote!.quoteHash,
                reason,
                notes,
              })
            }
          >
            {t(
              cancel.isPending
                ? "cancelBooking.processing"
                : "cancelBooking.confirmCancel"
            )}
          </Button>
        </>
      )}
    </div>
  );
}
