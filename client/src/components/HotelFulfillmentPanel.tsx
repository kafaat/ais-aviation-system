import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

/** Operator procurement workflow: request -> read quote/terms -> explicit approval. */
export function HotelFulfillmentPanel() {
  const { i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const [form, setForm] = useState({
    hotelId: "",
    bookingId: "",
    flightId: "",
    passengerId: "",
    checkIn: "",
    checkOut: "",
  });
  const [providerForm, setProviderForm] = useState({
    hotelBookingId: "",
    hotelCode: "",
    rateKey: "",
    mappingEvidence: "",
  });
  const [accepted, setAccepted] = useState(false);
  const [cancellationCeiling, setCancellationCeiling] = useState("0");
  const retry = useRef({ fingerprint: "", key: "" });
  const utils = trpc.useUtils();
  const refresh = () => {
    void utils.emergencyHotel.invalidate();
  };
  const request = trpc.emergencyHotel.bookRoom.useMutation({
    onSuccess: row => {
      setProviderForm(f => ({ ...f, hotelBookingId: String(row.id) }));
      refresh();
      toast.success(
        `${ar ? "سُجّل الطلب" : "Request recorded"}: ${row.requestReference}`
      );
    },
    onError: error => toast.error(error.message),
  });
  const quote = trpc.emergencyHotel.prepareProviderQuote.useMutation({
    onError: error => toast.error(error.message),
  });
  const approve = trpc.emergencyHotel.approveProviderQuote.useMutation({
    onSuccess: () => {
      quote.reset();
      setAccepted(false);
      refresh();
      toast.success(
        ar ? "بانتظار تأكيد المزوّد" : "Awaiting provider confirmation"
      );
    },
    onError: error => toast.error(error.message),
  });
  const cancel = trpc.emergencyHotel.cancelBooking.useMutation({
    onSuccess: () => {
      refresh();
      toast.success(
        ar
          ? "سُجّل طلب الإلغاء؛ راجع حالة المزوّد"
          : "Cancellation requested; check provider status"
      );
    },
    onError: error => toast.error(error.message),
  });
  function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    const fingerprint = JSON.stringify(form);
    if (retry.current.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: crypto.randomUUID() };
    request.mutate({
      hotelId: Number(form.hotelId),
      bookingId: Number(form.bookingId),
      flightId: Number(form.flightId),
      passengerId: Number(form.passengerId),
      checkIn: new Date(`${form.checkIn}T00:00:00Z`),
      checkOut: new Date(`${form.checkOut}T00:00:00Z`),
      roomType: "standard",
      mealIncluded: false,
      transportIncluded: false,
      idempotencyKey: retry.current.key,
    });
  }
  return (
    <details className="rounded border p-4">
      <summary className="cursor-pointer font-medium">
        {ar
          ? "طلب إقامة واعتماد عرض المزوّد"
          : "Request accommodation and approve a provider quote"}
      </summary>
      <form onSubmit={submitRequest} className="my-4 grid gap-3 sm:grid-cols-3">
        {(Object.keys(form) as Array<keyof typeof form>).map(key => (
          <label key={key} className="text-sm">
            {
              {
                hotelId: ar ? "معرّف الفندق" : "Hotel ID",
                bookingId: ar ? "معرّف الحجز" : "Booking ID",
                flightId: ar ? "معرّف الرحلة" : "Flight ID",
                passengerId: ar ? "معرّف المسافر" : "Passenger ID",
                checkIn: ar ? "الوصول" : "Check-in",
                checkOut: ar ? "المغادرة" : "Check-out",
              }[key]
            }
            <Input
              required
              type={key.startsWith("check") ? "date" : "number"}
              min={key.endsWith("Id") ? 1 : undefined}
              value={form[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            />
          </label>
        ))}
        <Button disabled={request.isPending} type="submit">
          {ar ? "تسجيل طلب إقامة" : "Record accommodation request"}
        </Button>
      </form>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={e => {
          e.preventDefault();
          setAccepted(false);
          quote.mutate({
            ...providerForm,
            hotelBookingId: Number(providerForm.hotelBookingId),
            hotelCode: Number(providerForm.hotelCode),
          });
        }}
      >
        {(Object.keys(providerForm) as Array<keyof typeof providerForm>).map(
          key => (
            <label key={key} className="text-sm">
              {
                {
                  hotelBookingId: ar
                    ? "معرّف طلب الإقامة"
                    : "Accommodation request ID",
                  hotelCode: ar
                    ? "رمز الفندق المعتمد لدى Hotelbeds"
                    : "Approved Hotelbeds hotel code",
                  rateKey: ar ? "مفتاح السعر من المزوّد" : "Provider rate key",
                  mappingEvidence: ar
                    ? "مرجع تحقق مطابقة الفندق والغرفة"
                    : "Hotel and room mapping verification reference",
                }[key]
              }
              <Input
                required
                type={key === "rateKey" ? "password" : "text"}
                autoComplete="off"
                value={providerForm[key]}
                onChange={e => {
                  setProviderForm(f => ({ ...f, [key]: e.target.value }));
                  quote.reset();
                  setAccepted(false);
                }}
              />
            </label>
          )
        )}
        <Button type="submit" variant="outline" disabled={quote.isPending}>
          {ar ? "جلب العرض والشروط" : "Retrieve quote and terms"}
        </Button>
      </form>
      {quote.data && (
        <div className="mt-4 space-y-3 rounded border p-3">
          <p>
            {quote.data.mode === "sandbox"
              ? ar
                ? "بيئة اختبار — لا ينشئ إقامة فعلية"
                : "Sandbox — does not create a real stay"
              : ar
                ? "حجز فعلي لدى المزوّد"
                : "Live provider booking"}
          </p>
          <p>
            {quote.data.hotelCode} / {quote.data.roomCode} /{" "}
            {quote.data.boardCode} · {quote.data.checkIn} →{" "}
            {quote.data.checkOut}
          </p>
          <p>
            {ar ? "تكلفة المزوّد" : "Provider cost"}:{" "}
            {(quote.data.totalCost / 100).toFixed(2)} SAR
          </p>
          <p className="whitespace-pre-wrap">{quote.data.terms}</p>
          <ul>
            {quote.data.cancellationPolicies.map(p => (
              <li key={p.from}>
                {p.from}: {(p.amount / 100).toFixed(2)} SAR
              </li>
            ))}
          </ul>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={accepted}
              onChange={e => setAccepted(e.target.checked)}
            />
            {ar
              ? "تحققت من الفندق والغرفة وأعتمد السعر والشروط ورسوم الموقع المذكورة. النقل يحتاج ترتيبًا منفصلًا."
              : "I verified the hotel and room and approve the price, terms and stated local fees. Transport requires separate arrangements."}
          </label>
          <Button
            disabled={!accepted || approve.isPending}
            onClick={() => {
              if (quote.data)
                approve.mutate({
                  hotelBookingId: Number(providerForm.hotelBookingId),
                  quoteId: quote.data.quoteId,
                  termsAccepted: true,
                });
            }}
          >
            {ar ? "اعتماد وإرسال للمزوّد" : "Approve and submit to provider"}
          </Button>
        </div>
      )}
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={e => {
          e.preventDefault();
          cancel.mutate({
            hotelBookingId: Number(providerForm.hotelBookingId),
            maxCancellationCost: Math.round(Number(cancellationCeiling) * 100),
          });
        }}
      >
        <label className="text-sm">
          {ar
            ? "أقصى رسم إلغاء معتمد للطلب أعلاه (ريال)"
            : "Approved cancellation ceiling for the request above (SAR)"}
          <Input
            required
            type="number"
            min="0"
            step="0.01"
            value={cancellationCeiling}
            onChange={e => setCancellationCeiling(e.target.value)}
          />
        </label>
        <Button
          type="submit"
          variant="outline"
          disabled={cancel.isPending || !providerForm.hotelBookingId}
        >
          {ar ? "اعتماد طلب الإلغاء" : "Approve cancellation request"}
        </Button>
      </form>
    </details>
  );
}
