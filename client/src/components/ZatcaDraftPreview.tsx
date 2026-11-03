import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  OperationalReadState,
  useOperationalLabels,
} from "./OperationalReadState";

function DraftControls() {
  const l = useOperationalLabels();
  const status = trpc.revenueAccounting.zatcaDraftAvailability.useQuery();
  const draft = trpc.revenueAccounting.prepareZatcaDraft.useMutation();
  const payload = draft.data?.previewQrPayload;
  const [qr, setQr] = useState<{ payload: string; url: string }>();
  useEffect(() => {
    let active = true;
    if (payload) {
      void import("qrcode")
        .then(({ default: qrCode }) => qrCode.toDataURL(payload))
        .then(url => {
          if (active) setQr({ payload, url });
        })
        .catch(() => {}); // The encoded payload remains available for review.
    }
    return () => {
      active = false;
    };
  }, [payload]);
  return (
    <OperationalReadState query={status}>
      {status.data === "available" ? (
        <>
          <form
            onChange={() => draft.reset()}
            onSubmit={e => {
              e.preventDefault();
              if (draft.isPending) return;
              const fields = new FormData(e.currentTarget);
              const value = (key: string) =>
                String(fields.get(key) ?? "").trim();
              draft.mutate({
                bookingId: Number(value("bookingId")),
                invoiceNumber: value("invoiceNumber"),
                sellerName: value("sellerName"),
                sellerVatNumber: value("sellerVatNumber"),
                issueTimestamp: new Date(value("issueTimestamp") + "Z"),
                supplyTimestamp: new Date(value("supplyTimestamp") + "Z"),
              });
            }}
          >
            <fieldset disabled={draft.isPending} className="grid gap-2">
              <label>
                {l("رقم الحجز الداخلي", "Booking ID")}
                <Input
                  name="bookingId"
                  required
                  type="number"
                  min={1}
                  step={1}
                />
              </label>
              <label>
                {l("رقم الفاتورة", "Invoice number")}
                <Input name="invoiceNumber" required maxLength={64} />
              </label>
              <label>
                {l("اسم البائع", "Seller name")}
                <Input name="sellerName" required maxLength={255} />
              </label>
              <label>
                {l("الرقم الضريبي للبائع", "Seller VAT number")}
                <Input
                  name="sellerVatNumber"
                  required
                  inputMode="numeric"
                  pattern="3[0-9]{13}3"
                  maxLength={15}
                />
              </label>
              <label>
                {l("وقت الإصدار (UTC)", "Issue time (UTC)")}
                <Input type="datetime-local" name="issueTimestamp" required />
              </label>
              <label>
                {l("وقت التوريد (UTC)", "Supply time (UTC)")}
                <Input type="datetime-local" name="supplyTimestamp" required />
              </label>
              <Button type="submit">
                {l("حفظ ومعاينة المسودة", "Save and preview draft")}
              </Button>
            </fieldset>
          </form>
          {draft.error && <p role="alert">{draft.error.message}</p>}
          {draft.data && (
            <section aria-live="polite" className="space-y-2">
              <h3>
                {l("مسودة الفاتورة", "Invoice draft")}{" "}
                {draft.data.invoiceNumber}
              </h3>
              <p>
                {l("الإجمالي", "Total")}{" "}
                {(draft.data.totalAmount / 100).toFixed(2)} SAR
              </p>
              <p>
                {l("الضريبة", "VAT")} {(draft.data.taxAmount / 100).toFixed(2)}{" "}
                SAR
              </p>
              {qr && qr.payload === payload && (
                <img src={qr.url} alt={l("رمز المعاينة", "Draft QR code")} />
              )}
              <label>
                {l("بيانات رمز المعاينة", "Draft QR payload")}
                <textarea className="block w-full" readOnly value={payload} />
              </label>
            </section>
          )}
        </>
      ) : (
        <p>
          {status.data === "tenant_required"
            ? l(
                "يلزم سياق شركة طيران لإنشاء المسودة.",
                "An airline tenant is required to prepare a draft."
              )
            : status.data === "acceptance_required"
              ? l(
                  "يلزم تسجيل دليل قبول الإنتاج لتمكين المسودات.",
                  "Production acceptance evidence is required to enable drafts."
                )
              : l(
                  "إنشاء المسودات معطّل في هذه البيئة.",
                  "Draft generation is disabled in this environment."
                )}
        </p>
      )}
    </OperationalReadState>
  );
}
export function ZatcaDraftPreview() {
  const l = useOperationalLabels();
  const [open, setOpen] = useState(false);
  return (
    <section className="border p-4 space-y-2">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {l("معاينة فاتورة ZATCA المحلية", "Local ZATCA invoice preview")}
        </button>
      </h2>
      {open && (
        <>
          <p>
            {l(
              "المسودة للمراجعة الداخلية فقط. لا يتم توقيعها أو إرسالها إلى الهيئة.",
              "This draft is for internal review. It is unsigned and is never submitted to ZATCA."
            )}
          </p>
          <DraftControls />
        </>
      )}
    </section>
  );
}
