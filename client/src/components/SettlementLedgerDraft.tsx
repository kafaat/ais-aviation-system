import { trpc } from "@/lib/trpc";
import {
  OperationalReadState,
  useOperationalLabels,
} from "./OperationalReadState";
export function SettlementLedgerDraft() {
  const l = useOperationalLabels();
  const query = trpc.bspReporting.ledgerDraft.useQuery({});
  return (
    <section className="border p-4 space-y-2">
      <h2>{l("المسودة المالية الداخلية", "Internal financial draft")}</h2>
      <p>
        {l(
          "المصدر: دفتر التسوية. إصدار ملف BSP ينتظر وصول التذاكر والضرائب والاسترداد المعتمدة.",
          "Source: settlement ledger. BSP document generation awaits accepted ticket, tax and refund receipts."
        )}
      </p>
      <OperationalReadState query={query}>
        {query.data && (
          <dl className="grid grid-cols-2 gap-2">
            <dt>{l("المحصّل", "Collected")}</dt>
            <dd>{(query.data.collectedAmount / 100).toFixed(2)} SAR</dd>
            <dt>{l("تمويل غير نقدي", "Non-cash funding")}</dt>
            <dd>{(query.data.nonCashFundedAmount / 100).toFixed(2)} SAR</dd>
            <dt>{l("المسترد", "Refunded")}</dt>
            <dd>{(query.data.refundedAmount / 100).toFixed(2)} SAR</dd>
            <dt>{l("الصافي", "Net")}</dt>
            <dd>{(query.data.netCollectedAmount / 100).toFixed(2)} SAR</dd>
            <dt>{l("قيود غير مصنفة", "Unclassified entries")}</dt>
            <dd>{query.data.unclassifiedEntries}</dd>
          </dl>
        )}
      </OperationalReadState>
    </section>
  );
}
