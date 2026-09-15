import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  AdminConsole,
  OperationalReadState,
  useOperationalLabels,
} from "@/components/OperationalReadState";
export default function KioskManagement() {
  const l = useOperationalLabels();
  return (
    <AdminConsole title={l("إدارة الأكشاك", "Kiosk Management")}>
      <KioskConsole />
    </AdminConsole>
  );
}
function KioskConsole() {
  const l = useOperationalLabels();
  const [airportId, setAirportId] = useState(0);
  const [form, setForm] = useState({
    airportId: "",
    terminal: "",
    location: "",
    hardwareType: "",
    hasPrinter: true,
    hasScanner: true,
    hasPayment: false,
  });
  const period = useMemo(
    () => ({ from: new Date(Date.now() - 7 * 86400000), to: new Date() }),
    []
  );
  const devices = trpc.kiosk.getDevices.useQuery(
    airportId > 0 ? { airportId } : undefined,
    { refetchInterval: 30000 }
  );
  const analytics = trpc.kiosk.getAnalytics.useQuery(
    { airportId, ...period },
    { enabled: airportId > 0 }
  );
  const register = trpc.kiosk.registerDevice.useMutation({
    onSuccess: () => {
      toast.success(l("سُجّل الجهاز", "Device registered"));
      void devices.refetch();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <>
      <label>
        {l("رقم المطار للتحليلات", "Airport ID for analytics")}
        <Input
          type="number"
          min={1}
          value={airportId || ""}
          onChange={e => setAirportId(Number(e.target.value))}
        />
      </label>
      <Tabs defaultValue="devices">
        <TabsList>
          <TabsTrigger value="devices">{l("الأجهزة", "Devices")}</TabsTrigger>
          <TabsTrigger value="analytics">
            {l("التحليلات", "Analytics")}
          </TabsTrigger>
          <TabsTrigger value="register">
            {l("تسجيل جهاز", "Register Device")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="devices">
          <OperationalReadState query={devices}>
            {devices.data?.length === 0 && (
              <p>{l("لا توجد أجهزة مسجلة", "No registered devices")}</p>
            )}
            <table className="w-full">
              <thead>
                <tr>
                  <th>{l("الجهاز", "Device")}</th>
                  <th>{l("الموقع", "Location")}</th>
                  <th>{l("الحالة", "Status")}</th>
                  <th>{l("آخر اتصال", "Last heartbeat")}</th>
                </tr>
              </thead>
              <tbody>
                {devices.data?.map(device => (
                  <tr key={device.id}>
                    <td>{device.kioskCode}</td>
                    <td>
                      {device.terminal} / {device.location}
                    </td>
                    <td>{device.status}</td>
                    <td>
                      {device.lastHeartbeat
                        ? new Date(device.lastHeartbeat).toLocaleString()
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
              <>
                <dl className="grid grid-cols-2 gap-3">
                  <dt>{l("الجلسات", "Sessions")}</dt>
                  <dd>{analytics.data.totals.totalSessions}</dd>
                  <dt>{l("المكتملة", "Completed")}</dt>
                  <dd>{analytics.data.totals.completedSessions}</dd>
                  <dt>{l("الأخطاء", "Errors")}</dt>
                  <dd>{analytics.data.totals.errorSessions}</dd>
                  <dt>
                    {l("بطاقات الصعود المطبوعة", "Boarding passes printed")}
                  </dt>
                  <dd>{analytics.data.totals.boardingPassesPrinted}</dd>
                  <dt>{l("بطاقات الأمتعة", "Bag tags printed")}</dt>
                  <dd>{analytics.data.totals.bagTagsPrinted}</dd>
                </dl>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th>{l("الكشك", "Kiosk")}</th>
                      <th>{l("الجلسات", "Sessions")}</th>
                      <th>{l("متوسط الثواني", "Average seconds")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.data.kiosks.map(kiosk => (
                      <tr key={kiosk.kioskId}>
                        <td>{kiosk.kioskCode}</td>
                        <td>{kiosk.totalSessions}</td>
                        <td>{kiosk.avgSessionDurationSec}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </OperationalReadState>
        </TabsContent>
        <TabsContent value="register">
          <form
            className="space-y-3"
            onSubmit={e => {
              e.preventDefault();
              register.mutate({ ...form, airportId: Number(form.airportId) });
            }}
          >
            {(
              [
                ["airportId", l("رقم المطار", "Airport ID")],
                ["terminal", l("الصالة", "Terminal")],
                ["location", l("الموقع", "Location")],
                ["hardwareType", l("نوع الجهاز", "Hardware type")],
              ] as const
            ).map(([key, label]) => (
              <label className="block" key={key}>
                {label}
                <Input
                  required={key !== "hardwareType"}
                  value={form[key]}
                  onChange={e => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            {(
              [
                ["hasPrinter", l("طابعة", "Printer")],
                ["hasScanner", l("ماسح", "Scanner")],
                ["hasPayment", l("جهاز دفع", "Payment terminal")],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={e => setForm({ ...form, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
            <Button disabled={register.isPending}>
              {l("تسجيل", "Register")}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </>
  );
}
