import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
import { SplitRefundCancellation } from "./SplitRefundCancellation";

interface CancelBookingDialogProps {
  bookingId: number;
  bookingReference: string;
  totalAmount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}
type Outputs = inferRouterOutputs<AppRouter>["refunds"];
type RefundReceipt = Outputs["create"] & { bookingId: number };

export function CancelBookingDialog({
  bookingId,
  bookingReference,
  open,
  onOpenChange,
  onSuccess,
}: CancelBookingDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("requested_by_customer");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<RefundReceipt | null>(null);
  const [zeroReceipt, setZeroReceipt] = useState<
    Outputs["cancelWithoutRefund"] | null
  >(null);
  const [acceptedZeroQuote, setAcceptedZeroQuote] = useState<string | null>(
    null
  );
  const utils = trpc.useUtils();
  const splitCancellation = trpc.refunds.splitCancellation.useQuery(
    { bookingId },
    { enabled: open, refetchInterval: open ? 5000 : false }
  );
  const single = open && splitCancellation.data?.splitFunded === false;
  const savedReceipt = trpc.refunds.cancellationReceipt.useQuery(
    { bookingId },
    { enabled: single }
  );
  const currentZeroReceipt =
    zeroReceipt?.bookingId === bookingId ? zeroReceipt : savedReceipt.data;
  const currentReceipt = receipt?.bookingId === bookingId ? receipt : null;
  const refundCheck = trpc.refunds.checkRefundable.useQuery(
    { bookingId },
    { enabled: single && !currentZeroReceipt }
  );
  const canCancel =
    refundCheck.data?.cancellable ?? refundCheck.data?.refundable ?? false;
  const feeQuery = trpc.refunds.calculateCancellationFee.useQuery(
    { bookingId },
    { enabled: single && canCancel && !currentZeroReceipt }
  );
  const cancellationFee = feeQuery.data;
  const zeroRefund = cancellationFee?.refundAmount === 0;
  const zeroAccepted = Boolean(
    cancellationFee?.quoteHash &&
    acceptedZeroQuote === cancellationFee.quoteHash
  );
  const refreshAfterSuccess = () => {
    setAcceptedZeroQuote(null);
    void utils.bookings.myBookings.invalidate();
    void savedReceipt.refetch();
    onSuccess();
  };
  const createRefund = trpc.refunds.create.useMutation({
    onSuccess: (result, input) => {
      setReceipt({ ...result, bookingId: input.bookingId });
      toast.success(t("cancelBooking.receipt.recorded"));
      refreshAfterSuccess();
    },
    onError: error => {
      toast.error(error.message || t("cancelBooking.errorMessage"));
      void feeQuery.refetch();
    },
  });
  const cancelWithoutRefund = trpc.refunds.cancelWithoutRefund.useMutation({
    onSuccess: result => {
      setZeroReceipt(result);
      toast.success(t("cancelBooking.noRefund.recorded"));
      refreshAfterSuccess();
    },
    onError: error => {
      setAcceptedZeroQuote(null);
      toast.error(error.message || t("cancelBooking.errorMessage"));
      void feeQuery.refetch();
      void refundCheck.refetch();
    },
  });
  const pending = createRefund.isPending || cancelWithoutRefund.isPending;
  const handleCancel = () => {
    if (!canCancel || !cancellationFee || feeQuery.isFetching) return;
    if (zeroRefund) {
      if (!zeroAccepted) return;
      cancelWithoutRefund.mutate({
        bookingId,
        quoteHash: cancellationFee.quoteHash,
        confirmNoRefund: true,
        reason,
        notes,
      });
    } else {
      createRefund.mutate({
        bookingId,
        reason,
        ...(cancellationFee.quoteHash
          ? { quoteHash: cancellationFee.quoteHash }
          : {}),
      });
    }
  };
  const setOpen = (next: boolean) => {
    if (!next) setAcceptedZeroQuote(null);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("cancelBooking.title")}</DialogTitle>
          <DialogDescription>
            {t("cancelBooking.bookingRef", { ref: bookingReference })}
          </DialogDescription>
        </DialogHeader>
        {currentZeroReceipt || currentReceipt ? (
          <>
            <section
              aria-labelledby="refund-receipt-title"
              className="space-y-4 py-4"
            >
              <h3 id="refund-receipt-title" className="font-semibold">
                {t(
                  currentZeroReceipt
                    ? "cancelBooking.noRefund.receiptTitle"
                    : "cancelBooking.receipt.title"
                )}
              </h3>
              <p role="status">
                {currentZeroReceipt
                  ? t("cancelBooking.noRefund.recorded")
                  : t(
                      `cancelBooking.receipt.state.${currentReceipt?.status ?? "unknown"}`,
                      { defaultValue: t("cancelBooking.receipt.state.unknown") }
                    )}
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt>
                  {t(
                    currentZeroReceipt
                      ? "cancelBooking.receipt.cancellationReference"
                      : "cancelBooking.receipt.reference"
                  )}
                </dt>
                <dd className="break-all">
                  <bdi>
                    {currentZeroReceipt?.cancellationId ??
                      currentReceipt?.refundId}
                  </bdi>
                </dd>
                {currentZeroReceipt && (
                  <>
                    <dt>{t("cancelBooking.originalAmount")}</dt>
                    <dd>
                      {(currentZeroReceipt.totalAmount / 100).toFixed(2)}{" "}
                      {t("common.sar")}
                    </dd>
                    <dt>{t("cancelBooking.split.retainedFee")}</dt>
                    <dd>
                      {(currentZeroReceipt.cancellationFee / 100).toFixed(2)}{" "}
                      {t("common.sar")}
                    </dd>
                  </>
                )}
                <dt>{t("cancelBooking.refundAmount")}</dt>
                <dd>
                  {(
                    (currentZeroReceipt?.refundAmount ??
                      currentReceipt?.amount ??
                      0) / 100
                  ).toFixed(2)}{" "}
                  {t("common.sar")}
                </dd>
              </dl>
              {currentZeroReceipt && (
                <p className="text-sm">
                  {t("cancelBooking.noRefund.receiptExplanation")}
                </p>
              )}
            </section>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>
                {t("cancelBooking.receipt.close")}
              </Button>
            </DialogFooter>
          </>
        ) : splitCancellation.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : splitCancellation.isError ? (
          <p role="alert">{splitCancellation.error.message}</p>
        ) : splitCancellation.data?.splitFunded ? (
          <SplitRefundCancellation
            bookingId={bookingId}
            data={splitCancellation.data}
            onRefresh={() => {
              void splitCancellation.refetch();
              void utils.bookings.myBookings.invalidate();
            }}
          />
        ) : (
          <>
            {refundCheck.isLoading || savedReceipt.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : !canCancel ? (
              <div role="alert" className="py-4 space-y-2">
                <p className="font-medium text-destructive">
                  {t("cancelBooking.notCancellable")}
                </p>
                <p className="text-sm">
                  {refundCheck.data?.reason ??
                    refundCheck.error?.message ??
                    t("cancelBooking.notCancellableDefault")}
                </p>
              </div>
            ) : (
              <div className="space-y-4 py-4">
                {cancellationFee ? (
                  <div className="p-4 border rounded-lg space-y-3">
                    <p className="font-semibold text-sm">
                      {zeroRefund
                        ? t("cancelBooking.noRefund.heading")
                        : cancellationFee.tier === "full"
                          ? t("cancelBooking.fullRefund")
                          : t("cancelBooking.partialRefund", {
                              percentage: cancellationFee.refundPercentage,
                            })}
                    </p>
                    {zeroRefund && (
                      <p className="text-sm">
                        {t(
                          cancellationFee.policyReason === "nonrefundable_fare"
                            ? "cancelBooking.noRefund.fareExplanation"
                            : "cancelBooking.noRefund.explanation"
                        )}
                      </p>
                    )}
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <dt>{t("cancelBooking.originalAmount")}</dt>
                      <dd>
                        {(cancellationFee.totalAmount / 100).toFixed(2)}{" "}
                        {t("common.sar")}
                      </dd>
                      {cancellationFee.cancellationFee > 0 && (
                        <>
                          <dt>
                            {t("cancelBooking.cancellationFee", {
                              percentage:
                                100 - cancellationFee.refundPercentage,
                            })}
                          </dt>
                          <dd>
                            -
                            {(cancellationFee.cancellationFee / 100).toFixed(2)}{" "}
                            {t("common.sar")}
                          </dd>
                        </>
                      )}
                      <dt className="font-semibold">
                        {t("cancelBooking.refundAmount")}
                      </dt>
                      <dd className="font-bold">
                        {(cancellationFee.refundAmount / 100).toFixed(2)}{" "}
                        {t("common.sar")}
                      </dd>
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        zeroRefund
                          ? "cancelBooking.noRefund.explanation"
                          : "cancelBooking.refundProcessing"
                      )}
                    </p>
                  </div>
                ) : feeQuery.isError ? (
                  <p role="alert">{feeQuery.error.message}</p>
                ) : (
                  <p role="status">{t("cancelBooking.loadingQuote")}</p>
                )}
                <div className="space-y-2">
                  <Label>{t("cancelBooking.reasonLabel")}</Label>
                  <RadioGroup value={reason} onValueChange={setReason}>
                    {[
                      ["requested_by_customer", "reasonChangeOfPlans"],
                      ["duplicate", "reasonDuplicate"],
                      ["other", "reasonOther"],
                    ].map(([value, label]) => (
                      <div key={value} className="flex items-center gap-2">
                        <RadioGroupItem value={value} id={value} />
                        <Label htmlFor={value}>
                          {t(`cancelBooking.${label}`)}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">
                    {t("cancelBooking.additionalNotes")}
                  </Label>
                  <Textarea
                    id="notes"
                    maxLength={500}
                    placeholder={t("cancelBooking.notesPlaceholder")}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-800">
                    {t(
                      zeroRefund
                        ? "cancelBooking.noRefund.warning"
                        : "cancelBooking.warningMessage"
                    )}
                  </p>
                </div>
                {zeroRefund && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={zeroAccepted}
                      disabled={pending}
                      onChange={e =>
                        setAcceptedZeroQuote(
                          e.target.checked
                            ? (cancellationFee?.quoteHash ?? null)
                            : null
                        )
                      }
                    />
                    <span>{t("cancelBooking.noRefund.acknowledgment")}</span>
                  </label>
                )}
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                {t("common.cancel")}
              </Button>
              {canCancel && (
                <Button
                  variant="destructive"
                  onClick={handleCancel}
                  disabled={
                    pending ||
                    !cancellationFee ||
                    feeQuery.isFetching ||
                    feeQuery.isError ||
                    (zeroRefund && !zeroAccepted)
                  }
                >
                  {pending ? (
                    <>
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      {t("cancelBooking.processing")}
                    </>
                  ) : (
                    t("cancelBooking.confirmCancel")
                  )}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
