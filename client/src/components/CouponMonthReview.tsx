import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useOperationalLabels } from "./OperationalReadState";

export function CouponMonthReview() {
  const l = useOperationalLabels();
  const [booking, setBooking] = useState(""),
    [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const bookingId = Number(booking);
  const review = trpc.revenueAccounting.couponMonthReview.useQuery(
    { bookingId, month },
    { enabled: false, retry: false }
  );
  const result = review.data;
  const display = (n: number | null) =>
    n === null ? l("غير مثبت", "Unverified") : (n / 100).toFixed(2) + " SAR";
  return (
    <section className="space-y-3 rounded border p-4">
      <h2>
        {l(
          "مراجعة قسائم حجز عند إقفال الشهر",
          "Booking coupon month-end review"
        )}
      </h2>
      <label>
        {l("رقم الحجز الداخلي", "Booking ID")}{" "}
        <input
          type="number"
          min="1"
          value={booking}
          onChange={e => setBooking(e.target.value)}
        />
      </label>
      <label>
        {l("شهر التقرير بالتوقيت العالمي", "UTC reporting month")}{" "}
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={
          !Number.isSafeInteger(bookingId) ||
          bookingId < 1 ||
          !month ||
          review.isFetching
        }
        onClick={() => void review.refetch()}
      >
        {l("عرض أدلة القسائم", "Review coupon evidence")}
      </button>
      {review.error && <p role="alert">{review.error.message}</p>}
      {result && !review.error && (
        <div role="status">
          <p>
            {result.closedMonth
              ? l("انتهت الفترة", "Closed period")
              : l("الفترة ما زالت مفتوحة", "Open period")}
          </p>
          <dl className="grid grid-cols-2 gap-2">
            <dt>{l("صافي النقد خلال الشهر", "Monthly net cash")}</dt>
            <dd>{display(result.cashNetInMonthMinor)}</dd>
            <dt>
              {l(
                "أجرة النقل المستخدمة خلال الشهر",
                "Transport earned in month"
              )}
            </dt>
            <dd>{display(result.transportRecognizedInMonthMinor)}</dd>
            <dt>
              {l(
                "أجرة النقل المؤجلة عند القطع",
                "Transport deferred at cutoff"
              )}
            </dt>
            <dd>{display(result.transportDeferredMinor)}</dd>
            <dt>
              {l(
                "التزام الولاء المسجل عند القطع",
                "Recorded loyalty obligation at cutoff"
              )}
            </dt>
            <dd>{display(result.loyaltyDeferredMinor)}</dd>
          </dl>
          {result.issues.length > 0 && (
            <p>
              {l("أسباب تعذّر المطابقة", "Reconciliation issues")}:{" "}
              {result.issues.join(", ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
