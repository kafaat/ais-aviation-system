import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { useOperationalLabels } from "./OperationalReadState";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";

type Review = inferRouterOutputs<AppRouter>["weightBalance"]["reviewFlight"];

export function ControlledLoadSheetReview() {
  const l = useOperationalLabels(),
    [draftId, setDraftId] = useState(""),
    [flightId, setFlightId] = useState(0);
  const query = trpc.weightBalance.reviewFlight.useQuery(
    { flightId },
    { enabled: flightId > 0, retry: false }
  );
  return (
    <Card className="space-y-4 p-4">
      <h2 className="font-semibold">
        {l(
          "مراجعة مسودة الحمولة حسب تسجيل الطائرة",
          "Review a load sheet by aircraft registration"
        )}
      </h2>
      <p>
        {l(
          "بيئة تدريب. قبول الإرسال التشغيلي يتطلب إجراء المشغّل المستقل.",
          "Training environment. Dispatch acceptance requires the operator’s separate procedure."
        )}
      </p>
      <form
        className="flex items-end gap-3"
        onSubmit={event => {
          event.preventDefault();
          if (+draftId === flightId) void query.refetch();
          else setFlightId(+draftId);
        }}
      >
        <label>
          {l("معرّف الرحلة", "Flight ID")}
          <Input
            required
            type="number"
            min="1"
            step="1"
            value={draftId}
            onChange={e => {
              setDraftId(e.target.value);
              if (+e.target.value !== flightId) setFlightId(0);
            }}
          />
        </label>
        <Button disabled={!draftId || query.isFetching}>
          {l("قراءة الحالة الحالية", "Read current flight")}
        </Button>
      </form>
      {query.error && <p role="alert">{query.error.message}</p>}
      {flightId > 0 && !query.error && query.data?.flightId === flightId && (
        <DraftControls
          key={[
            flightId,
            query.data.assignment?.id,
            query.data.edition,
            query.data.status,
          ].join("/")}
          state={query.data}
          refresh={() => query.refetch()}
        />
      )}
    </Card>
  );
}

const fields = [
  ["trafficLoadKg", "وزن الحمولة التجارية (كغ)", "Traffic load (kg)"],
  ["trafficIndex", "مؤشر الحمولة التجارية", "Traffic index"],
  ["takeoffFuelKg", "وقود الإقلاع (كغ)", "Takeoff fuel (kg)"],
  ["takeoffFuelIndex", "مؤشر وقود الإقلاع", "Takeoff fuel index"],
  ["tripFuelKg", "وقود الرحلة (كغ)", "Trip fuel (kg)"],
  ["tripFuelIndex", "مؤشر وقود الرحلة", "Trip fuel index"],
] as const;

