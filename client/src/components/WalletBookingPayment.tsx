import { useLocation } from "wouter";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { useOperationalLabels } from "./OperationalReadState";

export function WalletBookingPayment({
  bookingId,
  totalAmount,
  initiallyReviewing = false,
  disabled = false,
  onPaymentStart,
  onPaymentSettled,
}: {
  bookingId: number;
  totalAmount: number;
  initiallyReviewing?: boolean;
  disabled?: boolean;
  onPaymentStart?: () => boolean;
  onPaymentSettled?: () => Promise<unknown> | void;
}) {
  const [, navigate] = useLocation();
  const l = useOperationalLabels();
  const [review, setReview] = useState(initiallyReviewing);
  const utils = trpc.useUtils();
  const wallet = trpc.wallet.balance.useQuery(undefined, { enabled: review });
  const payment = trpc.wallet.pay.useMutation({
    onSuccess: () => {
      void utils.bookings.myBookings.invalidate();
      void utils.wallet.balance.invalidate();
      void utils.wallet.transactions.invalidate();
      navigate("/payment-history?wallet=history");
    },
    onError: () => {
      void utils.bookings.myBookings.invalidate();
      void wallet.refetch();
    },
    onSettled: () => onPaymentSettled?.(),
  });

  if (!review)
    return (
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => setReview(true)}
      >
        {l("الدفع بالمحفظة", "Pay with wallet")}
      </Button>
    );
  if (payment.isSuccess)
    return (
      <p role="status">{l("تم الدفع بالمحفظة", "Wallet payment completed")}</p>
    );

  return (
    <section className="space-y-2 rounded border p-3">
      <p>
        {l("قيمة الحجز", "Booking total")}: {(totalAmount / 100).toFixed(2)} SAR
      </p>
      {wallet.isLoading && (
        <p role="status">{l("جارٍ قراءة المحفظة", "Loading wallet")}</p>
      )}
      {wallet.isError ? (
        <div role="alert">
          {l("تعذرت قراءة المحفظة", "Wallet unavailable")}
          <Button variant="outline" onClick={() => void wallet.refetch()}>
            {l("إعادة المحاولة", "Retry")}
          </Button>
        </div>
      ) : (
        wallet.data && (
          <>
            <p>
              {l("رصيد المحفظة", "Wallet balance")}:{" "}
              {(wallet.data.balance / 100).toFixed(2)} {wallet.data.currency}
            </p>
            {wallet.data.status !== "active" ||
            wallet.data.currency !== "SAR" ||
            wallet.data.balance < totalAmount ? (
              <p>
                {l(
                  "يلزم رصيد كافٍ في محفظة نشطة بالريال السعودي",
                  "An active SAR wallet with sufficient funds is required"
                )}
              </p>
            ) : (
              <Button
                disabled={disabled || payment.isPending}
                onClick={() => {
                  if (
                    disabled ||
                    payment.isPending ||
                    onPaymentStart?.() === false
                  )
                    return;
                  payment.mutate({ bookingId, expectedAmount: totalAmount });
                }}
              >
                {l("تأكيد الدفع بالمحفظة", "Confirm wallet payment")}
              </Button>
            )}
          </>
        )
      )}
      {payment.isError && <p role="alert">{payment.error.message}</p>}
    </section>
  );
}
