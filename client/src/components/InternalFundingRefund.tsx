import { useRef, useState } from "react";
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { useOperationalLabels } from "./OperationalReadState";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Command = inferRouterInputs<AppRouter>["refunds"]["refundInternalFunding"];

export function InternalFundingRefund() {
  const l = useOperationalLabels();
  const [bookingId, setBookingId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [approvalReference, setApprovalReference] = useState("");
  const [cancelItinerary, setCancelItinerary] = useState(false);
  const [validation, setValidation] = useState(false);
  const command = useRef<Command | null>(null);
  const mutation = trpc.refunds.refundInternalFunding.useMutation();
  const submitted = command.current !== null;
  return (
    <section
      className="space-y-3 rounded border p-4"
      aria-label={l("رد التمويل الداخلي", "Internal funding refund")}
    >
      <h2 className="text-xl font-semibold">
        {l("رد التمويل الداخلي", "Internal funding refund")}
      </h2>
      <p>
        {l(
          "يُعاد المبلغ إلى أرصدة المستخدم الأصلية مع بقاء تاريخ انتهاء صلاحيتها، أو إلى ائتمان الشركة. يلزم مرجع اعتماد مالي. الرد الجزئي يُبقي خط السير؛ رد المتبقي كاملًا يستلزم إلغاءه كله.",
          "Returns value to the original user credit lots, retaining their expiry, or to company credit. A finance approval reference is required. Partial refunds retain the itinerary; refunding the entire remainder requires cancelling all of it."
        )}
      </p>
      <form
        className="grid gap-3"
        onSubmit={event => {
          event.preventDefault();
          if (!command.current) {
            const [whole, fraction = ""] = amount.split(".");
            const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
            if (
              !/^\d+(\.\d{1,2})?$/.test(amount) ||
              !Number.isSafeInteger(minor) ||
              minor <= 0 ||
              minor > 2147483647 ||
              !Number.isSafeInteger(Number(bookingId)) ||
              Number(bookingId) <= 0
            ) {
              setValidation(true);
              return;
            }
            command.current = {
              bookingId: Number(bookingId),
              amount: minor,
              reason: reason.trim(),
              approvalReference: approvalReference.trim(),
              cancelItinerary,
              requestId: crypto.randomUUID(),
            };
          }
          setValidation(false);
          mutation.mutate(command.current);
        }}
      >
        <fieldset
          disabled={submitted || mutation.isPending}
          className="grid gap-3"
        >
          <label>
            {l("رقم الحجز", "Booking ID")}
            <Input
              required
              inputMode="numeric"
              pattern="[0-9]+"
              value={bookingId}
              onChange={e => setBookingId(e.target.value)}
            />
          </label>
          <label>
            {l("المبلغ بالريال", "Amount in SAR")}
            <Input
              required
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
          </label>
          <label>
            {l("مرجع الاعتماد المالي", "Finance approval reference")}
            <Input
              required
              minLength={3}
              maxLength={200}
              value={approvalReference}
              onChange={e => setApprovalReference(e.target.value)}
            />
          </label>
          <label>
            {l("سبب الرد", "Refund reason")}
            <Input
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={cancelItinerary}
              onChange={e => setCancelItinerary(e.target.checked)}
            />{" "}
            {l(
              "إلغاء خط السير كاملًا ورد المتبقي",
              "Cancel the entire itinerary and refund the remainder"
            )}
          </label>
        </fieldset>
        {validation && (
          <p role="alert">
            {l(
              "أدخل رقم حجز صحيحًا ومبلغًا موجبًا بمنزلتين عشريتين كحد أقصى.",
              "Enter a valid booking ID and a positive amount with at most two decimal places."
            )}
          </p>
        )}
        {mutation.isError && <p role="alert">{mutation.error.message}</p>}
        {!mutation.isSuccess && (
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending
              ? l("جارٍ التنفيذ", "Processing")
              : submitted
                ? l("إعادة نفس الطلب", "Retry the same request")
                : l("تنفيذ الرد المعتمد", "Execute approved refund")}
          </Button>
        )}
      </form>
      {mutation.isSuccess && mutation.data && (
        <div role="status">
          <p>
            {l("وصل الرد", "Refund receipt")} #{mutation.data.ledgerId}:{" "}
            {(mutation.data.amount / 100).toFixed(2)} SAR
          </p>
          <p>
            {l("المتبقي من التمويل", "Remaining funding")}:{" "}
            {(mutation.data.remaining / 100).toFixed(2)} SAR
          </p>
          <p>
            {mutation.data.cancelled
              ? l("أُلغي خط السير", "Itinerary cancelled")
              : l("خط السير باقٍ", "Itinerary retained")}
          </p>
          <Button
            type="button"
            onClick={() => {
              command.current = null;
              mutation.reset();
              setAmount("");
              setReason("");
              setApprovalReference("");
              setCancelItinerary(false);
            }}
          >
            {l("طلب رد جديد", "New refund request")}
          </Button>
        </div>
      )}
    </section>
  );
}
