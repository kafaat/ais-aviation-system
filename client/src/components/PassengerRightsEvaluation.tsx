import { CLAIM_TYPE_LABELS } from "@shared/passenger-rights/engine";
import type {
  ClaimType,
  DeterminationStatus,
  EntitlementStatus,
} from "@shared/passenger-rights/types";
import { useOperationalLabels } from "./OperationalReadState";

/** Shape shared by the passenger preview and the reviewer dry-run. */
export interface EvaluationView {
  evaluatedAt: string;
  claimType: ClaimType;
  jurisdictions: Array<{
    jurisdiction: string;
    status: DeterminationStatus;
    reasons: string[];
    basis: string;
    version: string;
  }>;
  rulesConsidered: string[];
  entitlements: Array<{
    ruleCode: string;
    jurisdiction: string;
    title: string;
    article?: string;
    status: EntitlementStatus;
    amount: { minorUnits: number; currency: string } | null;
    settlement: {
      minorUnits: number;
      currency: string;
      fxRecordId: number | string | null;
      rate: string | null;
    } | null;
    care?: Record<string, boolean | number | undefined>;
    explanation: string[];
    sources: Array<{ url: string; title: string; kind: string }>;
    confirmationStatus: string;
  }>;
  deadlines: Array<{
    ruleCode: string;
    kind: string;
    dueAt: string;
    basis: string;
  }>;
}

export function claimTypeLabel(type: ClaimType, lang: string) {
  const label = CLAIM_TYPE_LABELS[type];
  return lang.startsWith("ar") ? label.ar : label.en;
}

const money = (m: { minorUnits: number; currency: string }) =>
  `${(m.minorUnits / 100).toFixed(2)} ${m.currency}`;

