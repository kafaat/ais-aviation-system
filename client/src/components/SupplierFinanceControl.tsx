import { useRef, useState } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { useOperationalLabels } from "./OperationalReadState";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Command = inferRouterInputs<AppRouter>["supplierFinance"]["record"];
type Review = inferRouterOutputs<AppRouter>["supplierFinance"]["review"];

export function SupplierFinanceControl() {
  const l = useOperationalLabels();
  const utils = trpc.useUtils();
  const [supplierRef, setSupplier] = useState(""),
    [invoiceRef, setInvoice] = useState("");
  const [review, setReview] = useState<Review | null>(null),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState("");
  const [action, setAction] = useState<Command["action"]>("bank_change");
  const [vaultRef, setVault] = useState(""),
    [lastFour, setLastFour] = useState(""),
    [amount, setAmount] = useState("");
  const pending = useRef<Command | null>(null);
  const [retry, setRetry] = useState(false);
  const mutate = trpc.supplierFinance.record.useMutation();
  const busy = loading || mutate.isPending;
  async function load() {
    setLoading(true);
    setReview(null);
    setMessage("");
    try {
      const state = await utils.supplierFinance.review.fetch(
        { supplierRef, invoiceRef: invoiceRef || undefined },
        { staleTime: 0 }
      );
      setReview(state);
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : l("تعذر جلب السجل", "Review unavailable")
      );
    } finally {
      setLoading(false);
    }
  }
  async function submit() {
    if (!review || busy) return;
    const base = {
      supplierRef,
      bankVersion: review.bankVersion,
      requestId: crypto.randomUUID(),
    };
    if (!pending.current) {
      if (action === "bank_change")
        pending.current = { ...base, action, vaultRef, lastFour };
      else if (action === "bank_approved")
        pending.current = { ...base, action };
      else {
        const amountMinor =
          action === "payout_approved"
            ? review.invoice?.amountMinor
            : Number(amount);
        if (
          !invoiceRef ||
          !amountMinor ||
          !Number.isSafeInteger(amountMinor) ||
          amountMinor < 1
        ) {
          setMessage(
            l(
              "أدخل معرف الفاتورة ومبلغاً صحيحاً بالهللات",
              "Enter an invoice UUID and a positive amount in halalas."
            )
          );
          return;
        }
        pending.current = { ...base, action, invoiceRef, amountMinor };
      }
    }
    try {
      const result = await mutate.mutateAsync(pending.current);
      pending.current = null;
      setRetry(false);
      setVault("");
      setLastFour("");
      setAmount("");
      await load();
      setMessage(
        l("إيصال داخلي رقم", "Internal receipt") + " " + result.receiptId
      );
    } catch (e) {
      setRetry(true);
      setMessage(
        e instanceof Error ? e.message : l("تعذرت العملية", "Operation failed")
      );
    }
  }
  const locked = busy || retry;
  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="text-xl font-semibold">
        {l("اعتمادات الموردين", "Supplier approvals")}
      </h2>
      <p>
        {l(
          "أدخل مراجع UUID من سجل المورّد وخزنة البنك. الموافقة داخلية ولا تحوّل أموالاً. يؤدي أي تغيير في الحساب إلى إبطال صلاحية اعتمادات النسخة السابقة.",
          "Use UUID references from the supplier master and bank vault. Approval is internal; no transfer is sent. A new bank version invalidates previous approvals."
        )}
      </p>
      <form
        className="grid gap-2"
        onSubmit={e => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          {l("مرجع المورد", "Supplier UUID")}
          <Input
            required
            disabled={locked}
            value={supplierRef}
            onChange={e => {
              setSupplier(e.target.value.trim());
              setReview(null);
            }}
          />
        </label>
        <label>
          {l("مرجع الفاتورة للصرف", "Invoice UUID for payout")}
          <Input
            disabled={locked}
            value={invoiceRef}
            onChange={e => {
              setInvoice(e.target.value.trim());
              setReview(null);
            }}
          />
        </label>
        <Button disabled={locked}>
          {l("مراجعة نسخة الحساب", "Review bank version")}
        </Button>
      </form>
      {review && (
        <>
          <p>
            {l("النسخة", "Version")} {review.bankVersion} ·{" "}
            {l("آخر أربعة أرقام", "Last four")} {review.lastFour ?? "—"} ·{" "}
            {review.bankApproved
              ? l("حساب معتمد", "Bank approved")
              : l("بانتظار اعتماد الحساب", "Bank unapproved")}
          </p>
          {review.bankFingerprint && (
            <p className="break-all">
              {l(
                "بصمة مرجع الخزنة للمطابقة المستقلة",
                "Vault reference fingerprint for independent review"
              )}{" "}
              <code dir="ltr">{review.bankFingerprint}</code>
            </p>
          )}
          {review.invoice && (
            <p>
              {l("حالة الفاتورة", "Invoice status")}: {review.invoice.status} ·{" "}
              {review.invoice.amountMinor} {l("هللة", "SAR halalas")} ·{" "}
              {l("نسخة البنك", "Bank version")} {review.invoice.bankVersion}
            </p>
          )}
          <form
            className="grid gap-2"
            onSubmit={e => {
              e.preventDefault();
              void submit();
            }}
          >
            <label>
              {l("القرار", "Decision")}{" "}
              <select
                disabled={locked}
                value={action}
                onChange={e => setAction(e.target.value as Command["action"])}
              >
                <option value="bank_change">
                  {l("تسجيل تغيير الحساب", "Record bank change")}
                </option>
                <option value="bank_approved">
                  {l("اعتماد نسخة الحساب", "Approve bank version")}
                </option>
                <option value="payout_request">
                  {l("طلب صرف داخلي", "Request internal payout")}
                </option>
                <option value="payout_approved">
                  {l("اعتماد طلب الصرف", "Approve requested payout")}
                </option>
              </select>
            </label>
            {action === "bank_change" && (
              <>
                <label>
                  {l("مرجع الخزنة UUID", "Bank vault UUID")}
                  <Input
                    required
                    disabled={locked}
                    value={vaultRef}
                    onChange={e => setVault(e.target.value.trim())}
                  />
                </label>
                <label>
                  {l("آخر أربعة أرقام فقط", "Last four digits only")}
                  <Input
                    required
                    disabled={locked}
                    maxLength={4}
                    pattern="[0-9]{4}"
                    value={lastFour}
                    onChange={e => setLastFour(e.target.value)}
                  />
                </label>
              </>
            )}
            {action === "payout_request" && (
              <label>
                {l("المبلغ بالهللات السعودية", "Amount in SAR halalas")}
                <Input
                  required
                  disabled={locked}
                  type="number"
                  min="1"
                  max="2147483647"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                />
              </label>
            )}
            <Button
              disabled={
                busy ||
                (action === "payout_approved" &&
                  review.invoice?.status !== "requested")
              }
            >
              {retry
                ? l("إعادة نفس الطلب", "Retry same request")
                : l("تسجيل القرار", "Record decision")}
            </Button>
          </form>
          {retry && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                pending.current = null;
                setRetry(false);
                void load();
              }}
            >
              {l(
                "إعادة جلب السجل قبل قرار جديد",
                "Reload evidence before a new decision"
              )}
            </Button>
          )}
          <details>
            <summary>{l("آخر 50 قراراً", "Latest 50 decisions")}</summary>
            <ul>
              {review.history.map(item => (
                <li key={item.id}>
                  #{item.id} · {item.action} · {l("النسخة", "version")}{" "}
                  {item.bankVersion} · {l("الموظف", "actor")} {item.actorId}
                  {item.supersededByReceiptId && (
                    <>
                      {" "}
                      ·{" "}
                      {l(
                        "أبطلته عملية تغيير البنك رقم",
                        "Superseded by bank change receipt"
                      )}{" "}
                      #{item.supersededByReceiptId}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
