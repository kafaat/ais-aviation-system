import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportReportButton } from "@/components/ExportReportButton";

type Tab = "route" | "class" | "channel" | "ancillary" | "yield" | "reports";
export function RevenueAccounting() {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const text = (en: string, arabic: string) => (ar ? arabic : en);
  const money = (value: number) =>
    new Intl.NumberFormat(ar ? "ar-SA" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value / 100);
  const [activeTab, setActiveTab] = useState<Tab>("route");
  const [range, setRange] = useState("30");
  const [anchor, setAnchor] = useState(() => Date.now());
  const filter = useMemo(() => {
    if (range === "all") return undefined;
    const startDate = new Date(anchor);
    startDate.setUTCDate(startDate.getUTCDate() - Number(range) + 1);
    startDate.setUTCHours(0, 0, 0, 0);
    return { startDate, endDate: new Date(anchor) };
  }, [range, anchor]);
  const [month, setMonth] = useState(() => new Date().getUTCMonth() + 1);
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const dashboard = trpc.revenueAccounting.getDashboard.useQuery(filter);
  const routes = trpc.revenueAccounting.getRevenueByRoute.useQuery(filter, {
    enabled: activeTab === "route",
  });
  const classes = trpc.revenueAccounting.getRevenueByClass.useQuery(filter, {
    enabled: activeTab === "class",
  });
  const channels = trpc.revenueAccounting.getRevenueByChannel.useQuery(filter, {
    enabled: activeTab === "channel",
  });
  const ancillary = trpc.revenueAccounting.getAncillaryRevenue.useQuery(
    filter,
    { enabled: activeTab === "ancillary" }
  );
  const yields = trpc.revenueAccounting.getYieldAnalysis.useQuery(
    { ...filter, limit: 20 },
    { enabled: activeTab === "yield" }
  );
  const reports = trpc.revenueAccounting.getReports.useQuery(undefined, {
    enabled: activeTab === "reports",
  });
  const preview = trpc.revenueAccounting.generateReport.useMutation();
  const queries = [
    dashboard,
    routes,
    classes,
    channels,
    ancillary,
    yields,
    reports,
  ];
  function refresh() {
    setAnchor(Date.now());
    for (const q of queries) if (q.data || q.isError) void q.refetch();
  }
  const error = (retry: () => unknown) => (
    <div role="alert" className="space-y-3 p-4 border rounded-lg">
      <p>
        {text(
          "Financial data could not be loaded. Previously displayed amounts are hidden.",
          "تعذر تحميل البيانات المالية. أُخفيت المبالغ السابقة حتى تنجح القراءة."
        )}
      </p>
      <Button variant="outline" onClick={() => void retry()}>
        {text("Retry", "إعادة المحاولة")}
      </Button>
    </div>
  );
  const tabs: [Tab, string, string][] = [
    ["route", "Routes", "المسارات"],
    ["class", "Cabin class", "المقصورة"],
    ["channel", "Sales channels", "قنوات البيع"],
    ["ancillary", "Ancillary invoice lines", "بنود الخدمات الإضافية"],
    ["yield", "Flight collections", "تحصيل الرحلات"],
    ["reports", "Monthly previews", "معاينات شهرية"],
  ];
  const unavailable = text(
    "Unavailable: earned and deferred revenue require an approved allocation policy, evidence of delivered services, and recognition entries. Booking status alone is insufficient.",
    "غير متاح: الإيراد المكتسب والمؤجل يحتاجان سياسة توزيع معتمدة وسند تنفيذ الخدمات وقيود اعتراف محاسبي. حالة الحجز وحدها لا تكفي."
  );
  const current =
    activeTab === "route"
      ? routes
      : activeTab === "class"
        ? classes
        : activeTab === "channel"
          ? channels
          : yields;
  const labelChannel = (c: string) =>
    c === "ambiguous"
      ? text("Conflicting channel links", "ارتباط متعارض بالقنوات")
      : c === "direct"
        ? text("No agent/corporate link", "دون ارتباط بوكيل أو شركة")
        : c === "agent"
          ? text("Agent", "وكيل")
          : text("Corporate", "شركات");
  const multi = text(
    "Multi-city itinerary (unallocated)",
    "رحلة متعددة المقاطع (دون توزيع مالي)"
  );
  const financialRows =
    activeTab === "route"
      ? (routes.data ?? []).map(r => ({
          ...r,
          label:
            r.itineraryType === "multi_city"
              ? multi
              : `${r.originCode} → ${r.destinationCode}`,
        }))
      : activeTab === "class"
        ? (classes.data ?? []).map(r => ({
            ...r,
            label:
              r.classOfService === "business"
                ? text("Business", "الأعمال")
                : text("Economy", "السياحية"),
          }))
        : activeTab === "channel"
          ? (channels.data ?? []).map(r => ({
              ...r,
              label: labelChannel(r.channel),
            }))
          : (yields.data ?? []).map(r => ({
              ...r,
              label: r.itineraryType === "multi_city" ? multi : r.flightNumber,
            }));
  return (
    <div className="container py-8 space-y-6" dir={ar ? "rtl" : "ltr"}>
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            {text(
              "Booking Collections & Financial Reports",
              "تحصيل الحجوزات والتقارير المالية"
            )}
          </h1>
          <p className="text-muted-foreground mt-2">
            {text(
              "Posted collections and refunds in SAR, by UTC transaction date. Includes wallet settlements; these are not bank payouts or earned revenue.",
              "التحصيل والاسترداد المسجلان بالريال حسب تاريخ القيد بتوقيت UTC. يشمل تسويات المحفظة؛ ولا يمثل تحويلات البنك أو الإيراد المكتسب."
            )}
          </p>
        </div>
        <Button variant="outline" onClick={refresh}>
          {text("Refresh", "تحديث")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {["30", "90", "365", "all"].map(r => (
          <Button
            key={r}
            size="sm"
            variant={range === r ? "default" : "outline"}
            onClick={() => {
              setRange(r);
              setAnchor(Date.now());
            }}
          >
            {r === "all"
              ? text("All time", "كل الفترات")
              : `${r} ${text("days (UTC)", "يومًا (UTC)")}`}
          </Button>
        ))}
        <ExportReportButton
          reportType="revenue"
          filters={
            filter
              ? {
                  startDate: filter.startDate.toISOString(),
                  endDate: filter.endDate.toISOString(),
                }
              : {}
          }
        />
      </div>
      {dashboard.isError ? (
        error(dashboard.refetch)
      ) : dashboard.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : dashboard.data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                text("Posted collections", "التحصيل المسجل"),
                dashboard.data.totalRevenue,
              ],
              [
                text("Posted refunds", "الاسترداد المسجل"),
                dashboard.data.refundTotal,
              ],
              [
                text("Net posted amount", "صافي المبالغ المسجلة"),
                dashboard.data.netRevenue,
              ],
              [
                text("Recorded booking face value", "قيمة الحجوزات المسجلة"),
                dashboard.data.bookedAmount,
              ],
            ].map(([label, amount]) => (
              <Card key={String(label)}>
                <CardHeader>
                  <CardTitle className="text-sm">{label}</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-bold">
                  {money(Number(amount))} SAR
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {text(
              "Booking face value uses booking creation dates and current totals, including cancelled/unpaid bookings. It is not proof of collection and is never added to collections.",
              "قيمة الحجوزات تستخدم تاريخ إنشاء الحجز وإجماليه الحالي، وتشمل غير المدفوع والملغى. ليست إثبات تحصيل ولا تُضاف إلى التحصيل المسجل."
            )}
          </p>
          <div className="grid gap-3 md:grid-cols-3 text-sm">
            <p>
              {text("Bookings with collections", "حجوزات لها تحصيل")}:{" "}
              {dashboard.data.totalBookings}
            </p>
            <p>
              {text(
                "Average collection per funded booking",
                "متوسط التحصيل لكل حجز ممول"
              )}
              : {money(dashboard.data.averageRevenuePerBooking)} SAR
            </p>
            <p>
              {text(
                "Collection change vs equal preceding period",
                "تغير التحصيل مقابل الفترة السابقة المساوية"
              )}
              :{" "}
              {dashboard.data.revenueGrowthPercent === null
                ? text("Not comparable", "غير قابل للمقارنة")
                : `${dashboard.data.revenueGrowthPercent}%`}
            </p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>
                {text("Reconciliation indicators", "مؤشرات المطابقة")}
              </CardTitle>
              <CardDescription>
                {text(
                  "Posted records remain visible. These indicators need source reconciliation and do not automatically change money.",
                  "تبقى القيود المسجلة ظاهرة. تحتاج هذه المؤشرات مطابقة مع السند الأصلي، ولا تغيّر الأموال تلقائيًا."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <p>
                {text(
                  "Collections without matching receipt evidence",
                  "قيود تحصيل دون سند مطابق"
                )}
                : {dashboard.data.unmatchedCollectionEntries}
              </p>
              <p>
                {text(
                  "Paid/refunded bookings without a charge entry",
                  "حجوزات مدفوعة أو مستردة بلا قيد تحصيل"
                )}
                : {dashboard.data.unpostedPaidBookings}
              </p>
              <p>
                {text(
                  "Gross collections currently marked for review",
                  "إجمالي التحصيل الموسوم حاليًا للمراجعة"
                )}
                : {money(dashboard.data.reviewCollectionAmount)} SAR
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}
      <p className="border rounded-lg p-4 bg-muted/30">{unavailable}</p>
      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map(([key, en, arabic]) => (
          <Button
            role="tab"
            aria-selected={activeTab === key}
            key={key}
            variant={activeTab === key ? "default" : "outline"}
            onClick={() => setActiveTab(key)}
          >
            {text(en, arabic)}
          </Button>
        ))}
      </div>
      {!["ancillary", "reports"].includes(activeTab) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {text("Posted booking money", "المبالغ المسجلة للحجوزات")}
            </CardTitle>
            <CardDescription>
              {activeTab === "yield"
                ? text(
                    "Up to 20 flight/itinerary groups by collections. Yield, RPK and load factor are unavailable without verified distance, carried passengers and segment revenue allocation.",
                    "حتى 20 مجموعة رحلة أو مسار حسب التحصيل. العائد لكل راكب-كيلومتر ومعامل الحمولة غير متاحين دون مسافات وركاب منقولين وتوزيع إيراد موثق للمقاطع."
                  )
                : text(
                    "Every booking appears once per group. Conflicting channel links and multi-city itineraries remain visible as separate groups.",
                    "يُحتسب الحجز مرة واحدة داخل المجموعة. يظهر تعارض قنوات البيع والمسار متعدد المقاطع في مجموعات مستقلة."
                  )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {current.isError ? (
              error(current.refetch)
            ) : current.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : financialRows.length ? (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      {[
                        text("Group", "المجموعة"),
                        text("Collections (SAR)", "التحصيل (ريال)"),
                        text("Refunds (SAR)", "الاسترداد (ريال)"),
                        text("Net (SAR)", "الصافي (ريال)"),
                        text("Active bookings", "حجوزات لها قيود"),
                      ].map(h => (
                        <th className="p-3 text-start" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {financialRows.map((r, i) => (
                      <tr className="border-b" key={`${r.label}-${i}`}>
                        <td className="p-3">{r.label}</td>
                        <td>{money(r.totalRevenue)}</td>
                        <td>{money(r.refundedAmount)}</td>
                        <td>{money(r.netAmount)}</td>
                        <td>{r.activeBookings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                {text(
                  "No posted entries in this period.",
                  "لا توجد قيود مسجلة في هذه الفترة."
                )}
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {activeTab === "ancillary" && (
        <Card>
          <CardHeader>
            <CardTitle>
              {text(
                "Active ancillary invoice lines",
                "بنود الخدمات الإضافية النشطة"
              )}
            </CardTitle>
            <CardDescription>
              {text(
                "Quoted line values by creation date, including unpaid lines. Neither collected nor recognized revenue; never add them to booking collections.",
                "قيم البنود حسب تاريخ إنشائها، وتشمل البنود غير المدفوعة. ليست تحصيلًا أو إيرادًا مكتسبًا، ولا تُضاف إلى تحصيل الحجز."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ancillary.isError ? (
              error(ancillary.refetch)
            ) : ancillary.isLoading ? (
              <Skeleton className="h-36 w-full" />
            ) : ancillary.data ? (
              <>
                <p>
                  {text("Total line value", "إجمالي قيمة البنود")}:{" "}
                  {money(ancillary.data.total)} SAR
                </p>
                <ul className="space-y-3 mt-4">
                  {ancillary.data.breakdown.map(r => (
                    <li key={r.category}>
                      {r.category}: {money(r.totalRevenue)} SAR ·{" "}
                      {text("Quantity", "الكمية")}: {r.quantity}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
      {activeTab === "reports" && (
        <Card>
          <CardHeader>
            <CardTitle>
              {text("Current monthly previews", "معاينات شهرية حالية")}
            </CardTitle>
            <CardDescription>
              {text(
                "Previews are recalculated from current posted records. They are not saved or finalized accounts. Use Data Warehouse exports for durable downloadable snapshots.",
                "تُحسب المعاينات من القيود الحالية، ولا تمثل حسابات محفوظة أو معتمدة. استخدم تصدير مستودع البيانات لحفظ لقطة قابلة للتنزيل."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <label>
                {text("Month", "الشهر")}
                <input
                  className="border rounded p-2 block"
                  type="number"
                  min={1}
                  max={12}
                  value={month}
                  onChange={e => {
                    setMonth(Number(e.target.value));
                    preview.reset();
                  }}
                />
              </label>
              <label>
                {text("Year", "السنة")}
                <input
                  className="border rounded p-2 block"
                  type="number"
                  min={2020}
                  max={2100}
                  value={year}
                  onChange={e => {
                    setYear(Number(e.target.value));
                    preview.reset();
                  }}
                />
              </label>
              <Button
                disabled={preview.isPending}
                onClick={() => preview.mutate({ month, year })}
              >
                {text("Preview month", "معاينة الشهر")}
              </Button>
              <a className="underline" href="/admin/data-warehouse">
                {text("Data Warehouse", "مستودع البيانات")}
              </a>
            </div>
            {preview.isError ? (
              <p role="alert">
                {text(
                  "Monthly preview failed; check the period and retry.",
                  "تعذرت المعاينة؛ تحقق من الفترة وأعد المحاولة."
                )}
              </p>
            ) : preview.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : preview.data ? (
              <p>
                {preview.data.periodStart} → {preview.data.periodEnd}:{" "}
                {text(
                  "collections / refunds / net (SAR)",
                  "التحصيل / الاسترداد / الصافي (ريال)"
                )}{" "}
                {money(preview.data.totalRevenue)} /{" "}
                {money(preview.data.refundAmount)} /{" "}
                {money(preview.data.netRevenue)}
              </p>
            ) : null}
            {reports.isError ? (
              error(reports.refetch)
            ) : reports.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <ul className="space-y-3">
                {reports.data?.map(r => (
                  <li className="border rounded p-3" key={r.id}>
                    {r.periodStart} → {r.periodEnd}: {money(r.totalRevenue)} /{" "}
                    {money(r.refundAmount)} / {money(r.netRevenue)} SAR
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
export default RevenueAccounting;
