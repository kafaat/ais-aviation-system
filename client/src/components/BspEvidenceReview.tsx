import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useOperationalLabels } from "./OperationalReadState";
import { bspReference, inboundBspEvidence } from "@shared/bsp-local-evidence";

export function BspEvidenceReview() {
  const l = useOperationalLabels();
  const [day, setDay] = useState("");
  const [document, setDocument] = useState("");
  const [settlement, setSettlement] = useState("");
  const [statement, setStatement] = useState("");
  const [invalid, setInvalid] = useState(false);
  const stage = trpc.bspReporting.stageDailyRet.useMutation();
  const ingest = trpc.bspReporting.importEvidence.useMutation();
  const review = trpc.bspReporting.reconcileEvidence.useQuery(
    { day, settlementReference: settlement, statementLineId: statement },
    { enabled: false }
  );
  function importDocument() {
    setInvalid(false);
    try {
      const parsed = inboundBspEvidence.parse(JSON.parse(document));
      ingest.mutate(parsed, {
        onSuccess: () => {
          setDay(parsed.day);
          setSettlement(parsed.settlementReference);
          if (parsed.direction === "inbound_bank")
            setStatement(parsed.statementLineId);
          setDocument("");
        },
      });
    } catch {
      setInvalid(true);
    }
  }
  return (
    <section className="space-y-2 rounded border p-4">
      <h2>
        {l(
          "مطابقة مسودة RET مع HOT والتحويل البنكي",
          "Compare a RET draft with HOT and a bank transfer"
        )}
      </h2>
      <p>
        {l(
          "مراجعة داخلية لحركات الوكالات بالريال في يوم UTC مغلق. صيغة الإدخال AIS-BSP-LOCAL-1. لا ترسل هذه العملية أي ملف.",
          "Internal review of agency cash movements in SAR for one closed UTC day. Input profile AIS-BSP-LOCAL-1. No file is transmitted."
        )}
      </p>
      <label className="block">
        {l("يوم التقرير", "Reporting day")}{" "}
        <input type="date" value={day} onChange={e => setDay(e.target.value)} />
      </label>
      <button
        type="button"
        disabled={!day || stage.isPending}
        onClick={() => stage.mutate({ day })}
      >
        {l("إنشاء مسودة RET المحلية", "Create local RET draft")}
      </button>
      {stage.data?.draft.day === day && stage.data && (
        <details>
          <summary>{l("عرض المسودة", "View draft")}</summary>
          <pre dir="ltr" className="overflow-x-auto">
            {JSON.stringify(stage.data.draft, null, 2)}
          </pre>
        </details>
      )}
      <label className="block">
        {l(
          "بيانات HOT أو سطر البنك بصيغة JSON المحلية",
          "Normalized HOT or bank line JSON"
        )}
        <textarea
          dir="ltr"
          maxLength={300000}
          value={document}
          onChange={e => setDocument(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={!document || ingest.isPending}
        onClick={importDocument}
      >
        {l("حفظ المستند الوارد", "Save inbound evidence")}
      </button>
      {invalid && (
        <p role="alert">
          {l(
            "البيانات لا تطابق صيغة الإدخال.",
            "Invalid evidence profile or JSON."
          )}
        </p>
      )}
      <label className="block">
        {l("مرجع التسوية", "Settlement reference")}{" "}
        <input
          dir="ltr"
          value={settlement}
          onChange={e => setSettlement(e.target.value)}
        />
      </label>
      <label className="block">
        {l("مرجع سطر البنك", "Bank statement line")}{" "}
        <input
          dir="ltr"
          value={statement}
          onChange={e => setStatement(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={
          !day ||
          !bspReference.safeParse(settlement).success ||
          !bspReference.safeParse(statement).success ||
          review.isFetching
        }
        onClick={() => void review.refetch()}
      >
        {l("مطابقة الأدلة", "Compare evidence")}
      </button>
      {review.data && (
        <p role="status">
          {review.data.matches
            ? l("تطابقت الأدلة المحلية", "Local evidence matches")
            : l("توجد فروق في الأدلة", "Evidence differs")}
          . {l("صافي المسودة بالهللات", "Draft net in minor units")}{" "}
          {review.data.netMinor}. {review.data.differingLedgerIds.join(", ")}
        </p>
      )}
      {(stage.error || ingest.error || review.error) && (
        <p role="alert">
          {(stage.error || ingest.error || review.error)?.message}
        </p>
      )}
    </section>
  );
}
