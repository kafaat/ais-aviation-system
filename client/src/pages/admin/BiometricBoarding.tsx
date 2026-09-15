import { useState } from "react";
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

export default function BiometricBoarding() {
  const l = useOperationalLabels();
  return (
    <AdminConsole title={l("الصعود البيومتري", "Biometric Boarding")}>
      <BiometricConsole />
    </AdminConsole>
  );
}
function BiometricConsole() {
  const l = useOperationalLabels();
  const [gateId, setGateId] = useState(0);
  const [form, setForm] = useState({
    gateId: "",
    airportId: "",
    deviceType: "",
    firmwareVersion: "",
  });
  const gate = trpc.biometric.getGateStatus.useQuery(
    { gateId },
    { enabled: gateId > 0 }
  );
  const events = trpc.biometric.getEvents.useQuery(
    { limit: 50, offset: 0 },
    { refetchInterval: 30000 }
  );
  const configure = trpc.biometric.configureGate.useMutation({
    onSuccess: () => {
      toast.success(l("حُفظ الإعداد", "Configuration saved"));
      void gate.refetch();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <>
      <p>
        {l(
          "تعرض هذه الشاشة الأحداث والحالة المسجلة؛ اعتماد الأجهزة والتعرّف البيومتري متطلب مستقل.",
          "This screen shows recorded events and device status; hardware and biometric acceptance remain separate."
        )}
      </p>
      <Tabs defaultValue="gates">
        <TabsList>
          <TabsTrigger value="gates">
            {l("حالة البوابات", "Gate Status")}
          </TabsTrigger>
          <TabsTrigger value="events">
            {l("سجل الأحداث", "Events Log")}
          </TabsTrigger>
          <TabsTrigger value="config">
            {l("الإعدادات", "Configuration")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="gates">
          <label>
            {l("رقم البوابة", "Gate ID")}
            <Input
              type="number"
              min={1}
              value={gateId || ""}
              onChange={e => setGateId(Number(e.target.value))}
            />
          </label>
          <OperationalReadState query={gate}>
            {gate.data && (
              <dl className="space-y-2">
                <dt>{l("الحالة", "Status")}</dt>
                <dd>{gate.data.status}</dd>
                <dt>{l("الجاهزية", "Readiness")}</dt>
                <dd>
                  {gate.data.ready
                    ? l("جاهزة", "Ready")
                    : l("غير جاهزة", "Not ready")}
                </dd>
                <dt>{l("الجهاز", "Device")}</dt>
                <dd>{gate.data.deviceType ?? l("غير متاح", "Unavailable")}</dd>
                <dt>{l("آخر معايرة", "Last calibration")}</dt>
                <dd>
                  {gate.data.lastCalibration?.toLocaleString() ??
                    l("غير متاح", "Unavailable")}
                </dd>
                {gate.data.issues.map(issue => (
                  <dd key={issue}>{issue}</dd>
                ))}
              </dl>
            )}
          </OperationalReadState>
        </TabsContent>
        <TabsContent value="events">
          <OperationalReadState query={events}>
            <p>
              {l("إجمالي الأحداث", "Total events")}: {events.data?.total}
            </p>
            {events.data?.events.length === 0 && (
              <p>{l("لا توجد أحداث مسجلة", "No recorded events")}</p>
            )}
            <table className="w-full text-start">
              <thead>
                <tr>
                  <th>{l("الوقت", "Time")}</th>
                  <th>{l("المسافر", "Passenger")}</th>
                  <th>{l("الحدث", "Event")}</th>
                  <th>{l("الثقة", "Confidence")}</th>
                </tr>
              </thead>
              <tbody>
                {events.data?.events.map(event => (
                  <tr key={event.id}>
                    <td>{new Date(event.createdAt).toLocaleString()}</td>
                    <td>{event.passengerId}</td>
                    <td>{event.eventType}</td>
                    <td>{event.confidence ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </OperationalReadState>
        </TabsContent>
        <TabsContent value="config">
          <form
            className="space-y-3"
            onSubmit={e => {
              e.preventDefault();
              configure.mutate({
                ...form,
                gateId: Number(form.gateId),
                airportId: Number(form.airportId),
                status: "offline",
              });
            }}
          >
            {(
              [
                ["gateId", l("رقم البوابة", "Gate ID")],
                ["airportId", l("رقم المطار", "Airport ID")],
                ["deviceType", l("نوع الجهاز", "Device type")],
                ["firmwareVersion", l("إصدار البرنامج", "Firmware version")],
              ] as const
            ).map(([key, label]) => (
              <label className="block" key={key}>
                {label}
                <Input
                  required={key !== "firmwareVersion"}
                  value={form[key]}
                  onChange={e => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <p>
              {l(
                "تسجيل الجهاز لا يثبت اتصاله أو نجاح التحقق.",
                "Registration does not attest connectivity or successful verification."
              )}
            </p>
            <Button disabled={configure.isPending}>
              {l("حفظ", "Save configuration")}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </>
  );
}
