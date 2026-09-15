import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { BaggageEntitlement } from "@/components/BaggageEntitlement";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AdminConsole,
  OperationalReadState,
  useOperationalLabels,
} from "@/components/OperationalReadState";
export default function BagDropManagement() {
  const l = useOperationalLabels();
  return (
    <AdminConsole title={l("إدارة تسليم الأمتعة", "Bag Drop Management")}>
      <BagDropConsole />
    </AdminConsole>
  );
}
function BagDropConsole() {
  const l = useOperationalLabels();
  const [airportId, setAirportId] = useState(0);
  const [bookingId, setBookingId] = useState(0);
  const [passengerId, setPassengerId] = useState(0);
  const period = useMemo(
    () => ({
      startDate: new Date(Date.now() - 86400000).toISOString(),
      endDate: new Date().toISOString(),
    }),
    []
  );
  const units = trpc.bagDrop.getUnits.useQuery(
    airportId > 0 ? { airportId } : undefined,
    { refetchInterval: 30000 }
  );
  const analytics = trpc.bagDrop.getAnalytics.useQuery(
    { airportId, ...period },
    { enabled: airportId > 0 }
  );
  return (
    <>
      <section className="space-y-2">
        <h2>{l("التحقق من سماح الأمتعة", "Verify baggage allowance")}</h2>
        <label>
          {l("رقم الحجز", "Booking ID")}
          <Input
            type="number"
            min={1}
            value={bookingId || ""}
            onChange={e => setBookingId(Number(e.target.value))}
          />
        </label>
        <label>
          {l("رقم المسافر", "Passenger ID")}
          <Input
            type="number"
            min={1}
            value={passengerId || ""}
            onChange={e => setPassengerId(Number(e.target.value))}
          />
        </label>
        {bookingId > 0 && passengerId > 0 && (
          <BaggageEntitlement bookingId={bookingId} passengerId={passengerId} />
        )}
      </section>
      <label>
        {l("رقم المطار للتحليلات", "Airport ID for analytics")}
        <Input
          type="number"
          min={1}
          value={airportId || ""}
          onChange={e => setAirportId(Number(e.target.value))}
        />
      </label>
      <Tabs defaultValue="stations">
        <TabsList>
          <TabsTrigger value="stations">{l("المحطات", "Stations")}</TabsTrigger>
          <TabsTrigger value="analytics">
            {l("التحليلات", "Analytics")}
          </TabsTrigger>
          <TabsTrigger value="maintenance">
            {l("الصيانة", "Maintenance")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="stations">
          <OperationalReadState query={units}>
            {units.data?.units.length === 0 && (
              <p>{l("لا توجد وحدات مسجلة", "No registered units")}</p>
            )}
            <table className="w-full">
              <thead>
                <tr>
                  <th>{l("الوحدة", "Unit")}</th>
                  <th>{l("الموقع", "Location")}</th>
                  <th>{l("الحالة", "Status")}</th>
                  <th>{l("آخر صيانة", "Last maintenance")}</th>
                </tr>
              </thead>
              <tbody>
                {units.data?.units.map(unit => (
                  <tr key={unit.id}>
                    <td>{unit.unitCode}</td>
                    <td>
                      {unit.terminal} / {unit.zone}
                    </td>
                    <td>{unit.status}</td>
                    <td>
                      {unit.lastMaintenance
                        ? new Date(unit.lastMaintenance).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </OperationalReadState>
        </TabsContent>
        <TabsContent value="analytics">
          <OperationalReadState query={analytics}>
            {analytics.data && (
              <dl className="grid grid-cols-2 gap-3">
                <dt>{l("الجلسات", "Sessions")}</dt>
                <dd>{analytics.data.totalSessions}</dd>
                <dt>{l("المكتملة", "Completed")}</dt>
                <dd>{analytics.data.completedSessions}</dd>
                <dt>{l("الفاشلة", "Errors")}</dt>
                <dd>{analytics.data.errorSessions}</dd>
                <dt>{l("المنتهية زمنيًا", "Timeouts")}</dt>
                <dd>{analytics.data.timeoutSessions}</dd>
                <dt>
                  {l("متوسط الزمن بالثواني", "Average duration in seconds")}
                </dt>
                <dd>{analytics.data.averageSessionDurationMs / 1000}</dd>
                <dt>{l("عدد الحقائب", "Bags processed")}</dt>
                <dd>{analytics.data.totalBagsProcessed}</dd>
                <dt>{l("الوزن بالكيلوغرام", "Weight in kilograms")}</dt>
                <dd>{analytics.data.totalWeightGrams / 1000}</dd>
                <dt>{l("رسوم الوزن الزائد بالريال", "Excess fees in SAR")}</dt>
                <dd>{analytics.data.totalExcessFeeCents / 100}</dd>
              </dl>
            )}
          </OperationalReadState>
        </TabsContent>
        <TabsContent value="maintenance">
          <p>
            {l(
              "سجل الصيانة التفصيلي غير متاح من المصدر الحالي. يظهر آخر تاريخ مسجل في قائمة الوحدات.",
              "Detailed maintenance history is unavailable from the current source. The units list shows the last recorded maintenance date."
            )}
          </p>
        </TabsContent>
      </Tabs>
    </>
  );
}