export function PassengerRightsEvaluation({
  evaluation,
  showTrace,
}: {
  evaluation: EvaluationView;
  /** Reviewer view: FX record ids and every rule considered. */
  showTrace?: boolean;
}) {
  const l = useOperationalLabels();
  const determinationLabel: Record<DeterminationStatus, string> = {
    applicable: l("ينطبق", "Applies"),
    not_applicable: l("لا ينطبق", "Does not apply"),
    not_yet_applicable: l("لم يدخل حيز التطبيق بعد", "Not yet applicable"),
    requires_review: l("يحتاج مراجعة النطاق", "Scope needs review"),
  };
  const statusLabel: Record<EntitlementStatus, string> = {
    awardable: l("قابل للاعتماد بعد المراجعة", "Awardable on review"),
    needs_confirmation: l(
      "يحتاج تأكيد المشغّل للقيمة",
      "Operator must confirm the value"
    ),
    blocked_disputed: l(
      "مصادر متضاربة؛ محجوب حتى التأكيد",
      "Sources conflict; blocked until confirmed"
    ),
    fx_required: l("يحتاج سجل صرف مؤرخ", "Dated FX record required"),
    ticket_value_required: l("تحتاج قيمة التذكرة", "Ticket value required"),
    distance_required: l("تحتاج مسافة المسار", "Route distance required"),
    amount_unspecified: l(
      "لا مبلغ منشور في المصادر",
      "No amount published in the sources"
    ),
    not_met: l("الشرط غير متحقق", "Threshold not met"),
    excluded: l("مستثنى", "Excluded"),
    not_yet_applicable: l("لم يدخل حيز التطبيق", "Not yet applicable"),
  };
  const relevant = evaluation.jurisdictions.filter(
    j => showTrace || j.status !== "not_applicable"
  );
  return (
    <div className="space-y-3 text-sm">
      <section>
        <h4 className="font-medium">
          {l("تحديد الاختصاص", "Jurisdiction determination")}
        </h4>
        <ul className="space-y-1">
          {relevant.map(j => (
            <li key={j.jurisdiction} className="border rounded p-2">
              <span className="font-mono">{j.jurisdiction}</span>{" "}
              <span className="font-medium">
                {determinationLabel[j.status]}
              </span>
              <ul className="list-disc ms-5 text-muted-foreground">
                {j.reasons.map(r => (
                  <li key={r}>{r}</li>
                ))}
                <li>{j.basis}</li>
              </ul>
            </li>
          ))}
          {!relevant.length && (
            <li>
              {l(
                "لا ينطبق أي اختصاص معروف على هذا المسار",
                "No known jurisdiction applies to this route"
              )}
            </li>
          )}
        </ul>
      </section>
      <section>
        <h4 className="font-medium">
          {l("الاستحقاقات المحتملة", "Possible entitlements")} ·{" "}
          {claimTypeLabel(evaluation.claimType, l("ar", "en"))}
        </h4>
        {!evaluation.entitlements.length && (
          <p>
            {l(
              "لا قاعدة مسجلة لهذا النوع ضمن الاختصاصات المنطبقة.",
              "No seeded rule covers this claim type in the applicable jurisdictions."
            )}
          </p>
        )}
        <ul className="space-y-1">
          {evaluation.entitlements
            .filter(e => showTrace || e.status !== "not_met")
            .map(e => (
              <li key={e.ruleCode} className="border rounded p-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>
                    <span className="font-mono text-xs">{e.ruleCode}</span>{" "}
                    {e.article && (
                      <span className="text-muted-foreground">
                        ({e.article})
                      </span>
                    )}
                    <br />
                    {e.title}
                  </span>
                  <span className="font-medium">{statusLabel[e.status]}</span>
                </div>
                {e.amount && (
                  <p>
                    {l("المبلغ بعملة القاعدة", "Amount in rule currency")}:{" "}
                    {money(e.amount)}
                    {e.settlement &&
                      e.settlement.currency !== e.amount.currency && (
                        <>
                          {" · "}
                          {l("بعملة التسوية", "Settlement")}:{" "}
                          {money(e.settlement)}
                          {showTrace && e.settlement.fxRecordId !== null && (
                            <span className="text-muted-foreground">
                              {" "}
                              (FX #{e.settlement.fxRecordId} @{" "}
                              {e.settlement.rate})
                            </span>
                          )}
                        </>
                      )}
                  </p>
                )}
                {e.care && (
                  <p className="text-muted-foreground">
                    {l("الرعاية", "Care")}:{" "}
                    {Object.entries(e.care)
                      .filter(([, v]) => v)
                      .map(([k, v]) =>
                        typeof v === "number" ? `${k} ×${v}` : k
                      )
                      .join(", ")}
                  </p>
                )}
                <ul className="list-disc ms-5 text-muted-foreground">
                  {e.explanation.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <p className="text-xs">
                  {l("المصادر", "Sources")}:{" "}
                  {e.sources.map((s, i) => (
                    <span key={s.url}>
                      {i > 0 && ", "}
                      <a className="underline" href={s.url} rel="noreferrer">
                        {s.title}
                      </a>{" "}
                      [{s.kind}]
                    </span>
                  ))}
                </p>
              </li>
            ))}
        </ul>
      </section>
      {evaluation.deadlines.length > 0 && (
        <section>
          <h4 className="font-medium">{l("المهل", "Deadlines")}</h4>
          <ul className="list-disc ms-5">
            {evaluation.deadlines.map(d => (
              <li key={`${d.ruleCode}-${d.kind}`}>
                {d.kind} · {new Date(d.dueAt).toISOString()} · {d.basis}
              </li>
            ))}
          </ul>
        </section>
      )}
      {showTrace && (
        <p className="text-xs text-muted-foreground">
          {l("القواعد المدروسة", "Rules considered")}:{" "}
          {evaluation.rulesConsidered.join(", ") || "—"} ·{" "}
          {l("وقت التقييم", "Evaluated at")} {evaluation.evaluatedAt}
        </p>
      )}
    </div>
  );
}
