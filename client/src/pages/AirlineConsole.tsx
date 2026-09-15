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
        ) && <SettlementLedgerDraft />}
      </main>
    </DashboardLayout>
  );
}
function AirlineFlights() {
  const l = useOperationalLabels();
  const query = trpc.operations.airlineFlights.useQuery();
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
  return (
    <section className="space-y-4">
      <h2>{l("رحلات الشركة", "Company flights")}</h2>
      <p>
        {l(
          "تُعرض أول 200 رحلة مرتبة حسب المغادرة. الإلغاء يطلق مسار معالجة الحجوزات والاسترداد.",
          "Showing up to 200 flights ordered by departure. Cancellation starts booking recovery and refund processing."
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
            {query.data?.map(flight => (
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
      <form
        onSubmit={e => {
          e.preventDefault();
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
            {query.data?.map(f => (
              <option key={f.id} value={f.id}>
                {f.flightNumber} ({f.id})
              </option>
            ))}
          </select>
        </label>
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
        <Button disabled={!flightId || update.isPending || !!query.error}>
          {l("تنفيذ الانتقال", "Apply transition")}
        </Button>
      </form>
    </section>
  );
}
