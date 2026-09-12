import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  booking: {
    id: number;
    bookingReference: string;
    flightNumber: string;
    cabinClass: string;
    totalAmount: number;
    originName: string;
    destinationName: string;
    originId?: number;
    destinationId?: number;
  };
}
type Quote = {
  modificationId: number;
  originalAmount: number;
  newAmount: number;
  priceDifference: number;
  modificationFee: number;
  totalCost: number;
  requiresPayment: boolean;
};
export function ModifyBookingDialog({ open, onOpenChange, booking }: Props) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<"date" | "upgrade">("date");
  const [date, setDate] = useState(
    new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  );
  const [flightId, setFlightId] = useState<number | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const command = useRef<{ fingerprint: string; key: string } | null>(null);
  const search = trpc.flights.search.useQuery(
    {
      originId: booking.originId ?? 0,
      destinationId: booking.destinationId ?? 0,
      departureDate: new Date(`${date}T00:00:00Z`),
    },
    {
      enabled:
        open &&
        mode === "date" &&
        Boolean(booking.originId && booking.destinationId) &&
        /^\d{4}-\d{2}-\d{2}$/.test(date),
    }
  );
  const change = trpc.modifications.requestChangeDate.useMutation();
  const upgrade = trpc.modifications.requestUpgrade.useMutation();
  const checkout = trpc.payments.createModificationCheckout.useMutation();
  const confirm = trpc.ndc.confirmNoChargeService.useMutation();
  const cancel = trpc.ndc.cancelPaidService.useMutation();
  const request = async () => {
    setBusy(true);
    try {
      const fingerprint = JSON.stringify({
        bookingId: booking.id,
        mode,
        flightId,
      });
      if (command.current?.fingerprint !== fingerprint)
        command.current = { fingerprint, key: crypto.randomUUID() };
      const input = {
        bookingId: booking.id,
        idempotencyKey: command.current.key,
      };
      const result =
        mode === "upgrade"
          ? await upgrade.mutateAsync(input)
          : await change.mutateAsync({ ...input, newFlightId: flightId ?? 0 });
      setQuote(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };
  const accept = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      if (quote.totalCost > 0) {
        const result = await checkout.mutateAsync({
          bookingId: booking.id,
          modificationId: quote.modificationId,
          provider: "stripe",
        });
        if (!result.url) throw new Error("Payment URL unavailable");
        window.location.assign(result.url);
      } else {
        const result = await confirm.mutateAsync({
          modificationId: quote.modificationId,
        });
        toast.success(
          result.refundDue > 0
            ? ar
              ? "تم التغيير؛ الاسترداد قيد المعالجة."
              : "Exchange applied; refund is processing."
            : ar
              ? "تم تطبيق التغيير."
              : "Change applied."
        );
        await utils.bookings.myBookings.invalidate();
        setQuote(null);
        command.current = null;
        onOpenChange(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (quote)
        await cancel.mutateAsync({ modificationId: quote.modificationId });
      setQuote(null);
      command.current = null;
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) void close();
      }}
    >
      <DialogContent
        className="max-w-xl max-h-[90vh] overflow-y-auto"
        dir={ar ? "rtl" : "ltr"}
      >
        <DialogHeader>
          <DialogTitle>
            {t("modifyBooking.title")} · {booking.bookingReference}
          </DialogTitle>
          <DialogDescription>
            {booking.originName} → {booking.destinationName}
          </DialogDescription>
        </DialogHeader>
        {!quote ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant={mode === "date" ? "default" : "outline"}
                onClick={() => setMode("date")}
              >
                {t("modifyBooking.changeDateTab")}
              </Button>
              <Button
                disabled={booking.cabinClass === "business"}
                variant={mode === "upgrade" ? "default" : "outline"}
                onClick={() => setMode("upgrade")}
              >
                {t("modifyBooking.upgradeTab")}
              </Button>
            </div>
            {mode === "date" && (
              <>
                <label className="block text-sm">
                  {ar ? "تاريخ الرحلة الجديدة" : "New departure date"}
                  <Input
                    type="date"
                    value={date}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={e => {
                      setDate(e.target.value);
                      setFlightId(null);
                    }}
                  />
                </label>
                {search.error && <p role="alert">{search.error.message}</p>}
                {search.isLoading ? (
                  <p>{t("common.loading")}</p>
                ) : (
                  <div className="space-y-2">
                    {search.data?.map(f => (
                      <Button
                        key={f.id}
                        className="w-full justify-between"
                        variant={flightId === f.id ? "default" : "outline"}
                        onClick={() => setFlightId(f.id)}
                      >
                        <span>{f.flightNumber}</span>
                        <span>
                          {new Date(f.departureTime).toLocaleString(
                            ar ? "ar-SA" : "en-GB"
                          )}
                        </span>
                      </Button>
                    ))}
                    {!search.data?.length && (
                      <p>
                        {ar
                          ? "لا توجد رحلات متاحة لهذا التاريخ."
                          : "No flights available for this date."}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            <p className="text-sm text-muted-foreground">
              {ar
                ? "يعرض السعر التالي إجمالي التغيير ورسومه قبل التأكيد. إعادة إصدار وثائق السفر تتبع حالة التنفيذ."
                : "Review the complete price and change fee before confirming. Travel-document reissue follows fulfillment status."}
            </p>
          </div>
        ) : (
          <div className="space-y-3" role="status">
            {[
              [ar ? "الإجمالي الحالي" : "Current total", quote.originalAmount],
              [
                ar
                  ? "الإجمالي الجديد شاملاً الرسوم"
                  : "New total including fees",
                quote.newAmount,
              ],
              [ar ? "رسوم التغيير" : "Change fee", quote.modificationFee],
              [
                quote.totalCost < 0
                  ? ar
                    ? "الاسترداد المستحق"
                    : "Refund due"
                  : ar
                    ? "المبلغ المطلوب"
                    : "Amount due",
                Math.abs(quote.totalCost),
              ],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between">
                <span>{label}</span>
                <strong>{(Number(value) / 100).toFixed(2)} SAR</strong>
              </div>
            ))}
            <p className="text-sm text-muted-foreground">
              {ar
                ? "لا يعد الاسترداد مكتملاً إلا بعد تأكيد جهة الدفع."
                : "Refund completion requires confirmation from the payment provider."}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void close()}
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || (!quote && mode === "date" && !flightId)}
            onClick={() => void (quote ? accept() : request())}
          >
            {busy
              ? t("common.loading")
              : quote
                ? ar
                  ? "تأكيد العرض"
                  : "Confirm offer"
                : ar
                  ? "عرض سعر التغيير"
                  : "Quote change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
