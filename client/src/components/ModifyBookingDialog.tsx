import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TRPCClientError } from "@trpc/client";
import { airlineSupportUrl } from "@/lib/airline-support";
import { trpc } from "@/lib/trpc";
import {
  civilDateAt,
  formatFlightDate,
  formatFlightTime,
} from "@/lib/flight-time";
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
    cabinClass: string;
    originName: string;
    destinationName: string;
  };
}

export function ModifyBookingDialog({ open, onOpenChange, booking }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<"date" | "upgrade">("date");
  const [sectorId, setSectorId] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const [replacement, setReplacement] = useState<number | null>(null);
  const [consent, setConsent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [seatReview, setSeatReview] = useState(false);
  const support = airlineSupportUrl();
  const command = useRef<{ fingerprint: string; key: string } | null>(null);
  const context = trpc.modifications.exchangeContext.useQuery(
    { bookingId: booking.id },
    { enabled: open, refetchOnMount: "always" }
  );
  const sectors = context.data?.sectors ?? [];
  const sector =
    sectors.find(s => s.flightId === sectorId) ??
    sectors.find(s => s.status === "confirmed");
  const day =
    date ||
    civilDateAt(sector?.departureTime ?? new Date(), sector?.originTimezone);
  const latest = context.data?.latest;
  const pending = latest?.status === "pending" ? latest : null;
  const search = trpc.flights.search.useQuery(
    {
      originId: sector?.originId ?? 0,
      destinationId: sector?.destinationId ?? 0,
      departureDate: day,
    },
    {
      enabled:
        open &&
        !pending &&
        mode === "date" &&
        !!sector &&
        /^\d{4}-\d{2}-\d{2}$/.test(day),
    }
  );
  const change = trpc.modifications.requestChangeDate.useMutation();
  const upgrade = trpc.modifications.requestUpgrade.useMutation();
  const checkout = trpc.payments.createModificationCheckout.useMutation();
  const confirm = trpc.ndc.confirmNoChargeService.useMutation();
  const cancel = trpc.ndc.cancelPaidService.useMutation();
  const disabled = busy || context.isFetching || unknown || !!context.error;
  const expiry = pending?.expiresAt?.getTime() ?? 0;
  const [elapsedExpiry, setElapsedExpiry] = useState<number | null>(null);
  useEffect(() => {
    if (!expiry || expiry <= Date.now()) return;
    const timer = window.setTimeout(
      () => setElapsedExpiry(expiry),
      expiry - Date.now()
    );
    return () => window.clearTimeout(timer);
  }, [expiry]);
  const expired = !expiry || elapsedExpiry === expiry || expiry <= Date.now();
  const canConfirm =
    pending &&
    !pending.reviewRequired &&
    !expired &&
    consent === pending.modificationId;
  const money = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "SAR",
    }).format(value / 100);
  const refresh = async () => {
    const result = await context.refetch();
    setUnknown(!!result.error);
    if (result.data?.latest?.status === "completed")
      await utils.bookings.myBookings.invalidate();
  };
  const execute = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setSeatReview(false);
    try {
      await work();
    } catch (error) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "PRECONDITION_FAILED" &&
        /paid seat/i.test(error.message)
      ) {
        setSeatReview(true);
      } else {
        toast.error(error instanceof Error ? error.message : t("common.error"));
        setUnknown(true);
      }
      setConsent(null);
    } finally {
      setBusy(false);
    }
  };
  const request = async () => {
    if (!sector || pending || disabled) return;
    const fingerprint = JSON.stringify({
      booking: booking.id,
      sector: sector.flightId,
      replacement,
      mode,
    });
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, key: crypto.randomUUID() };
    const input = {
      bookingId: booking.id,
      idempotencyKey: command.current.key,
    };
    if (mode === "upgrade") await upgrade.mutateAsync(input);
    else if (replacement)
      await change.mutateAsync({
        ...input,
        newFlightId: replacement,
        replaceFlightId: sector.flightId,
      });
    setConsent(null);
    await refresh();
  };
  const accept = async () => {
    if (!canConfirm || disabled || expiry <= Date.now()) return;
    if (pending.totalCost > 0) {
      const result = await checkout.mutateAsync({
        bookingId: booking.id,
        modificationId: pending.modificationId,
        provider: "stripe",
      });
      if (!result.url)
        throw new Error(t("modifyBooking.exchange.paymentUnavailable"));
      window.location.assign(result.url);
    } else {
      await confirm.mutateAsync({ modificationId: pending.modificationId });
      setConsent(null);
      command.current = null;
      await refresh();
    }
  };
  const discard = async () => {
    if (!pending || disabled) return;
    await cancel.mutateAsync({ modificationId: pending.modificationId });
    command.current = null;
    setConsent(null);
    await refresh();
  };
  const label = (f: NonNullable<typeof sector>) =>
    `${f.flightNumber} · ${f.origin} → ${f.destination} · ${formatFlightDate(f.departureTime, f.originTimezone, locale)} ${formatFlightTime(f.departureTime, f.originTimezone, locale)}`;
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-xl max-h-[90vh] overflow-y-auto"
        dir={locale.startsWith("ar") ? "rtl" : "ltr"}
      >
        <DialogHeader>
          <DialogTitle>
            {t("modifyBooking.title")} · {booking.bookingReference}
          </DialogTitle>
          <DialogDescription>
            {booking.originName} → {booking.destinationName}
          </DialogDescription>
        </DialogHeader>
        {context.isLoading && <p role="status">{t("common.loading")}</p>}
        {seatReview && (
          <p role="alert">
            {t("modifyBooking.exchange.seatReview")}{" "}
            {support && (
              <a
                className="underline"
                href={support.href}
                target="_blank"
                rel="noreferrer"
              >
                {t("modifyBooking.exchange.contact")}
              </a>
            )}
          </p>
        )}
        {(unknown || context.error) && (
          <p role="alert">{t("modifyBooking.exchange.lookupFirst")}</p>
        )}
        {latest && !pending && (
          <div role="status" className="rounded border p-3">
            {latest.reviewRequired
              ? t("modifyBooking.exchange.review")
              : t(`modifyBooking.exchange.status.${latest.status}`)}{" "}
            · #{latest.modificationId}
            {latest.receiptId && (
              <p>
                {t("modifyBooking.exchange.receipt")}{" "}
                <bdi>{latest.receiptId}</bdi>
              </p>
            )}
            {latest.refundStatus && (
              <p>{t(`modifyBooking.exchange.refund.${latest.refundStatus}`)}</p>
            )}
          </div>
        )}
        {context.data && !pending && !unknown && !context.error && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                aria-pressed={mode === "date"}
                variant={mode === "date" ? "default" : "outline"}
                onClick={() => setMode("date")}
              >
                {t("modifyBooking.changeDateTab")}
              </Button>
              <Button
                aria-pressed={mode === "upgrade"}
                disabled={
                  booking.cabinClass === "business" || sectors.length !== 1
                }
                variant={mode === "upgrade" ? "default" : "outline"}
                onClick={() => setMode("upgrade")}
              >
                {t("modifyBooking.upgradeTab")}
              </Button>
            </div>
            {mode === "date" && (
              <>
                <label className="block text-sm">
                  {t("modifyBooking.exchange.sector")}
                  <select
                    className="block w-full border rounded p-2"
                    value={sector?.flightId ?? ""}
                    onChange={e => {
                      setSectorId(Number(e.target.value));
                      setReplacement(null);
                      setDate("");
                    }}
                  >
                    {sectors.map(s => (
                      <option
                        key={s.flightId}
                        value={s.flightId}
                        disabled={s.status !== "confirmed"}
                      >
                        {label(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  {t("modifyBooking.exchange.date")}
                  <Input
                    type="date"
                    value={day}
                    min={civilDateAt(new Date(), sector?.originTimezone)}
                    onChange={e => {
                      setDate(e.target.value);
                      setReplacement(null);
                    }}
                  />
                </label>
                {search.error && <p role="alert">{search.error.message}</p>}
                {search.isLoading && <p>{t("common.loading")}</p>}
                <div className="space-y-2">
                  {search.data
                    ?.filter(f => f.id !== sector?.flightId)
                    .map(f => (
                      <Button
                        key={f.id}
                        className="w-full justify-between"
                        aria-pressed={replacement === f.id}
                        variant={replacement === f.id ? "default" : "outline"}
                        onClick={() => setReplacement(f.id)}
                      >
                        <bdi>{f.flightNumber}</bdi>
                        <span>
                          {formatFlightDate(
                            f.departureTime,
                            f.origin.timezone,
                            locale
                          )}{" "}
                          ·{" "}
                          {formatFlightTime(
                            f.departureTime,
                            f.origin.timezone,
                            locale
                          )}
                        </span>
                      </Button>
                    ))}
                  {search.data &&
                    !search.data.some(f => f.id !== sector?.flightId) && (
                      <p>{t("modifyBooking.exchange.noFlights")}</p>
                    )}
                </div>
              </>
            )}
          </div>
        )}
        {pending && (
          <div className="space-y-3 rounded border p-3" role="status">
            <p>
              {t("modifyBooking.exchange.quote")} #{pending.modificationId}
            </p>
            {pending.originalFlight && pending.replacementFlight && (
              <p dir="auto">
                <bdi>{pending.originalFlight.flightNumber}</bdi> →{" "}
                <bdi>{pending.replacementFlight.flightNumber}</bdi> ·{" "}
                {formatFlightDate(
                  pending.replacementFlight.departureTime,
                  pending.replacementFlight.originTimezone,
                  locale
                )}{" "}
                {formatFlightTime(
                  pending.replacementFlight.departureTime,
                  pending.replacementFlight.originTimezone,
                  locale
                )}
              </p>
            )}
            {(
              [
                ["original", pending.originalAmount],
                ["difference", pending.priceDifference],
                ["fee", pending.modificationFee],
                ["newTotal", pending.newAmount],
                [
                  pending.totalCost < 0 ? "refundDue" : "amountDue",
                  Math.abs(pending.totalCost),
                ],
              ] as const
            ).map(([key, value]) => (
              <div className="flex justify-between" key={key}>
                <span>{t(`modifyBooking.exchange.${key}`)}</span>
                <strong>
                  <bdi>{money(value)}</bdi>
                </strong>
              </div>
            ))}
            {pending.seatExchange?.seats.map((seat, i) => (
              <p key={i}>
                {t("modifyBooking.exchange.retainedSeat", {
                  seat: seat.seatNumber,
                  amount: money(seat.amount),
                })}
              </p>
            ))}
            {pending.expiresAt && (
              <p>
                {t("modifyBooking.exchange.expires", {
                  time: new Date(pending.expiresAt).toISOString(),
                })}
              </p>
            )}
            {pending.reviewRequired ? (
              <p>{t("modifyBooking.exchange.review")}</p>
            ) : expired ? (
              <p>{t("modifyBooking.exchange.expired")}</p>
            ) : (
              <>
                {pending.checkoutStarted && (
                  <p>{t("modifyBooking.exchange.checkoutPending")}</p>
                )}
                <label className="flex gap-2 items-start">
                  <input
                    type="checkbox"
                    checked={consent === pending.modificationId}
                    onChange={e =>
                      setConsent(
                        e.target.checked ? pending.modificationId : null
                      )
                    }
                  />
                  {t("modifyBooking.exchange.consent")}
                </label>
              </>
            )}
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("common.close")}
          </Button>
          {(latest || unknown || context.error) && (
            <Button
              variant="outline"
              disabled={busy || context.isFetching}
              onClick={() => void execute(refresh)}
            >
              {t("modifyBooking.exchange.refresh")}
            </Button>
          )}
          {pending && !pending.reviewRequired && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => void execute(discard)}
            >
              {t("modifyBooking.exchange.discard")}
            </Button>
          )}
          {pending ? (
            <Button
              disabled={disabled || !canConfirm}
              onClick={() => void execute(accept)}
            >
              {t(
                pending.checkoutStarted
                  ? "modifyBooking.exchange.resume"
                  : "modifyBooking.exchange.confirm"
              )}
            </Button>
          ) : (
            <Button
              disabled={
                disabled || !sector || (mode === "date" && !replacement)
              }
              onClick={() => void execute(request)}
            >
              {t("modifyBooking.exchange.quote")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
