import { PayoutComparison } from "./PayoutComparison";
import { trpc } from "@/lib/trpc";
import {
  OperationalReadState,
  useOperationalLabels,
} from "./OperationalReadState";
export function SettlementLedgerDraft() {
  const l = useOperationalLabels();
  const query = trpc.bspReporting.ledgerDraft.useQuery({});
  return (
    <>
      <section className="border p-4 space-y-2">
        <h2>{l("المسودة المالية الداخلية", "Internal financial draft")}</h2>
        <p>
          {l(
            "هذه مبالغ دفتر AIS. في مسار NDCLink تُبلَّغ المبيعات بصيغة RET ويأتي تقرير HOT من BSP. المطابقة البنكية أدناه مستقلة عن BSP.",
            "AIS ledger amounts. In the NDCLink workflow, sales are reported as RET and HOT is received from BSP. The bank comparison below is separate."
          )}
        </p>
        <OperationalReadState query={query}>
          {query.data && (
            <dl className="grid grid-cols-2 gap-2">
              <dt>{l("المحصّل", "Collected")}</dt>
              <dd>{(query.data.collectedAmount / 100).toFixed(2)} SAR</dd>
              <dt>{l("تمويل غير نقدي", "Non-cash funding")}</dt>
              <dd>{(query.data.nonCashFundedAmount / 100).toFixed(2)} SAR</dd>
              <dt>{l("تمويل غير نقدي مُعاد", "Returned non-cash funding")}</dt>
              <dd>{(query.data.nonCashRefundedAmount / 100).toFixed(2)} SAR</dd>
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
      <PayoutComparison />
    </>
  );
}
