import { BaggageCloseout } from "@/components/BaggageCloseout";
import { CouponMonthReview } from "@/components/CouponMonthReview";
import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import {
  OperationalReadState,
  useOperationalLabels,
} from "@/components/OperationalReadState";
import { SettlementLedgerDraft } from "@/components/SettlementLedgerDraft";
import { SupplierFinanceControl } from "@/components/SupplierFinanceControl";
import { InternalFundingRefund } from "@/components/InternalFundingRefund";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
export default function AirlineConsole() {
  const { user, loading } = useAuth();
  const l = useOperationalLabels();
  if (loading) return <p role="status">{l("جارٍ التحميل", "Loading")}</p>;
  if (
    !user ||
    !["airline_admin", "ops", "finance", "admin", "super_admin"].includes(
      user.role
    )
  )
    return <Redirect to="/" />;
  return (
    <DashboardLayout>
      <main className="space-y-6 p-6">
        <h1 className="text-2xl">
          {l("لوحة شركة الطيران", "Airline console")}
        </h1>
        {["airline_admin", "ops", "admin", "super_admin"].includes(
          user.role
        ) && <AirlineFlights />}
        {["airline_admin", "finance", "admin", "super_admin"].includes(
          user.role
        ) && (
          <>
            <SettlementLedgerDraft />
            <CouponMonthReview />
            <InternalFundingRefund />
            <SupplierFinanceControl />
          </>
        )}
      </main>
    </DashboardLayout>
  );
}
const FLIGHTS_PER_PAGE = 50;
type FlightCursor = { departureTime: Date; id: number };
function AirlineFlights() {
  const l = useOperationalLabels();
  const [cursors, setCursors] = useState<FlightCursor[]>([]);
  const query = trpc.operations.airlineFlights.useQuery({
    after: cursors.at(-1),
    limit: FLIGHTS_PER_PAGE + 1,
  });
  const pageFlights = query.data?.slice(0, FLIGHTS_PER_PAGE);

  const [flightId, setFlightId] = useState(0);
  const [status, setStatus] = useState<
    "scheduled" | "delayed" | "cancelled" | "completed"
  >("delayed");
  const [reason, setReason] = useState("");
  const update = trpc.admin.updateFlightStatus.useMutation({
    onSuccess: () => {
      toast.success(l("حُفظ انتقال الرحلة", "Flight transition recorded"));
      void query.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const selected = pageFlights?.find(f => f.id === flightId);
  function changePage(next: FlightCursor[]) {
    setFlightId(0);
    setReason("");
    setStatus("delayed");
    setCursors(next);
  }
  return (
    <section className="space-y-4">
      <h2>{l("رحلات الشركة", "Company flights")}</h2>
      <p>
        {l(
          "الرحلات مرتبة حسب المغادرة. الإلغاء يطلق مسار معالجة الحجوزات والاسترداد.",
          "Flights are ordered by departure. Cancellation starts booking recovery and refund processing."
        )}
      </p>
      <OperationalReadState query={query}>
        <table className="w-full">
          <thead>
            <tr>
              <th>{l("الرحلة", "Flight")}</th>
              <th>{l("المغادرة", "Departure")}</th>
              <th>{l("الحالة", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {pageFlights?.map(flight => (
              <tr key={flight.id}>
                <td>{flight.flightNumber}</td>
                <td>{flight.departureTime.toLocaleString()}</td>
                <td>{flight.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {query.data?.length === 0 && <p>{l("لا توجد رحلات", "No flights")}</p>}
      </OperationalReadState>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={cursors.length === 0}
          onClick={() => changePage(cursors.slice(0, -1))}
        >
          {l("الرحلات السابقة", "Previous flights")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={
            !query.data ||
            query.data.length <= FLIGHTS_PER_PAGE ||
            !!query.error
          }
          onClick={() => {
            const last = pageFlights?.at(-1);
            if (last)
              changePage([
                ...cursors,
                { departureTime: last.departureTime, id: last.id },
              ]);
          }}
        >
          {l("الرحلات التالية", "Next flights")}
        </Button>
      </div>
      <form
        onSubmit={e => {
          e.preventDefault();
          if (selected && !query.error)
            update.mutate({ flightId, status, reason });
        }}
        className="space-y-3"
      >
        <label className="block">
          {l("الرحلة", "Flight")}
          <select
            required
            value={flightId || ""}
            onChange={e => setFlightId(Number(e.target.value))}
          >
            <option value="">{l("اختر رحلة", "Select flight")}</option>
            {pageFlights?.map(f => (
              <option key={f.id} value={f.id}>
                {f.flightNumber} ({f.id})
              </option>
            ))}
          </select>
        </label>
        {selected && !query.error && <BaggageCloseout flightId={flightId} />}
        <label className="block">
          {l("الحالة الجديدة", "New status")}
          <select
            value={status}
            onChange={e => setStatus(e.target.value as typeof status)}
          >
            {(["scheduled", "delayed", "cancelled", "completed"] as const).map(
              s => (
                <option key={s} value={s}>
                  {s}
                </option>
              )
            )}
          </select>
        </label>
        <label className="block">
          {l("سبب الانتقال", "Transition reason")}
          <Input
            required
            minLength={5}
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
        </label>
        <Button disabled={!selected || update.isPending || !!query.error}>
          {l("تنفيذ الانتقال", "Apply transition")}
        </Button>
      </form>
    </section>
  );
}