function DraftControls({
  state,
  refresh,
}: {
  state: Review;
  refresh: () => Promise<unknown>;
}) {
  const l = useOperationalLabels();
  const [reg, setReg] = useState(""),
    [reason, setReason] = useState(""),
    [profile, setProfile] = useState("");
  const assign = trpc.weightBalance.assignAircraft.useMutation({
    onSuccess: refresh,
  });
  const evaluate = trpc.weightBalance.evaluateDraft.useMutation({
    onSuccess: refresh,
  });
  const verify = trpc.weightBalance.verifyCurrentDraft.useQuery(
    { flightId: state.flightId, edition: state.edition },
    { enabled: false, retry: false }
  );
  const busy = assign.isPending || evaluate.isPending || verify.isFetching;
  const revision = {
    flightId: state.flightId,
    expectedEdition: state.edition,
    expectedAssignmentEventId: state.assignment?.id ?? null,
  };
  const statuses = {
    draft: l("مسودة تتجاوز الحدود", "Draft outside limits"),
    signed_draft: l("مسودة موقّعة داخلياً", "Internally signed draft"),
    superseded: l(
      "نسخة ملغاة تتطلب إعادة الحساب",
      "Superseded edition; recalculate"
    ),
  };
  return (
    <section className="space-y-4">
      <p role="status">
        {state.flightNumber} · {l("تسجيل", "Registration")}{" "}
        {state.registrationId ?? "—"} · {l("الإصدار", "Edition")}{" "}
        {state.edition} ·{" "}
        {state.status
          ? statuses[state.status]
          : l("لم تُصدر مسودة", "No draft issued")}
      </p>
      {state.assignment && (
        <p>
          {l("مسؤول آخر تغيير", "Last changed by")} #{state.assignment.userId} ·{" "}
          {state.assignment.reason}
        </p>
      )}
      {state.status === "draft" && state.violations.length > 0 && (
        <ul role="alert">
          {state.violations.map(violation => (
            <li key={violation}>{violation}</li>
          ))}
        </ul>
      )}
      {state.evaluatedBy && (
        <p>
          {l("راجع المسودة", "Draft reviewed by")} #{state.evaluatedBy}
        </p>
      )}
      <form
        className="space-y-2"
        onSubmit={e => {
          e.preventDefault();
          assign.mutate({
            ...revision,
            expectedRegistrationId: state.registrationId,
            registrationId: +reg,
            reason: reason.trim(),
          });
        }}
      >
        <label>
          {l("معرّف تسجيل الطائرة الجديد", "New aircraft registration ID")}
          <Input
            type="number"
            required
            min="1"
            step="1"
            value={reg}
            onChange={e => setReg(e.target.value)}
          />
        </label>
        <label>
          {l(
            "سبب إسناد الطائرة أو تبديلها",
            "Reason for aircraft assignment or swap"
          )}
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
        </label>
        <Button
          disabled={
            busy || !reason.trim() || !reg || +reg === state.registrationId
          }
        >
          {l(
            "تسجيل الإسناد وإبطال المسودة السابقة",
            "Record assignment and supersede prior draft"
          )}
        </Button>
      </form>
      {state.registrationId !== null && (
        <form
          className="space-y-2"
          onSubmit={e => {
            e.preventDefault();
            if (state.registrationId === null) return;
            const form = new FormData(e.currentTarget);
            const value = (name: (typeof fields)[number][0]) =>
              Number(form.get(name));
            evaluate.mutate({
              ...revision,
              registrationId: state.registrationId,
              profileId: +profile,
              load: {
                trafficLoadKg: value("trafficLoadKg"),
                trafficIndex: value("trafficIndex"),
                takeoffFuelKg: value("takeoffFuelKg"),
                takeoffFuelIndex: value("takeoffFuelIndex"),
                tripFuelKg: value("tripFuelKg"),
                tripFuelIndex: value("tripFuelIndex"),
              },
            });
          }}
        >
          <label>
            {l("معرّف ملف التوازن المعتمد", "Accepted balance profile ID")}
            <Input
              required
              type="number"
              step="1"
              min="1"
              value={profile}
              onChange={e => setProfile(e.target.value)}
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map(([name, ar, en]) => (
              <label key={name}>
                {l(ar, en)}
                <Input
                  name={name}
                  type="number"
                  step="any"
                  min={name.endsWith("Kg") ? 0 : undefined}
                  required
                />
              </label>
            ))}
          </div>
          <Button disabled={busy || !profile}>
            {l(
              "إعادة الحساب وحفظ مسودة جديدة",
              "Recalculate and save a new draft"
            )}
          </Button>
        </form>
      )}
      {state.status === "signed_draft" && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void verify.refetch()}
        >
          {l("فحص توقيع الإصدار الحالي", "Verify current draft signature")}
        </Button>
      )}
      {verify.data && !verify.isFetching && !verify.error && (
        <p role="status">
          {l("بصمة المسودة المتحقَّق منها", "Verified draft digest")}{" "}
          <code dir="ltr">{verify.data.digestSha256}</code>
          {" · "}
          <time dateTime={new Date(verify.dataUpdatedAt).toISOString()}>
            {new Date(verify.dataUpdatedAt).toLocaleString()}
          </time>
        </p>
      )}
      {(assign.error || evaluate.error || verify.error) && (
        <p role="alert">
          {(assign.error || evaluate.error || verify.error)?.message}{" "}
          <Button variant="outline" onClick={() => void refresh()}>
            {l("تحديث بيانات الرحلة", "Refresh flight data")}
          </Button>
        </p>
      )}
    </section>
  );
}
