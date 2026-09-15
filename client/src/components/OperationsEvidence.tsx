import { trpc } from "@/lib/trpc";
import {
  OperationalReadState,
  useOperationalLabels,
} from "./OperationalReadState";
export function OperationsEvidence() {
  const l = useOperationalLabels();
  const configuration = trpc.operations.integrationConfiguration.useQuery();
  const dispatches = trpc.operations.alertDispatches.useQuery(
    { limit: 50 },
    { refetchInterval: 15000 }
  );
  const lineage = trpc.operations.lineageRuns.useQuery(
    { limit: 50 },
    { refetchInterval: 15000 }
  );
  return (
    <section className="space-y-6">
      <h2>{l("إعدادات التكامل", "Integration configuration")}</h2>
      <OperationalReadState query={configuration}>
        <ul>
          {configuration.data?.map(row => (
            <li key={row.id}>
              {row.id}: {row.state}
              {row.reason && ` · ${row.reason}`}
            </li>
          ))}
        </ul>
      </OperationalReadState>
      <h2>{l("وصول المناوبة", "On-call delivery receipts")}</h2>
      <p>
        {l(
          "التسليم يعني قبول المزوّد، ولا يثبت أن شخصًا قرأ التنبيه.",
          "Delivery means provider acceptance, not a human acknowledgement."
        )}
      </p>
      <OperationalReadState query={dispatches}>
        <ul>
          {dispatches.data?.map(d => (
            <li key={d.id} className="border p-3">
              {d.alertKey} · {d.action} · {d.status} · {d.providerMode}
              <p>
                {l("المحاولات", "Attempts")}: {d.attempts};{" "}
                {l("المحاولة التالية", "Next attempt")}:{" "}
                {d.nextAttemptAt ?? "—"}
              </p>
              {d.lastError && <p role="status">{d.lastError}</p>}
            </li>
          ))}
        </ul>
        {dispatches.data?.length === 0 && (
          <p>{l("لا وصول مسجلة", "No recorded receipts")}</p>
        )}
      </OperationalReadState>
      <h2>{l("مصادر مهام البيانات", "Data job lineage")}</h2>
      <OperationalReadState query={lineage}>
        <ul>
          {lineage.data?.map(run => (
            <li key={run.runId} className="border p-3">
              {run.jobName} · {run.outcome}
              <p>
                {run.startedAt} — {run.finishedAt ?? "—"}
              </p>
              <p>
                {l("المدخلات", "Inputs")}: {run.inputs.join(", ")}
              </p>
              <p>
                {l("المخرجات", "Outputs")}: {run.outputs.join(", ")}
              </p>
              <p>Trace: {run.traceId ?? "—"}</p>
            </li>
          ))}
        </ul>
        {lineage.data?.length === 0 && (
          <p>{l("لا مهام مسجلة", "No recorded jobs")}</p>
        )}
      </OperationalReadState>
    </section>
  );
}
