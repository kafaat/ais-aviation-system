import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";

export function BaggageEntitlement({
  bookingId,
  passengerId,
  flightId,
}: {
  bookingId: number;
  passengerId?: number;
  flightId?: number;
}) {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const query = trpc.bookings.baggageEntitlements.useQuery(
    { bookingId },
    {
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: true,
    }
  );
  if (query.isLoading)
    return (
      <p role="status">
        {ar ? "جارٍ التحقق من سماح الأمتعة…" : "Checking baggage allowance…"}
      </p>
    );
  if (query.error)
    return (
      <p role="alert">
        {ar
          ? "تعذر التحقق من سماح الأمتعة."
          : "Baggage allowance could not be verified."}
      </p>
    );
  const rows =
    query.data?.filter(
      row =>
        (passengerId == null || row.passengerId === passengerId) &&
        (flightId == null || row.flightId === flightId)
    ) ?? [];
  if (!rows.length)
    return (
      <p>
        {ar
          ? "لا يتوفر سماح موثّق لهذا المقطع."
          : "No verified allowance is available for this segment."}
      </p>
    );
  const warnings: Record<string, [string, string]> = {
    missing_passenger: [
      "إضافة بلا مسافر محدد",
      "Item has no assigned passenger",
    ],
    missing_scope: ["نطاق المقطع غير محدد", "Segment scope is unresolved"],
    unapproved_all_segments_scope: [
      "سماح جميع المقاطع بانتظار الاعتماد",
      "All-segment allowance awaits approval",
    ],
    missing_weight_snapshot: [
      "وزن الشراء غير موثّق",
      "Purchase weight is not documented",
    ],
    missing_funding: ["تمويل الإضافة غير مكتمل", "Item funding is incomplete"],
    invalid_funding_evidence: [
      "دليل التمويل يحتاج مراجعة",
      "Funding evidence needs review",
    ],
  };
  return (
    <section
      aria-label={ar ? "سماح الأمتعة" : "Baggage allowance"}
      className="text-sm space-y-2"
    >
      {rows.map(row => (
        <div key={`${row.passengerId}:${row.segmentId}`}>
          <p>
            {ar ? "المقطع" : "Segment"} {row.segmentOrder}:{" "}
            {row.totalWeightGrams / 1000} {ar ? "كجم موثّقة" : "kg verified"}
          </p>
          <p>
            {ar ? "الحد الأقصى للحقيبة الواحدة" : "Maximum per bag"}:{" "}
            {row.maxBagWeightGrams / 1000} {ar ? "كجم" : "kg"}
          </p>
          {row.requiresOperationalReview && (
            <div role="alert">
              <p>
                {ar
                  ? "السماح غير نهائي؛ راجع موظف الخدمة قبل تسليم الأمتعة."
                  : "Allowance is not final; contact staff before bag drop."}
              </p>
              <ul>
                {row.warnings.map(code => (
                  <li key={code}>
                    {warnings[code]?.[ar ? 0 : 1] ??
                      (ar ? "تحتاج مراجعة" : "Review required")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
