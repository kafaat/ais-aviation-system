import { useState } from "react";
import { payoutEvidence } from "@shared/payout-comparison";
import { trpc } from "@/lib/trpc";
import { useOperationalLabels } from "./OperationalReadState";
import { Button } from "./ui/button";
import { downloadFile } from "@/lib/downloadFile";

const example = JSON.stringify(
  {
    payout: {
      reference: "po_example",
      currency: "SAR",
      netMinor: 970,
      captureCount: 1,
      captures: [
        { paymentIntentId: "pi_example", grossMinor: 1000, feeMinor: 30 },
      ],
    },
    bank: {
      statementLineId: "line_example",
      payoutReference: "po_example",
      currency: "SAR",
      creditedMinor: 970,
    },
  },
  null,
  2
);

export function PayoutComparison() {
  const l = useOperationalLabels();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const compare = trpc.bspReporting.comparePayout.useMutation();
  return (
    <section className="space-y-3 border p-4">
      <h2>
        {l(
          "مطابقة تحصيلات الحجز مع التحويل البنكي",
          "Compare booking captures with a bank credit"
        )}
      </h2>
      <p>
        {l(
          "أدخل كشفاً واحداً بالهللات يتكون بالكامل من تحصيلات، وسطر الإيداع من البنك. تقارن الأداة القيم المقدمة بدفتر AIS، ولا تتصل بالبنك أو تغيّر الرصيد.",
          "Provide one capture-only SAR payout and the credit from the bank statement, in minor units. This compares your evidence with the AIS ledger without contacting the bank or posting funds."
        )}
      </p>
      <details>
        <summary>{l("نموذج البيانات", "Evidence format")}</summary>
        <pre dir="ltr">{example}</pre>
      </details>
      <label className="block">
        {l("بيانات الكشوف (JSON)", "Statement evidence (JSON)")}
        <textarea
          className="block w-full rounded border p-2"
          dir="ltr"
          rows={4}
          maxLength={64000}
          value={input}
          disabled={compare.isPending}
          onChange={e => {
            setInput(e.target.value);
            setError("");
            compare.reset();
          }}
        />
      </label>
      <Button
        disabled={compare.isPending || !input.trim()}
        onClick={() => {
          try {
            const data = payoutEvidence.parse(JSON.parse(input));
            setError("");
            compare.mutate(data);
          } catch {
            setError(
              l(
                "تحقق من النموذج وعدد التحصيلات ومراجعها الفريدة.",
                "Check the format, capture count and unique references."
              )
            );
          }
        }}
      >
        {l("مقارنة", "Compare")}
      </Button>
      {(error || compare.error) && (
        <p role="alert">{error || compare.error?.message}</p>
      )}
      {compare.data && (
        <div role="status" className="space-y-2">
          <p>
            {compare.data.matched
              ? l(
                  "تطابقت الكشوف المُدخلة مع الدفتر.",
                  "Supplied statements match the ledger."
                )
              : l("توجد فروق تستلزم المراجعة.", "Differences require review.")}
          </p>
          <p>
            {l("تحصيلات مطابقة", "Matched captures")}:{" "}
            {compare.data.lines.filter(line => line.matched).length} /{" "}
            {compare.data.lines.length}
          </p>
          <Button
            variant="outline"
            onClick={() =>
              downloadFile(
                JSON.stringify(
                  { evidence: JSON.parse(input), comparison: compare.data },
                  null,
                  2
                ),
                "payout-comparison.json",
                "application/json"
              )
            }
          >
            {l("تنزيل دليل المقارنة", "Download evidence and comparison")}
          </Button>
        </div>
      )}
    </section>
  );
}
