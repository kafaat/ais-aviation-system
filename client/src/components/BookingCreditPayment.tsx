import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useOperationalLabels } from "./OperationalReadState";
import { Button } from "./ui/button";

/** Full-invoice credit payment; the server rechecks the invoice and remaining lots. */
export function BookingCreditPayment({
  bookingId,
  amount,
}: {
  bookingId: number;
  amount: number;
}) {
  const l = useOperationalLabels();
  const [reviewing, setReviewing] = useState(false);
  const balance = trpc.vouchers.myCredits.useQuery(undefined, {
    enabled: reviewing,
  });
  const utils = trpc.useUtils();
  const pay = trpc.vouchers.useCredits.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.bookings.myBookings.invalidate(),
        utils.vouchers.myCredits.invalidate(),
      ]);
    },
  });
  return (
    <div className="space-y-2 rounded border p-3">
      {!reviewing ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setReviewing(true)}
        >
          {l("الدفع من الرصيد", "Pay using credits")}
        </Button>
      ) : (
        <>
          <p>
            {l("قيمة الفاتورة", "Invoice amount")}: {(amount / 100).toFixed(2)}{" "}
            SAR
          </p>
          {balance.isLoading && (
            <p role="status">
              {l("جارٍ قراءة الرصيد", "Loading credit balance")}
            </p>
          )}
          {balance.isError && (
            <div role="alert">
              {balance.error.message}
              <Button variant="outline" onClick={() => void balance.refetch()}>
                {l("إعادة المحاولة", "Retry")}
              </Button>
            </div>
          )}
          {balance.data && !balance.isError && (
            <>
              <p>
                {l("الرصيد المتاح", "Available credits")}:{" "}
                {(balance.data.balance / 100).toFixed(2)} SAR
              </p>
              {balance.data.balance < amount && (
                <p>
                  {l(
                    "الرصيد لا يكفي لتغطية الفاتورة كاملةً.",
                    "Credits do not cover the full invoice."
                  )}
                </p>
              )}
              <Button
                type="button"
                disabled={
                  pay.isPending ||
                  pay.isSuccess ||
                  balance.data.balance < amount
                }
                onClick={() => pay.mutate({ bookingId, amount })}
              >
                {pay.isPending
                  ? l("جارٍ الدفع", "Paying")
                  : l("تأكيد الدفع من الرصيد", "Confirm credit payment")}
              </Button>
            </>
          )}
          {pay.isError && <p role="alert">{pay.error.message}</p>}
        </>
      )}
    </div>
  );
}
