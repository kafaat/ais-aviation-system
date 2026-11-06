import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function SettlementReviews() {
  const { i18n } = useTranslation();
  const { user, loading } = useAuth();
  const ar = i18n.language.startsWith("ar");
  const l = (arabic: string, english: string) => (ar ? arabic : english);
  const allowed = user?.role === "admin" || user?.role === "super_admin";
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState<{
    paymentIntentId: string;
    state: "awaiting_webhook" | "refunded";
    refundId: string | null;
  } | null>(null);
  const queue = trpc.payments.settlementReviews.useQuery(
    { limit },
    { enabled: allowed, refetchInterval: 15000 }
  );
  const detail = trpc.payments.settlementReview.useQuery(
    { paymentIntentId: selected ?? "" },
    { enabled: allowed && selected !== null, refetchInterval: 5000 }
  );
  const refund = trpc.payments.refundSettlementReview.useMutation({
    onSuccess: (result, input) => {
      setAcknowledgement({ ...result, paymentIntentId: input.paymentIntentId });
      setConfirming(false);
      void queue.refetch();
      void detail.refetch();
    },
  });
  const receipt = detail.data;
  const refunded =
    receipt?.settlementStatus === "review_refunded" ||
    (receipt !== undefined &&
      receipt.amount > 0 &&
      receipt.refundedAmount === receipt.amount);
  const awaiting =
    acknowledgement?.paymentIntentId === selected &&
    acknowledgement.state === "awaiting_webhook" &&
    !refunded;
  const money = (amount: number, currency: string) =>
    `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  const refresh = () => {
    void queue.refetch();
    if (selected) void detail.refetch();
  };

  if (loading) return <p role="status">{l("جار التحميل…", "Loading…")}</p>;
  if (!allowed)
    return (
      <p role="alert">
        {l(
          "هذه الصفحة مخصصة لإدارة المنصة.",
          "Platform administrator access is required."
        )}
      </p>
    );

  return (
    <main className="container py-8 space-y-6" dir={ar ? "rtl" : "ltr"}>
      <Link href="/admin">{l("لوحة الإدارة", "Administration")}</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {l("مراجعة تسويات المدفوعات", "Payment settlement reviews")}
        </h1>
        <Button variant="outline" onClick={refresh} disabled={queue.isFetching}>
          {l("تحديث الحالة", "Refresh status")}
        </Button>
      </div>
      <p>
        {l(
          "المدفوعات المحصلة التي تحتاج مراجعة. قبول طلب الاسترداد لا يثبت اكتماله؛ تُحدّث الحالة عند وصول إشعار مزوّد الدفع الموثّق.",
          "Collected payments requiring review. A refund request acknowledgement does not confirm completion; verified payment provider events update the recorded status."
        )}
      </p>
      {queue.isLoading && (
        <p role="status">
          {l("جار تحميل قائمة المراجعة…", "Loading review queue…")}
        </p>
      )}
      {queue.isError && <p role="alert">{queue.error.message}</p>}
      {!queue.isError && queue.data?.length === 0 && (
        <p>
          {l(
            "لا توجد تسويات معلقة للمراجعة.",
            "No pending settlement reviews."
          )}
        </p>
      )}
      {!queue.isError &&
        queue.data?.map(item => (
          <Card
            key={item.paymentIntentId}
            className="p-4 flex flex-wrap items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <p className="font-mono break-all">{item.paymentIntentId}</p>
              <p>
                {l("المبلغ المحصّل", "Collected")}:{" "}
                {money(item.amount, item.currency)}
              </p>
              <p>
                {l("المسترد المسجل", "Recorded refund")}:{" "}
                {money(item.refundedAmount, item.currency)}
              </p>
              <p>
                {l("الحجز", "Booking")}:{" "}
                {item.bookingId ??
                  l("غير مرتبط بحجز", "Not linked to a booking")}{" "}
                · {l("المستخدم", "User")}: {item.userId}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setSelected(item.paymentIntentId);
                setConfirming(false);
                refund.reset();
              }}
            >
              {l("مراجعة", "Review")} {item.paymentIntentId}
            </Button>
          </Card>
        ))}
      {!queue.isError && queue.data?.length === limit && (
        <div className="space-y-2">
          <p>
            {l(
              `تُعرض أقدم ${limit} تسوية؛ قد توجد سجلات إضافية.`,
              `Showing the oldest ${limit} reviews; additional records may exist.`
            )}
          </p>
          {limit < 100 && (
            <Button variant="outline" onClick={() => setLimit(100)}>
              {l("عرض حتى 100 تسوية", "Show up to 100 reviews")}
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={open => {
          if (!open && !refund.isPending) {
            setSelected(null);
            setConfirming(false);
          }
        }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto"
          dir={ar ? "rtl" : "ltr"}
        >
          <DialogHeader>
            <DialogTitle>
              {l("تفاصيل التسوية", "Settlement details")}
            </DialogTitle>
            <DialogDescription className="break-all">
              {selected}
            </DialogDescription>
          </DialogHeader>
          {detail.isLoading && (
            <p role="status">{l("جار تحميل التفاصيل…", "Loading details…")}</p>
          )}
          {detail.isError && <p role="alert">{detail.error.message}</p>}
          {receipt && !detail.isError && (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-2">
                <dt>{l("نوع العملية", "Collection type")}</dt>
                <dd>{receipt.kind}</dd>
                <dt>{l("الحجز", "Booking")}</dt>
                <dd>{receipt.bookingId ?? "—"}</dd>
                <dt>{l("المستخدم", "User")}</dt>
                <dd>{receipt.userId}</dd>
                <dt>{l("المبلغ المحصّل", "Collected")}</dt>
                <dd>{money(receipt.amount, receipt.currency)}</dd>
                <dt>{l("المسترد المسجل", "Recorded refund")}</dt>
                <dd>{money(receipt.refundedAmount, receipt.currency)}</dd>
                <dt>{l("تاريخ التحصيل", "Collected at")}</dt>
                <dd>
                  {new Date(receipt.createdAt).toLocaleString(i18n.language)}
                </dd>
              </dl>
              <p role="status">
                {refunded
                  ? l(
                      "اكتمل الاسترداد وفق السجل المالي الموثّق.",
                      "Refund confirmed by the recorded financial evidence."
                    )
                  : awaiting
                    ? l(
                        "قُبل الطلب؛ بانتظار تأكيد مزوّد الدفع الموثّق.",
                        "Request acknowledged; awaiting verified provider confirmation."
                      )
                    : l(
                        "تحتاج التسوية إلى مراجعة.",
                        "Settlement requires review."
                      )}
              </p>
              {awaiting && acknowledgement?.refundId && (
                <p>
                  {l("مرجع طلب الاسترداد", "Refund request reference")}:{" "}
                  {acknowledgement.refundId}
                </p>
              )}
              {receipt.settlementError && (
                <p className="break-words">
                  {l("سبب المراجعة", "Review reason")}:{" "}
                  {receipt.settlementError}
                </p>
              )}
              {refund.isError && <p role="alert">{refund.error.message}</p>}
              {!refunded && !confirming && (
                <Button
                  onClick={() => setConfirming(true)}
                  disabled={refund.isPending}
                >
                  {l(
                    "طلب الاسترداد أو إعادة المحاولة",
                    "Request or retry refund"
                  )}
                </Button>
              )}
              {!refunded && confirming && (
                <div className="border rounded p-3 space-y-3">
                  <p>
                    {l(
                      "سيُطلب استرداد كامل الرصيد المتبقي لدى مزوّد الدفع. تستعمل إعادة المحاولة نفس مرجع العملية، وتظل قيود الإقفال التشغيلي سارية.",
                      "This requests the full remaining balance from the payment provider. Retries reuse the same operation reference and departure reconciliation restrictions still apply."
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={refund.isPending}
                      onClick={() =>
                        refund.mutate({
                          paymentIntentId: receipt.paymentIntentId,
                        })
                      }
                    >
                      {refund.isPending
                        ? l("جار إرسال الطلب…", "Sending request…")
                        : l("تأكيد طلب الاسترداد", "Confirm refund request")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={refund.isPending}
                      onClick={() => setConfirming(false)}
                    >
                      {l("رجوع", "Back")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          <Button
            variant="outline"
            onClick={refresh}
            disabled={detail.isFetching}
          >
            {l("تحديث التفاصيل", "Refresh details")}
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
