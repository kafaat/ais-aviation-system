import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { z } from "zod";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
const signedDocument = z.object({
  envelope: z.object({
    sourceId: z.string(),
    eventId: z.string(),
    issuedAt: z.string(),
    observedAt: z.string(),
    flightId: z.number().nullable(),
    kind: z.string(),
    payload: z.record(z.string(), z.unknown()),
  }),
  signature: z.string(),
});
export default function OperationsControl() {
  const { i18n } = useTranslation();
  const l = (ar: string, en: string) =>
    i18n.language.startsWith("ar") ? ar : en;
  const data = trpc.operations.dashboard.useQuery(undefined, {
    refetchInterval: 15000,
  });
  const plans = trpc.irops.recoveryPlans.useQuery();
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const [eventId, setEventId] = useState("");
  const [bookingIds, setBookingIds] = useState("");
  const [candidateIds, setCandidateIds] = useState("");
  const [flightId, setFlightId] = useState("");
  const [tail, setTail] = useState("");
  const [premiumId, setPremiumId] = useState("");
  const [premiumQuery, setPremiumQuery] = useState("");
  const [economicsFlight, setEconomicsFlight] = useState(0);
  const refresh = () => {
    void utils.operations.dashboard.invalidate();
    void utils.irops.recoveryPlans.invalidate();
  };
  const onError = (e: { message: string }) => toast.error(e.message);
  const onSuccess = () => {
    toast.success(l("حُفظ إيصال العملية", "Operation receipt saved"));
    refresh();
  };
  const replay = trpc.operations.replayEvent.useMutation({
    onError,
    onSuccess,
  });
  const retry = trpc.operations.retryCancellation.useMutation({
    onError,
    onSuccess,
  });
  const acknowledge = trpc.operations.acknowledgeAlert.useMutation({
    onError,
    onSuccess,
  });
  const propose = trpc.irops.proposeRecovery.useMutation({
    onError,
    onSuccess,
  });
  const approve = trpc.irops.approveRecovery.useMutation({
    onError,
    onSuccess,
  });
  const execute = trpc.irops.executeRecovery.useMutation({
    onError,
    onSuccess,
  });
  const rotation = trpc.aviationIntegrations.assignRotation.useMutation({
    onError,
    onSuccess,
  });
  const crewRules = trpc.aviationIntegrations.acceptCrewRules.useMutation({
    onError,
    onSuccess,
  });
  const maintenance = trpc.aviationIntegrations.ingestMaintenance.useMutation({
    onError,
    onSuccess,
  });
  const economics = trpc.aviationIntegrations.flightEconomics.useQuery(
    { flightId: economicsFlight },
    { enabled: economicsFlight > 0 }
  );
  const premium = trpc.aviationIntegrations.premiumResults.useQuery(
    { id: premiumQuery },
    { enabled: z.uuid().safeParse(premiumQuery).success }
  );
  const ids = (s: string) => s.split(",").map(v => Number(v.trim()));
  const time = (d: Date | null) =>
    d ? new Date(d).toLocaleString(i18n.language) : l("غير معروف", "Unknown");
  const state = (s: string) =>
    ({
      healthy: l("سليم", "Healthy"),
      degraded: l("متأثر", "Degraded"),
      unknown: l("غير معروف", "Unknown"),
      stopped: l("متوقف", "Stopped"),
      pending: l("بانتظار المعالجة", "Pending"),
      processing: l("قيد التنفيذ", "Processing"),
      failed: l("فشل", "Failed"),
      processed: l("مكتمل", "Processed"),
      queued: l("في الانتظار", "Queued"),
      planned: l("مخطط", "Planned"),
      review_required: l("يحتاج مراجعة", "Review required"),
    })[s] ?? s;
  return (
    <main
      className="container py-8 space-y-6"
      dir={i18n.language.startsWith("ar") ? "rtl" : "ltr"}
    >
      <Link href="/admin">{l("الإدارة", "Administration")}</Link>
      <h1 className="text-3xl font-bold">
        {l("مراقبة التكامل والتشغيل", "Integration and operations control")}
      </h1>
      <p>
        {l(
          "القياسات أدناه محفوظة من الاستجابات ونبضات العامل. غياب القياس يعني أن الحالة غير معروفة؛ ولا يثبت اعتماد مزوّد خارجي.",
          "These observations persist response and worker checks. Missing observations mean unknown status; they do not establish external provider acceptance."
        )}
      </p>
      <nav className="flex gap-5 flex-wrap">
        <Link href="/admin/irops">
          {l("حماية الركاب", "Passenger protection")}
        </Link>
        <Link href="/admin/crew-assignment">
          {l("تعيين الطاقم", "Crew assignment")}
        </Link>
        <Link href="/admin/seat-economics">
          {l("اقتصاديات المقاعد", "Seat economics")}
        </Link>
      </nav>
      {data.error && <p role="alert">{data.error.message}</p>}
      {data.isLoading && (
        <p>{l("جارٍ تحميل الأدلة…", "Loading observations…")}</p>
      )}
      {data.data && (
        <>
          <Card className="p-5 space-y-3">
            <h2 className="text-xl font-semibold">
              {l("المراقبة في آخر 15 دقيقة", "Observations over 15 minutes")}
            </h2>
            <p>
              {l("الاستجابات", "Responses")}: {data.data.observations.requests}{" "}
              · {l("الأخطاء", "Errors")}: {data.data.observations.errors} ·{" "}
              {l("متوسط الزمن بالملّي ثانية", "Mean response ms")}:{" "}
              {data.data.observations.meanResponseMs?.toFixed(1) ?? "—"}
            </p>
            <ul>
              {data.data.observations.instances.map(i => (
                <li key={i.instanceId}>
                  {i.component} {i.instanceId.slice(0, 8)}: {state(i.status)} ·{" "}
                  {time(i.lastSeenAt)}
                </li>
              ))}
            </ul>
            {!data.data.observations.instances.length && (
              <p>{l("لا توجد قياسات حديثة", "No recent observations")}</p>
            )}
            {data.data.alerts.map(a => (
              <div
                key={a.key}
                role="status"
                className="border rounded p-3 my-2"
              >
                <p>{a.message}</p>
                <small>{time(a.firstObservedAt)}</small>
                <Button
                  className="mx-3"
                  size="sm"
                  disabled={a.acknowledgedBy !== null || acknowledge.isPending}
                  onClick={() => acknowledge.mutate({ key: a.key })}
                >
                  {l("تأكيد الاطلاع", "Acknowledge")}
                </Button>
              </div>
            ))}
          </Card>
          <Card className="p-5 space-y-3">
            <h2 className="text-xl font-semibold">
              {l("إعادة المحاولة بعد المراجعة", "Retry after review")}
            </h2>
            <Label htmlFor="retry-reason">
              {l("سبب إعادة المحاولة", "Review reason")}
            </Label>
            <Input
              id="retry-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={500}
            />
            <p>
              {l(
                "الآثار المكتملة تحتفظ بإيصالاتها عند الإعادة. طلب مالي قائم لا يُستبدل بطلب جديد.",
                "Completed effects retain their receipts on replay. Existing financial requests require reconciliation."
              )}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-start">
                <thead>
                  <tr>
                    <th>{l("الحدث", "Event")}</th>
                    <th>{l("الحالة والمستهلكون", "Status and consumers")}</th>
                    <th>{l("الإجراء", "Action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.events.map(e => (
                    <tr key={e.eventId} className="border-t">
                      <td className="p-3">
                        {e.eventType}
                        <br />
                        <small>{e.eventId}</small>
                      </td>
                      <td className="p-3">
                        {state(e.status)} · {e.attempts}
                        <ul>
                          {e.consumers.map(c => (
                            <li key={c.consumer}>
                              {c.consumer}: {state(c.status)}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        <Button
                          size="sm"
                          disabled={
                            reason.trim().length < 5 ||
                            replay.isPending ||
                            (e.status !== "failed" &&
                              !(
                                e.status === "processing" &&
                                e.lockedAt &&
                                Date.now() - new Date(e.lockedAt).getTime() >
                                  300000
                              ))
                          }
                          onClick={() =>
                            replay.mutate({ eventId: e.eventId, reason })
                          }
                        >
                          {l("إعادة التسليم", "Replay delivery")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="font-semibold">
              {l(
                "استردادات الإلغاء غير المكتملة",
                "Incomplete cancellation refunds"
              )}
            </h3>
            {data.data.refunds.map(r => (
              <div className="border-t py-3" key={r.id}>
                {l("الحجز", "Booking")} {r.bookingId} · {l("الرحلة", "Flight")}{" "}
                {r.flightId}: {state(r.status)} · {r.errorCode}
                <Button
                  className="mx-3"
                  size="sm"
                  disabled={
                    reason.trim().length < 5 ||
                    r.status !== "review_required" ||
                    retry.isPending
                  }
                  onClick={() => retry.mutate({ jobId: r.id, reason })}
                >
                  {l("إعادة فحص التمويل", "Recheck funding")}
                </Button>
              </div>
            ))}
          </Card>
          <Card className="p-5 space-y-3">
            <h2 className="text-xl font-semibold">
              {l("المصادر والمهام", "Sources and scheduled work")}
            </h2>
            <details>
              <summary>
                {l(
                  "مسؤولية المجالات والمناوبة",
                  "Domain accountability and on-call"
                )}
              </summary>
              {data.data.ownership.map(d => (
                <p key={d.domain}>
                  {d.domain}:{" "}
                  {d.accountableOwner ??
                    l("لم يُعيّن مسؤول", "Owner unassigned")}{" "}
                  · {d.onCall ?? l("لم تُعيّن مناوبة", "On-call unassigned")}
                </p>
              ))}
            </details>
            {!data.data.sources.length && (
              <p>
                {l(
                  "لم تُسجّل مصادر طيران لهذه الجهة",
                  "No aviation sources registered for this scope"
                )}
              </p>
            )}
            {data.data.sources.map(s => (
              <p key={s.sourceId}>
                {s.sourceId}:{" "}
                {s.authorized
                  ? l("تفويض قائم", "Currently authorized")
                  : l("تفويض غير متاح", "Authorization unavailable")}{" "}
                · {l("آخر رصد", "Last observation")}: {time(s.lastObservedAt)} ·{" "}
                {l("انتهاء التفويض", "Authorization expires")}:{" "}
                {time(new Date(s.validUntil))}
              </p>
            ))}
            <details>
              <summary>
                {l("نجاح المهام المجدولة", "Scheduled task receipts")}
              </summary>
              {data.data.scheduledTasks.map(t => (
                <p key={t.name}>
                  {t.name}: {time(t.lastSuccessAt)}{" "}
                  {t.lastError && `· ${t.lastError}`}
                </p>
              ))}
            </details>
            <details>
              <summary>
                {l(
                  "حالة القدرات ودليل جاهزيتها",
                  "Capability implementation and readiness"
                )}
              </summary>
              {data.data.capabilities.map(c => (
                <p className="py-2" key={c.id}>
                  {c.id}: {c.implementation} ·{" "}
                  {c.deploymentReady === null
                    ? l(
                        "دليل النشر غير متاح",
                        "Deployment evidence unavailable"
                      )
                    : c.deploymentReady
                      ? l(
                          "رُصدت متطلبات التشغيل المحلية",
                          "Local operation observed"
                        )
                      : l("غير جاهز", "Not ready")}
                  <br />
                  <small>{c.requirement}</small>
                </p>
              ))}
            </details>
          </Card>
        </>
      )}
      <Card className="p-5 space-y-4">
        <h2 className="text-xl font-semibold">
          {l("اقتراح التعافي واعتماده", "Propose and approve recovery")}
        </h2>
        <p>
          {l(
            "أنشئ حماية الركاب أولًا. يفحص الاقتراح الحجز والمقاعد والطائرة والطاقم؛ ويتكرر الفحص قبل التنفيذ.",
            "Create passenger protection first. Proposals check bookings, seats, aircraft and crew, then recheck before execution."
          )}
        </p>
        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={e => {
            e.preventDefault();
            propose.mutate({
              eventId: Number(eventId),
              bookingIds: ids(bookingIds),
              candidateFlightIds: ids(candidateIds),
            });
          }}
        >
          <Label>
            {l("معرّف الاضطراب", "Disruption ID")}
            <Input
              value={eventId}
              onChange={e => setEventId(e.target.value)}
              required
            />
          </Label>
          <Label>
            {l(
              "معرّفات الحجوزات مفصولة بفاصلة",
              "Booking IDs, comma separated"
            )}
            <Input
              value={bookingIds}
              onChange={e => setBookingIds(e.target.value)}
              required
            />
          </Label>
          <Label>
            {l(
              "الرحلات البديلة مفصولة بفاصلة",
              "Candidate flight IDs, comma separated"
            )}
            <Input
              value={candidateIds}
              onChange={e => setCandidateIds(e.target.value)}
              required
            />
          </Label>
          <Button disabled={propose.isPending}>
            {l("حساب الاقتراح", "Calculate proposal")}
          </Button>
        </form>
        {plans.error && <p role="alert">{plans.error.message}</p>}
        {plans.data?.map(p => (
          <div key={p.id} className="border rounded p-4 space-y-2">
            <p>
              {l("الخطة", "Plan")} {p.id} · {p.status} · {l("تنتهي", "Expires")}
              : {time(p.expiresAt)}
            </p>
            <p>
              {l("مسافرون دون بديل", "Unassigned passengers")}:{" "}
              {p.unassignedPassengers} ·{" "}
              {l(
                "دقائق التأخير الإجمالية للركاب",
                "Total passenger delay minutes"
              )}
              : {p.passengerDelayMinutes}
            </p>
            <ul>
              {p.choices.map(c => (
                <li key={c.bookingId}>
                  {c.bookingId} → {c.key ?? l("لا بديل", "Unassigned")}
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              disabled={
                p.status !== "proposed" ||
                new Date(p.expiresAt) <= new Date() ||
                approve.isPending
              }
              onClick={() => approve.mutate({ id: p.id, digest: p.digest })}
            >
              {l("اعتماد الخيارات المعروضة", "Approve displayed choices")}
            </Button>{" "}
            <Button
              size="sm"
              disabled={
                p.status !== "approved" ||
                new Date(p.expiresAt) <= new Date() ||
                execute.isPending
              }
              onClick={() => execute.mutate({ id: p.id, digest: p.digest })}
            >
              {l("تنفيذ الخطة المعتمدة", "Execute approved plan")}
            </Button>
          </div>
        ))}
      </Card>
      <Card className="p-5 space-y-4">
        <h2 className="text-xl font-semibold">
          {l(
            "وثائق المشغل وتعيين الطائرة",
            "Operator evidence and aircraft assignment"
          )}
        </h2>
        <p>
          {l(
            "استورد حزمة JSON الموقّعة من المصدر المسجّل. يبقى قبول الإقلاع لدى المشغل منفصلًا.",
            "Import the signed JSON package from the registered source. Operator dispatch acceptance remains separate."
          )}
        </p>
        <Label>
          {l(
            "وثيقة قواعد الطاقم أو الصيانة",
            "Crew rules or maintenance package"
          )}
          <Input
            type="file"
            accept="application/json,.json"
            onChange={async e => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 65536)
                  throw new Error(
                    l("الوثيقة أكبر من الحد", "Document too large")
                  );
                const parsed = signedDocument.parse(
                  JSON.parse(await file.text())
                );
                if (parsed.envelope.kind === "crew_rules")
                  crewRules.mutate(parsed);
                else if (parsed.envelope.kind === "maintenance")
                  maintenance.mutate(parsed);
                else
                  throw new Error(
                    l("نوع الوثيقة غير مدعوم هنا", "Unsupported document kind")
                  );
              } catch (err) {
                onError({
                  message:
                    err instanceof Error ? err.message : "Invalid document",
                });
              }
            }}
          />
        </Label>
        <form
          className="flex flex-wrap gap-3 items-end"
          onSubmit={e => {
            e.preventDefault();
            rotation.mutate({ flightId: Number(flightId), tailNumber: tail });
          }}
        >
          <Label>
            {l("معرّف الرحلة", "Flight ID")}
            <Input
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
              required
            />
          </Label>
          <Label>
            {l("تسجيل الطائرة", "Tail number")}
            <Input
              value={tail}
              onChange={e => setTail(e.target.value.toUpperCase())}
              required
            />
          </Label>
          <Button disabled={rotation.isPending}>
            {l("فحص وتعيين الطائرة", "Validate and assign aircraft")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setEconomicsFlight(Number(flightId))}
          >
            {l("قراءة اقتصاديات الرحلة", "Read flight economics")}
          </Button>
        </form>
        {economics.error && <p role="alert">{economics.error.message}</p>}
        {economics.data && (
          <p>
            {l(
              "الإيراد المعترف به / التكلفة / نتيجة التشغيل (ريال)",
              "Recognized revenue / cost / operating result (SAR)"
            )}
            :{" "}
            {[
              economics.data.recognizedRevenueMinor,
              economics.data.totalCostMinor,
              economics.data.operatingResultMinor,
            ]
              .map(v => (v === null ? "—" : (v / 100).toFixed(2)))
              .join(" / ")}{" "}
            · {l("رُصد في", "Observed at")}: {time(economics.data.observedAt)}
          </p>
        )}
        <Label>
          {l("معرّف سياسة التجربة الممتازة", "Premium experiment policy ID")}
          <Input
            value={premiumId}
            onChange={e => setPremiumId(e.target.value)}
          />
        </Label>
        <Button
          variant="outline"
          disabled={!z.uuid().safeParse(premiumId).success}
          onClick={() => setPremiumQuery(premiumId)}
        >
          {l("قراءة النتيجة المالية", "Read financial outcome")}
        </Button>
        {premium.error && <p role="alert">{premium.error.message}</p>}
        {premium.data && (
          <div>
            <p>
              {premium.data.status} · {time(premium.data.asOf)}
            </p>
            {premium.data.arms.map(a => (
              <p key={a.variant}>
                {a.variant}: {a.randomizedUsers} {l("مستخدمًا", "users")} ·{" "}
                {(a.netCollectedMinor / 100).toFixed(2)} SAR
              </p>
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}
