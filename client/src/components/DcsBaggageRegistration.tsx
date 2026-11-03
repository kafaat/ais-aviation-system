import { useState } from "react";
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { useCommandIdempotencyKey } from "@/hooks/useCommandIdempotencyKey";
import {
  OperationalReadState,
  useOperationalLabels,
} from "./OperationalReadState";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { toast } from "sonner";

type BagCommand = inferRouterInputs<AppRouter>["baggage"]["register"];

export function DcsBaggageRegistration({
  flightId,
  bookingId,
  passengerId,
  segmentId,
  disabled,
}: {
  flightId: number;
  bookingId: number;
  passengerId: number;
  segmentId: number;
  disabled: boolean;
}) {
  const l = useOperationalLabels();
  const context = { flightId, bookingId, passengerId, segmentId };
  const query = trpc.baggage.registrationSummary.useQuery(context, {
    retry: false,
  });
  const [weight, setWeight] = useState("");
  const [description, setDescription] = useState("");
  const [specialHandling, setSpecialHandling] = useState("");
  const [lastTag, setLastTag] = useState<string | null>(null);
  const [pendingReceipt, setPendingReceipt] = useState<BagCommand | null>(null);
  const key = useCommandIdempotencyKey();
  const mutation = trpc.baggage.register.useMutation({
    onSuccess: result => {
      key.clear();
      setPendingReceipt(null);
      setLastTag(result.baggage.tagNumber);
      setWeight("");
      setDescription("");
      setSpecialHandling("");
      toast.success(l("سُجلت الحقيبة", "Bag registered"));
      void query.refetch();
    },
    onError: (error, command) => {
      const code = error.data?.code;
      // A business rejection from the transaction means it did not commit.
      // An unavailable response, or loss of authorization during recovery,
      // does not establish what happened to the original command.
      if (
        code === "PRECONDITION_FAILED" ||
        (!pendingReceipt &&
          (code === "BAD_REQUEST" ||
            code === "FORBIDDEN" ||
            code === "UNAUTHORIZED" ||
            code === "NOT_FOUND" ||
            code === "TOO_MANY_REQUESTS"))
      ) {
        setPendingReceipt(null);
        key.clear();
      } else {
        setPendingReceipt(command);
      }
      void query.refetch();
      toast.error(error.message);
    },
  });
  const summary = query.data;
  const weightKg = Number(weight);
  const weightGrams = Math.round(weightKg * 1000);
  const validWeight =
    weight.trim() !== "" &&
    Number.isFinite(weightKg) &&
    weightKg > 0 &&
    weightKg <= 32 &&
    Math.abs(weightKg * 100 - Math.round(weightKg * 100)) < 0.000001;
  const overAllowance =
    summary?.remainingWeightGrams != null &&
    weightGrams > summary.remainingWeightGrams;
  const commandLocked = !!pendingReceipt || mutation.isPending;
  const unavailable =
    commandLocked ||
    disabled ||
    query.isFetching ||
    !!query.error ||
    !summary ||
    summary.requiresOperationalReview ||
    !validWeight ||
    overAllowance;
  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      aria-label={l("تسجيل أمتعة الراكب", "Passenger baggage registration")}
    >
      <h3 className="text-lg font-semibold">
        {l("أمتعة القطاع المحدد", "Baggage for this segment")}
      </h3>
      <OperationalReadState query={query}>
        {summary && (
          <>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt>{l("الوزن المسموح", "Allowance")}</dt>
                <dd className="font-semibold">
                  {summary.allowanceWeightGrams / 1000} {l("كجم", "kg")}
                </dd>
              </div>
              <div>
                <dt>{l("الوزن المسجل", "Registered")}</dt>
                <dd className="font-semibold">
                  {summary.registeredWeightGrams === null
                    ? "—"
                    : `${summary.registeredWeightGrams / 1000} ${l("كجم", "kg")}`}
                </dd>
              </div>
              <div>
                <dt>{l("المتبقي", "Remaining")}</dt>
                <dd className="font-semibold">
                  {summary.remainingWeightGrams === null
                    ? "—"
                    : `${summary.remainingWeightGrams / 1000} ${l("كجم", "kg")}`}
                </dd>
              </div>
            </dl>
            {summary.requiresOperationalReview && (
              <p role="alert">
                {l(
                  "تعذر تأكيد استحقاق الأمتعة أو سلامة سجلاتها لهذا القطاع. يلزم مراجعة تشغيلية قبل إضافة حقيبة.",
                  "The baggage allowance or existing baggage records could not be verified for this segment. Operational review is required before adding a bag."
                )}
              </p>
            )}
            {summary.bags.length > 0 && (
              <ul className="space-y-1 text-sm">
                {summary.bags.map(bag => (
                  <li key={bag.id}>
                    <span dir="ltr" className="font-mono">
                      {bag.tagNumber}
                    </span>{" "}
                    · {bag.weightGrams === null ? "—" : bag.weightGrams / 1000}{" "}
                    {l("كجم", "kg")} · {bag.status}
                    {bag.legacy && (
                      <span> · {l("سجل سابق", "Legacy record")}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </OperationalReadState>
      <form
        className="space-y-3"
        onSubmit={event => {
          event.preventDefault();
          if (unavailable) return;
          const payload = {
            ...context,
            weight: weightKg,
            description: description.trim() || undefined,
            specialHandling: specialHandling.trim() || undefined,
          };
          setLastTag(null);
          mutation.mutate({
            ...payload,
            idempotencyKey: key.forPayload(payload),
          });
        }}
      >
        <label className="block space-y-1">
          <span>{l("وزن الحقيبة بالكيلوجرام", "Bag weight in kilograms")}</span>
          <Input
            disabled={commandLocked}
            type="number"
            inputMode="decimal"
            required
            min="0.01"
            max="32"
            step="0.01"
            value={weight}
            onChange={e => setWeight(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span>
            {l("وصف الحقيبة (اختياري)", "Bag description (optional)")}
          </span>
          <Input
            disabled={commandLocked}
            value={description}
            maxLength={500}
            onChange={e => setDescription(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span>
            {l(
              "تعليمات المناولة (اختياري)",
              "Handling instructions (optional)"
            )}
          </span>
          <Input
            disabled={commandLocked}
            value={specialHandling}
            maxLength={255}
            onChange={e => setSpecialHandling(e.target.value)}
          />
        </label>
        {!pendingReceipt && overAllowance && (
          <p role="alert">
            {l(
              "الوزن يتجاوز المتبقي لهذا الراكب على هذا القطاع",
              "Weight exceeds this passenger's remaining allowance on this segment"
            )}
          </p>
        )}
        {disabled && (
          <p className="text-sm text-muted-foreground">
            {l(
              "يتاح قبول الحقيبة بعد تسجيل الراكب، ما دام التسجيل مفتوحًا والراكب مسموحًا له بالصعود ولم يصعد بعد.",
              "Bag acceptance is available after passenger check-in, while check-in is open and the passenger is allowed to board and has not boarded yet."
            )}
          </p>
        )}
        <Button type="submit" disabled={unavailable}>
          {l("تسجيل الحقيبة المستلمة", "Register received bag")}
        </Button>
        {pendingReceipt && (
          <div className="space-y-2">
            <p>
              {l(
                "لم يتأكد استلام إيصال هذه الحقيبة. أعد إرسال الطلب نفسه لاسترجاع رقمها.",
                "The bag receipt is unconfirmed. Retry the same registration to recover its tag."
              )}
            </p>
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(pendingReceipt)}
            >
              {l("استرجاع إيصال الحقيبة", "Recover bag receipt")}
            </Button>
          </div>
        )}
        {mutation.error && <p role="alert">{mutation.error.message}</p>}
        {lastTag && (
          <p role="status">
            {l("رقم الحقيبة المسجلة", "Registered bag tag")}:{" "}
            <span dir="ltr" className="font-mono">
              {lastTag}
            </span>
          </p>
        )}
      </form>
    </section>
  );
}
