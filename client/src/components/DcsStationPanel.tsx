import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  useOperationalLabels,
  OperationalReadState,
} from "./OperationalReadState";
import { useCommandIdempotencyKey } from "@/hooks/useCommandIdempotencyKey";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { escapeCSV } from "@shared/csv";
import { toast } from "sonner";

type Passenger = { bookingId: number; passengerId: number; name: string };
type Mode =
  | "no_rec"
  | "go_show"
  | "dismiss"
  | "resolve"
  | "osi"
  | "block"
  | "remap"
  | "downgrade"
  | "close"
  | "reopen"
  | "record_out";
export function DcsStationPanel({
  flightId,
  passengers,
  disabled,
  reopenOnly,
}: {
  flightId: number;
  passengers: Passenger[];
  disabled: boolean;
  reopenOnly: boolean;
}) {
  const l = useOperationalLabels();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  if (!user?.tenantId) return null;
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <Button
        variant="outline"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {l("تقارير وإجراءات المحطة", "Station reports and actions")}
      </Button>
      {expanded && (
        <StationTools
          key={`${flightId}:${user.id}:${user.tenantId}:${reopenOnly}`}
          expectedActorId={user.id}
          expectedTenantId={user.tenantId}
          flightId={flightId}
          passengers={passengers}
          disabled={disabled}
          reopenOnly={reopenOnly}
          supervisor={["admin", "airline_admin", "super_admin"].includes(
            user.role
          )}
        />
      )}
    </section>
  );
}
function StationTools({
  flightId,
  passengers,
  disabled,
  reopenOnly,
  supervisor,
  expectedActorId,
  expectedTenantId,
}: {
  expectedActorId: number;
  expectedTenantId: number;
  flightId: number;
  passengers: Passenger[];
  disabled: boolean;
  reopenOnly: boolean;
  supervisor: boolean;
}) {
  const l = useOperationalLabels();
  const query = trpc.dcsOperations.stationReport.useQuery({ flightId });
  const utils = trpc.useUtils();
  const key = useCommandIdempotencyKey();
  const [mode, setMode] = useState<Mode>(reopenOnly ? "reopen" : "no_rec");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [passengerId, setPassenger] = useState("");
  const [caseId, setCase] = useState("");
  const [seatList, setSeats] = useState("");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [mapId, setMap] = useState("");
  const [outTime, setOutTime] = useState("");
  const [proposal, setProposal] = useState<{
    passengerId: number;
    eventId: number;
    refundDue: number;
  } | null>(null);
  const dismiss = trpc.dcsOperations.dismissCase.useMutation();
  const finalize = trpc.dcsOperations.finalize.useMutation();
  const quote = trpc.dcsOperations.quoteDowngrade.useMutation();
  const confirm = trpc.dcsOperations.confirmDowngrade.useMutation();
  const printTable = useRef<HTMLTableElement>(null);
  const [meals, setMeals] = useState(false);
  const open = trpc.dcsOperations.openCase.useMutation();
  const resolve = trpc.dcsOperations.resolveCase.useMutation();
  const osi = trpc.dcsOperations.addOsi.useMutation();
  const block = trpc.dcsOperations.blockSeats.useMutation();
  const remap = trpc.dcsOperations.remapSeats.useMutation();
  const [saving, setSaving] = useState(false);
  const p = passengers.find(v => v.passengerId === Number(passengerId));
  const report = query.data;
  const rows = report?.items.filter(i => !meals || i.category === "meal") ?? [];
  const finalized = !!report?.closedAt;
  const lock =
    saving ||
    query.fetchStatus !== "idle" ||
    disabled ||
    (reopenOnly && !supervisor);
  const actionAllowed =
    !report?.stationOffBlocksAt &&
    (finalized
      ? ["reopen", "record_out"].includes(mode)
      : !["reopen", "record_out"].includes(mode)) &&
    (!reopenOnly || (supervisor && mode === "reopen"));
  const names = {
    dismiss: l("إقفال الحالة دون سفر", "Close case without travel"),
    close: l("إقفال المغادرة النهائي", "Close final DCS"),
    reopen: l("إعادة فتح المغادرة قبل OUT", "Reopen final DCS before OUT"),
    record_out: l(
      "تسجيل وقت مغادرة الموقف المرصود",
      "Record observed off-blocks time"
    ),
    downgrade: l("خفض المقصورة بعد مراجعة العرض", "Review cabin downgrade"),
    no_rec: l("حالة غياب سجل الحجز", "No Rec case"),
    go_show: l("حالة حضور دون ترتيب سابق", "Go Show case"),
    resolve: l("ربط حالة بحجز مؤكد", "Link case to funded reservation"),
    osi: l("إضافة معلومة تشغيلية للراكب", "Add passenger OSI"),
    block: l("حظر مقاعد خلال فترة", "Block seats over dates"),
    remap: l(
      "تحميل مخطط المقاعد بعد تغيير الطائرة",
      "Reload seat plan after equipment change"
    ),
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock || !report || query.error || !actionAllowed) return;
    setSaving(true);
    const base = { flightId, reason, expectedActorId, expectedTenantId };
    try {
      if (mode === "no_rec" || mode === "go_show") {
        const payload = {
          ...base,
          kind: mode,
          stationReference: reference.trim().toUpperCase(),
        };
        await open.mutateAsync({
          ...payload,
          idempotencyKey: key.forPayload(payload),
        });
      } else if (mode === "block") {
        const payload = {
          ...base,
          startDate,
          endDate,
          seatNumbers: seatList
            .toUpperCase()
            .trim()
            .split(/[\s,]+/),
        };
        await block.mutateAsync({
          ...payload,
          idempotencyKey: key.forPayload(payload),
        });
      } else if (mode === "dismiss") {
        const payload = { ...base, caseId: Number(caseId) };
        await dismiss.mutateAsync({
          ...payload,
          idempotencyKey: key.forPayload(payload),
        });
      } else if (
        mode === "close" ||
        mode === "reopen" ||
        mode === "record_out"
      ) {
        const payload = {
          ...base,
          action: mode,
          ...(mode === "record_out"
            ? { offBlocksAt: new Date(outTime + "Z").toISOString() }
            : {}),
        };
        await finalize.mutateAsync({
          ...payload,
          idempotencyKey: key.forPayload(payload),
        });
      } else if (mode === "remap") {
        const payload = { ...base, seatMapId: Number(mapId) };
        await remap.mutateAsync({
          ...payload,
          idempotencyKey: key.forPayload(payload),
        });
      } else {
        if (!p) return;
        const passenger = {
          ...base,
          passengerId: p.passengerId,
          bookingId: p.bookingId,
        };
        if (mode === "downgrade") {
          if (proposal && proposal.passengerId === p.passengerId) {
            const payload = {
              ...passenger,
              quoteEventId: proposal.eventId,
              expectedRefund: proposal.refundDue,
            };
            await confirm.mutateAsync({
              ...payload,
              idempotencyKey: key.forPayload(payload),
            });
            setProposal(null);
          } else {
            const result = await quote.mutateAsync({
              ...passenger,
              idempotencyKey: key.forPayload(passenger),
            });
            setProposal({
              passengerId: p.passengerId,
              eventId: result.eventId,
              refundDue: result.refundDue,
            });
            key.clear();
            return;
          }
        } else if (mode === "resolve") {
          const payload = { ...passenger, caseId: Number(caseId) };
          await resolve.mutateAsync({
            ...payload,
            idempotencyKey: key.forPayload(payload),
          });
        } else
          await osi.mutateAsync({
            ...passenger,
            idempotencyKey: key.forPayload(passenger),
          });
      }
      key.clear();
      setReason("");
      setReference("");
      setCase("");
      await Promise.all([
        query.refetch(),
        utils.dcsOperations.getDesk.invalidate({ flightId }),
      ]);
      toast.success(l("حُفظ الإجراء في سجل المحطة", "Station action recorded"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : l("تعذّر تنفيذ الإجراء", "Station action failed")
      );
    } finally {
      setSaving(false);
    }
  }
  function printReport() {
    if (
      !report ||
      query.error ||
      report.unresolvedServices ||
      !printTable.current
    )
      return;
    const page = window.open("", "_blank");
    if (!page) {
      toast.error(
        l("اسمح بفتح نافذة للطباعة", "Allow the print window to open")
      );
      return;
    }
    page.opener = null;
    const doc = page.document;
    doc.documentElement.lang = document.documentElement.lang;
    doc.documentElement.dir = document.documentElement.dir;
    doc.title = `${report.flightNumber} · ${meals ? l("قائمة الوجبات", "Meal list") : "APFAX (SSR / OSI)"}`;
    const heading = doc.createElement("h1");
    heading.textContent = doc.title;
    const departure = doc.createElement("p");
    departure.textContent = report.departureTime.toISOString();
    const style = doc.createElement("style");
    style.textContent =
      "body{font:14px sans-serif;margin:1cm}table{width:100%;border-collapse:collapse}td,th{border:1px solid #888;padding:.4em;text-align:start}tr{break-inside:avoid}";
    doc.head.append(style);
    doc.body.append(
      heading,
      departure,
      doc.importNode(printTable.current, true)
    );
    page.addEventListener("afterprint", () => page.close(), { once: true });
    page.focus();
    page.print();
  }
  function download() {
    if (!report || query.error || report.unresolvedServices > 0) return;
    const csv = [
      [
        "Flight",
        "UTC departure",
        "Passenger",
        "Seat",
        "Type",
        "Code",
        "Status",
        "OSI",
      ],
      ...rows.map(r => [
        report.flightNumber,
        report.departureTime.toISOString(),
        r.name,
        r.seat ?? "",
        r.category,
        r.code,
        r.status,
        r.note ?? "",
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        ["\uFEFF", csv.map(r => r.map(escapeCSV).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" }
      )
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `flight-${flightId}-${meals ? "meals" : "apfax"}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <OperationalReadState query={query}>
      {report && (
        <>
          <label>
            <input
              type="checkbox"
              checked={meals}
              onChange={e => setMeals(e.target.checked)}
            />{" "}
            {l("الوجبات فقط", "Meals only")}
          </label>
          <h3 className="font-semibold">
            {report.flightNumber} ·{" "}
            {meals ? l("قائمة الوجبات", "Meal list") : "APFAX (SSR / OSI)"}
          </h3>
          {report.unresolvedServices > 0 && (
            <p role="alert">
              {l(
                "طلبات تتطلب التحقق من القطاع قبل التصدير",
                "Requests requiring sector reconciliation before export"
              )}
              : {report.unresolvedServices}
            </p>
          )}
          <table ref={printTable} className="w-full text-start">
            <thead>
              <tr>
                {[
                  l("الراكب", "Passenger"),
                  l("المقعد", "Seat"),
                  l("الخدمة", "Service"),
                  l("الحالة", "Status"),
                  "OSI",
                ].map(h => (
                  <th className="text-start" key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{r.seat ?? "—"}</td>
                  <td>{r.code}</td>
                  <td>{r.status}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p>{l("لا توجد سجلات مطابقة", "No matching records")}</p>
          )}
          <Button
            variant="outline"
            disabled={query.isFetching || report.unresolvedServices > 0}
            onClick={download}
          >
            {l("تنزيل التقرير CSV", "Download CSV report")}
          </Button>
          <Button
            variant="outline"
            disabled={
              query.isFetching || !!query.error || report.unresolvedServices > 0
            }
            onClick={printReport}
          >
            {l("طباعة التقرير", "Print report")}
          </Button>
          <h3 className="font-semibold">
            {l("حالات المحطة", "Station cases")}
          </h3>
          <ul>
            {report.cases.map(c => (
              <li key={c.id}>
                {c.stationReference} · {names[c.kind]} ·{" "}
                {c.dismissed
                  ? l("أُقفلت دون سفر", "Closed without travel")
                  : c.resolvedPassengerId == null
                    ? l("مفتوحة", "Open")
                    : l("مربوطة بحجز", "Reservation linked")}
              </li>
            ))}
          </ul>
          {report.closedAt && (
            <p>
              {l("أُقفل مكتب المغادرة", "DCS closed")} ·{" "}
              {report.closedAt.toISOString()}
            </p>
          )}
          {report.stationOffBlocksAt && (
            <p>OUT (UTC) · {report.stationOffBlocksAt.toISOString()}</p>
          )}
          <form onSubmit={submit}>
            <fieldset disabled={lock} className="grid gap-2">
              <label>
                {l("إجراء المحطة", "Station action")}{" "}
                <select
                  value={mode}
                  onChange={e => {
                    setMode(e.target.value as Mode);
                    setProposal(null);
                    setReason("");
                  }}
                >
                  {(Object.keys(names) as Mode[])
                    .filter(m => !reopenOnly || m === "reopen")
                    .filter(
                      m =>
                        supervisor ||
                        [
                          "no_rec",
                          "go_show",
                          "resolve",
                          "dismiss",
                          "osi",
                        ].includes(m)
                    )
                    .map(m => (
                      <option key={m} value={m}>
                        {names[m]}
                      </option>
                    ))}
                </select>
              </label>
              {(mode === "no_rec" || mode === "go_show") && (
                <>
                  <label>
                    {l("مرجع الحالة في المحطة", "Station case reference")}
                    <Input
                      required
                      minLength={3}
                      maxLength={32}
                      pattern="[A-Za-z0-9\-]+"
                      value={reference}
                      onChange={e => setReference(e.target.value)}
                    />
                  </label>
                  <p>
                    {l(
                      "إنشاء الحالة لا يصدر تذكرة. اربطها بحجز مدفوع بعد التسوية.",
                      "Opening the case does not issue a ticket. Link the paid reservation after settlement."
                    )}
                  </p>
                </>
              )}
              {(mode === "resolve" || mode === "dismiss") && (
                <label>
                  {l("الحالة المفتوحة", "Open case")}{" "}
                  <select
                    required
                    value={caseId}
                    onChange={e => setCase(e.target.value)}
                  >
                    <option value="" />
                    {report.cases
                      .filter(
                        c => !c.dismissed && c.resolvedPassengerId == null
                      )
                      .map(c => (
                        <option key={c.id} value={c.id}>
                          {c.stationReference}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {(mode === "osi" ||
                mode === "resolve" ||
                mode === "downgrade") && (
                <label>
                  {l("راكب الرحلة", "Flight passenger")}{" "}
                  <select
                    required
                    value={passengerId}
                    onChange={e => {
                      setPassenger(e.target.value);
                      setProposal(null);
                    }}
                  >
                    <option value="" />
                    {passengers.map(v => (
                      <option key={v.passengerId} value={v.passengerId}>
                        {v.name} #{v.bookingId}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {mode === "block" && (
                <>
                  <label>
                    {l("بداية الفترة UTC", "First date UTC")}
                    <Input
                      type="date"
                      required
                      value={startDate}
                      onChange={e => setStart(e.target.value)}
                    />
                  </label>
                  <label>
                    {l("نهاية الفترة UTC", "Last date UTC")}
                    <Input
                      type="date"
                      required
                      min={startDate}
                      value={endDate}
                      onChange={e => setEnd(e.target.value)}
                    />
                  </label>
                  <label>
                    {l("المقاعد مفصولة بفاصلة", "Comma-separated seats")}
                    <Input
                      required
                      placeholder="2A,2B"
                      value={seatList}
                      onChange={e => setSeats(e.target.value)}
                    />
                  </label>
                </>
              )}
              {mode === "record_out" && (
                <label>
                  {l("وقت مغادرة الموقف UTC", "Observed off-blocks UTC")}
                  <Input
                    type="datetime-local"
                    step="1"
                    required
                    value={outTime}
                    onChange={e => setOutTime(e.target.value)}
                  />
                </label>
              )}
              {mode === "downgrade" && proposal && (
                <p role="status">
                  {l(
                    "فرق الأجرة المستحق للرد بالريال",
                    "Fare refund due in SAR"
                  )}
                  : {(proposal.refundDue / 100).toFixed(2)}
                </p>
              )}
              {mode === "remap" && (
                <label>
                  {l("رقم مخطط مقاعد الناقل", "Airline seat plan ID")}
                  <Input
                    required
                    type="number"
                    min="1"
                    value={mapId}
                    onChange={e => setMap(e.target.value)}
                  />
                </label>
              )}
              <label>
                {mode === "osi"
                  ? l(
                      "معلومة تشغيلية تظهر في تقرير APFAX",
                      "Operational note shown on APFAX"
                    )
                  : l("سبب الإجراء", "Reason for station action")}
                <Input
                  required
                  minLength={5}
                  maxLength={500}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
              </label>
              <Button type="submit" disabled={!actionAllowed}>
                {mode === "downgrade"
                  ? proposal
                    ? l(
                        "تأكيد خفض المقصورة بالقيمة المعروضة",
                        "Confirm reviewed cabin downgrade"
                      )
                    : l("عرض فرق الأجرة", "Quote fare difference")
                  : l("حفظ إجراء المحطة", "Save station action")}
              </Button>
            </fieldset>
          </form>
        </>
      )}
    </OperationalReadState>
  );
}
