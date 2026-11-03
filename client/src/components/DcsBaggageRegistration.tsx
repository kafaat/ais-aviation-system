import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  bagRegistrationStorageKey,
  clearBagRegistration,
  observeBagRegistration,
  readBagRegistration,
  recoverBagRegistration,
  saveBagRegistration,
  startBagRegistrationAttempt,
  type BagRegistrationCommand,
  type BagRegistrationScope,
} from "@/lib/baggage-registration-intent";
import {
  OperationalReadState,
  useOperationalLabels,
} from "./OperationalReadState";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { toast } from "sonner";

type Props = {
  flightId: number;
  bookingId: number;
  passengerId: number;
  segmentId: number;
  disabled: boolean;
};

export function DcsBaggageRegistration(props: Props) {
  const { user, loading } = useAuth();
  const l = useOperationalLabels();
  if (loading) return <p role="status">{l("جارٍ التحميل", "Loading")}</p>;
  if (
    !user ||
    !Number.isSafeInteger(user.id) ||
    user.id <= 0 ||
    user.tenantId == null ||
    !Number.isSafeInteger(user.tenantId) ||
    user.tenantId <= 0 ||
    !["admin", "super_admin", "airline_admin", "ops"].includes(user.role)
  ) {
    return (
      <p role="alert">
        {l(
          "يلزم تسجيل الدخول بحساب عمليات تابع للجهة لاسترجاع إيصال الحقيبة.",
          "Sign in with a scoped airline operations account to recover a bag receipt."
        )}
      </p>
    );
  }
  const scope: BagRegistrationScope = {
    actorId: user.id,
    tenantId: user.tenantId,
    bookingId: props.bookingId,
    passengerId: props.passengerId,
    flightId: props.flightId,
    segmentId: props.segmentId,
  };
  return (
    <ScopedBaggageRegistration
      key={bagRegistrationStorageKey(scope)}
      {...props}
      scope={scope}
    />
  );
}

function ScopedBaggageRegistration({
  flightId,
  bookingId,
  passengerId,
  segmentId,
  disabled,
  scope,
}: Props & { scope: BagRegistrationScope }) {
  const l = useOperationalLabels();
  const context = { flightId, bookingId, passengerId, segmentId };
  const query = trpc.baggage.registrationSummary.useQuery(context, {
    retry: false,
  });
  const [receipt, setReceipt] = useState<{
    command: BagRegistrationCommand | null;
    storageError: boolean;
  }>(() => {
    try {
      return {
        command: readBagRegistration(sessionStorage, scope),
        storageError: false,
      };
    } catch {
      return { command: null, storageError: true };
    }
  });
  const pendingReceipt = receipt.command;
  const [weight, setWeight] = useState(
    pendingReceipt ? String(pendingReceipt.weight) : ""
  );
  const [description, setDescription] = useState(
    pendingReceipt?.description ?? ""
  );
  const [specialHandling, setSpecialHandling] = useState(
    pendingReceipt?.specialHandling ?? ""
  );
  const [lastTag, setLastTag] = useState<string | null>(null);
  useEffect(
    () =>
      observeBagRegistration(scope, () => {
        try {
          const command = readBagRegistration(sessionStorage, scope);
          setReceipt({ command, storageError: false });
          setWeight(command ? String(command.weight) : "");
          setDescription(command?.description ?? "");
          setSpecialHandling(command?.specialHandling ?? "");
        } catch {
          setReceipt(current => ({ ...current, storageError: true }));
        }
      }),
    [scope]
  );
  const attemptId = useRef<string | null>(null);
  const mutation = trpc.baggage.register.useMutation({
    onSuccess: (result, command) => {
      attemptId.current = null;
      try {
        clearBagRegistration(sessionStorage, scope, command);
        setReceipt({ command: null, storageError: false });
      } catch {
        setReceipt({ command, storageError: true });
      }
      setLastTag(result.baggage.tagNumber);
      setWeight("");
      setDescription("");
      setSpecialHandling("");
      toast.success(l("سُجلت الحقيبة", "Bag registered"));
      void query.refetch();
    },
    onError: (error, command) => {
      const code = error.data?.code;
      const rejectedAttemptId = attemptId.current;
      attemptId.current = null;
      // Only the latest transaction's definitive rejection may clear an intent.
      // Pre-replay authorization/input errors cannot rule out an earlier commit.
      try {
        if (
          code === "PRECONDITION_FAILED" &&
          rejectedAttemptId &&
          clearBagRegistration(
            sessionStorage,
            scope,
            command,
            rejectedAttemptId
          )
        ) {
          setReceipt({ command: null, storageError: false });
        } else {
          setReceipt({
            command: recoverBagRegistration(sessionStorage, scope, command),
            storageError: false,
          });
        }
      } catch {
        setReceipt({ command, storageError: true });
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
  const commandLocked =
    receipt.storageError || !!pendingReceipt || mutation.isPending;
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
            expectedActorId: scope.actorId,
            expectedTenantId: scope.tenantId,
          };
          setLastTag(null);
          try {
            const command = saveBagRegistration(sessionStorage, scope, {
              ...payload,
              idempotencyKey: crypto.randomUUID(),
            });
            attemptId.current = startBagRegistrationAttempt(
              sessionStorage,
              scope,
              command
            );
            setReceipt({ command, storageError: false });
            mutation.mutate(command);
          } catch {
            setReceipt(current => ({ ...current, storageError: true }));
          }
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
        {receipt.storageError && (
          <p role="alert">
            {l(
              "تعذر استرجاع بيانات إيصال الحقيبة بأمان. التسجيل متوقف؛ راجع رقم الحقيبة الموجود مع العمليات قبل محاولة تسجيلها مجددًا.",
              "Bag receipt recovery data is unavailable or invalid. Registration is blocked; review the existing bag tag with operations before registering it again."
            )}
          </p>
        )}
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
              disabled={mutation.isPending || receipt.storageError}
              onClick={() => {
                try {
                  const command = recoverBagRegistration(
                    sessionStorage,
                    scope,
                    pendingReceipt
                  );
                  attemptId.current = startBagRegistrationAttempt(
                    sessionStorage,
                    scope,
                    command
                  );
                  mutation.mutate(command);
                } catch {
                  setReceipt(current => ({ ...current, storageError: true }));
                }
              }}
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
