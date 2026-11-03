import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRoute } from "wouter";
import { useRawSearch } from "@/lib/useRawSearch";
import { DisplayCurrencyEstimate } from "@/components/DisplayCurrencyEstimate";
import { CreditCard, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WalletBookingPayment } from "@/components/WalletBookingPayment";
import { SplitPaymentForm } from "@/components/SplitPaymentForm";

type PaymentMethod = "card" | "wallet" | "split";

export default function CheckoutResume() {
  const [, params] = useRoute("/checkout/:bookingId");
  const search = useRawSearch();
  const rawId = params?.bookingId ?? "";
  const bookingId = /^[1-9]\d*$/.test(rawId) ? Number(rawId) : 0;
  const searchParams = new URLSearchParams(search);
  const requestedMethod = searchParams.get("method");
  const initialMethod =
    requestedMethod === "wallet" || requestedMethod === "split"
      ? requestedMethod
      : "card";
  return (
    <CheckoutInvoice
      key={`${rawId}:${initialMethod}`}
      bookingId={Number.isSafeInteger(bookingId) ? bookingId : 0}
      returned={searchParams.get("canceled") === "true"}
      initialMethod={initialMethod}
    />
  );
}

function CheckoutInvoice({
  bookingId,
  returned,
  initialMethod,
}: {
  bookingId: number;
  returned: boolean;
  initialMethod: PaymentMethod;
}) {
  const { t, i18n } = useTranslation();
  const query = trpc.payments.getCheckoutState.useQuery(
    { bookingId },
    { enabled: bookingId > 0, retry: false }
  );
  const checkout = trpc.payments.createCheckoutSession.useMutation();
  const applyVoucher = trpc.vouchers.applyVoucher.useMutation();
  const [voucherCode, setVoucherCode] = useState("");
  const [operationError, setOperationError] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "checkout" | "voucher" | "wallet" | "split" | null
  >(null);
  const [method, setMethod] = useState<PaymentMethod>(initialMethod);
  // Cover double clicks and a voucher/checkout race before React rerenders.
  const inFlight = useRef(false);
  const invoice = query.error ? undefined : query.data;
  const canResume =
    invoice?.state === "pending" || invoice?.state === "expired";
  const terminal =
    invoice && ["paid", "refunded", "cancelled"].includes(invoice.state);
  const disabled = Boolean(busy) || query.isFetching;
  const money = (minor: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: "currency",
      currency: invoice?.currency ?? "SAR",
    }).format(minor / 100);

  function beginOtherPayment(rail: "wallet" | "split") {
    if (!invoice?.invoiceEditable || disabled || inFlight.current) return false;
    inFlight.current = true;
    setBusy(rail);
    setOperationError(null);
    return true;
  }

  async function finishOtherPayment() {
    try {
      await query.refetch();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function continueCheckout() {
    if (!canResume || disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy("checkout");
    setOperationError(null);
    try {
      // The server reuses a frozen claim, including after an ambiguous response.
      // This page never creates a booking or sends a client-calculated amount.
      const session = await checkout.mutateAsync({
        bookingId,
        provider: "stripe",
      });
      if (!session.url) throw new Error(t("checkoutResume.noCheckoutUrl"));
      window.location.assign(session.url);
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : t("common.error")
      );
      await query.refetch();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function submitVoucher(event: FormEvent) {
    event.preventDefault();
    if (
      !invoice?.invoiceEditable ||
      invoice.appliedVoucher ||
      !voucherCode.trim() ||
      disabled ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    setBusy("voucher");
    setOperationError(null);
    try {
      await applyVoucher.mutateAsync({
        bookingId,
        code: voucherCode.trim(),
        // Legacy input; the service prices against the locked invoice itself.
        amount: invoice.totalAmount,
      });
      setVoucherCode("");
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : t("common.error")
      );
    } finally {
      // Also reconcile a lost response: the discount may already be persisted.
      // Only the refreshed server total is ever shown or used for checkout.
      await query.refetch();
      inFlight.current = false;
      setBusy(null);
    }
  }

  const notFound = bookingId === 0 || query.error?.data?.code === "NOT_FOUND";
  return (
    <main className="container mx-auto max-w-2xl px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="flex items-center gap-3">
              <CreditCard aria-hidden="true" className="h-6 w-6" />
              {t("checkoutResume.title")}
            </h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {bookingId > 0 && query.isLoading ? (
            <p role="status" className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("common.loading")}
            </p>
          ) : notFound || query.error ? (
            <div role="alert" className="space-y-2">
              <h2 className="text-lg font-semibold">
                {t(
                  notFound
                    ? "checkoutResume.notFound"
                    : "checkoutResume.readError"
                )}
              </h2>
              <p className="text-muted-foreground">
                {t(
                  notFound
                    ? "checkoutResume.notFoundDescription"
                    : "checkoutResume.readErrorDescription"
                )}
              </p>
            </div>
          ) : invoice ? (
            <>
              <div aria-live="polite" className="space-y-2">
                <h2 className="text-xl font-semibold">
                  {t(`checkoutResume.states.${invoice.state}.title`)}
                </h2>
                <p className="text-muted-foreground">
                  {t(`checkoutResume.states.${invoice.state}.description`)}
                </p>
                {returned && canResume && (
                  <p className="rounded-lg bg-muted p-3 text-sm">
                    {t("checkoutResume.returned")}
                  </p>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-3 rounded-lg border p-4">
                <dt>{t("myBookings.bookingRef")}</dt>
                <dd className="text-end font-mono font-semibold">
                  {invoice.bookingReference}
                </dd>
                <dt>{t("checkoutResume.bookingStatus")}</dt>
                <dd className="text-end">
                  {t(`myBookings.status.${invoice.bookingStatus}`)}
                </dd>
                {invoice.appliedVoucher && (
                  <>
                    <dt>
                      {t("checkoutResume.appliedVoucher", {
                        code: invoice.appliedVoucher.code ?? "",
                      })}
                    </dt>
                    <dd className="text-end">
                      −{money(invoice.appliedVoucher.discountAmount)}
                    </dd>
                  </>
                )}
                <dt className="font-semibold">{t("myBookings.totalAmount")}</dt>
                <dd
                  className="text-end font-semibold"
                  data-testid="checkout-total"
                >
                  {money(invoice.totalAmount)}
                  <DisplayCurrencyEstimate amountMinor={invoice.totalAmount} />
                </dd>
              </dl>
              {canResume &&
                invoice.invoiceEditable &&
                !invoice.appliedVoucher && (
                  <form onSubmit={submitVoucher} className="space-y-2">
                    <Label htmlFor="checkout-voucher">
                      {t("voucher.title")}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="checkout-voucher"
                        value={voucherCode}
                        onChange={event => setVoucherCode(event.target.value)}
                        maxLength={50}
                        disabled={disabled}
                        autoComplete="off"
                      />
                      <Button
                        type="submit"
                        variant="outline"
                        disabled={disabled || !voucherCode.trim()}
                      >
                        {busy === "voucher"
                          ? t("common.loading")
                          : t("voucher.apply")}
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("checkoutResume.voucherHint")}
                    </p>
                  </form>
                )}
              {canResume && !invoice.invoiceEditable && (
                <p className="text-sm text-muted-foreground">
                  {t("checkoutResume.frozenInvoice")}
                </p>
              )}
              {operationError && !terminal && (
                <div
                  role="alert"
                  className="space-y-2 rounded-lg border border-destructive p-3"
                >
                  <p>{operationError}</p>
                  <p className="text-sm">{t("checkoutResume.retryHint")}</p>
                </div>
              )}
              {canResume && invoice.invoiceEditable && (
                <fieldset disabled={disabled} className="space-y-3">
                  <legend className="mb-2 font-semibold">
                    {t("checkoutResume.chooseMethod")}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {(["card", "wallet", "split"] as const).map(option => (
                      <Button
                        key={option}
                        type="button"
                        variant={method === option ? "default" : "outline"}
                        aria-pressed={method === option}
                        onClick={() => setMethod(option)}
                      >
                        {t(`checkoutResume.methods.${option}`)}
                      </Button>
                    ))}
                  </div>
                </fieldset>
              )}
              {canResume && (!invoice.invoiceEditable || method === "card") && (
                <Button
                  className="w-full"
                  disabled={disabled}
                  onClick={continueCheckout}
                >
                  {busy === "checkout" && (
                    <Loader2
                      aria-hidden="true"
                      className="me-2 h-4 w-4 animate-spin"
                    />
                  )}
                  {t("checkoutResume.continue")}
                </Button>
              )}
              {canResume && invoice.invoiceEditable && method === "wallet" && (
                <WalletBookingPayment
                  key={invoice.totalAmount}
                  bookingId={bookingId}
                  totalAmount={invoice.totalAmount}
                  initiallyReviewing
                  disabled={disabled}
                  onPaymentStart={() => beginOtherPayment("wallet")}
                  onPaymentSettled={finishOtherPayment}
                />
              )}
              {canResume && invoice.invoiceEditable && method === "split" && (
                <fieldset disabled={disabled}>
                  <SplitPaymentForm
                    key={invoice.totalAmount}
                    bookingId={bookingId}
                    totalAmount={invoice.totalAmount}
                    bookingReference={invoice.bookingReference}
                    disabled={disabled}
                    onPaymentStart={() => beginOtherPayment("split")}
                    onPaymentSettled={finishOtherPayment}
                  />
                </fieldset>
              )}
              {invoice.state === "split" && (
                <ExistingSplitPlan bookingId={bookingId} />
              )}
            </>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {bookingId > 0 && !notFound && (
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => void query.refetch()}
              >
                {t("checkoutResume.refresh")}
              </Button>
            )}
            <Button variant="ghost" asChild>
              <Link href="/my-bookings">{t("checkoutResume.myBookings")}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function ExistingSplitPlan({ bookingId }: { bookingId: number }) {
  const { t, i18n } = useTranslation();
  const status = trpc.splitPayments.getStatus.useQuery(
    { bookingId },
    { retry: false }
  );
  if (status.isLoading) return <p role="status">{t("common.loading")}</p>;
  if (status.error || !status.data)
    return (
      <div role="alert" className="space-y-2">
        <p>{t("checkoutResume.splitReadError")}</p>
        <Button
          variant="outline"
          disabled={status.isFetching}
          onClick={() => void status.refetch()}
        >
          {t("checkoutResume.refresh")}
        </Button>
      </div>
    );
  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border px-4">
        {status.data.splits.map(split => (
          <li
            key={split.id}
            className="flex flex-wrap items-center justify-between gap-2 py-3"
          >
            <span>{split.payerName}</span>
            <span>
              {new Intl.NumberFormat(i18n.language, {
                style: "currency",
                currency: "SAR",
              }).format(split.amount / 100)}
            </span>
            <span>
              {t(`checkoutResume.splitStatuses.${split.status}`, {
                defaultValue: t("checkoutResume.splitStatuses.unknown"),
              })}
            </span>
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        disabled={status.isFetching}
        onClick={() => void status.refetch()}
      >
        {t("checkoutResume.refreshSplit")}
      </Button>
    </div>
  );
}
