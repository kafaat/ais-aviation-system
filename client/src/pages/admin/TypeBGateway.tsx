import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AdminConsole,
  OperationalReadState,
  useOperationalLabels,
} from "@/components/OperationalReadState";

const MESSAGE_TYPES = ["PNL", "ADL", "LDM", "MVT", "BSM", "BPM"] as const;

export default function TypeBGateway() {
  const l = useOperationalLabels();
  return (
    <AdminConsole title={l("بوابة رسائل Type B", "Type B Messaging Gateway")}>
      <TypeBConsole />
    </AdminConsole>
  );
}

function TypeBConsole() {
  const l = useOperationalLabels();
  const status = trpc.typeb.status.useQuery(undefined, {
    refetchInterval: 30000,
  });
  return (
    <>
      <OperationalReadState query={status}>
        {status.data && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>{l("النقل", "Transport")}</dt>
            <dd>{status.data.transportMode}</dd>
            <dt>{l("عنوان المصدر", "Origin address")}</dt>
            <dd>
              {status.data.originAddress ?? l("غير مضبوط", "Not configured")}
            </dd>
            <dt>{l("مهلة PNL بالدقائق", "PNL lead minutes")}</dt>
            <dd>{status.data.pnlLeadMinutes}</dd>
            <dt>{l("الرسائل", "Messages")}</dt>
            <dd>
              {status.data.counts.length === 0
                ? "0"
                : status.data.counts
                    .map(c => `${c.direction}/${c.status}: ${c.count}`)
                    .join(", ")}
            </dd>
          </dl>
        )}
        <p className="text-sm text-muted-foreground">
          {l(
            "الصيغ والطابور محليان؛ نقل SITA/ARINC وتبادل العينات مع المناول غير مسجلين.",
            "Formats and queue are local; SITA/ARINC transport and handler sample exchange are not recorded."
          )}
        </p>
      </OperationalReadState>
      <Tabs defaultValue="addresses">
        <TabsList>
          <TabsTrigger value="addresses">
            {l("ملف المحطة", "Station file")}
          </TabsTrigger>
          <TabsTrigger value="queue">{l("الطابور", "Queue")}</TabsTrigger>
          <TabsTrigger value="preview">{l("توليد", "Generate")}</TabsTrigger>
          <TabsTrigger value="inbound">{l("وارد", "Inbound")}</TabsTrigger>
        </TabsList>
        <TabsContent value="addresses">
          <AddressesTab />
        </TabsContent>
        <TabsContent value="queue">
          <QueueTab />
        </TabsContent>
        <TabsContent value="preview">
          <GenerateTab />
        </TabsContent>
        <TabsContent value="inbound">
          <InboundTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

function AddressesTab() {
  const l = useOperationalLabels();
  const utils = trpc.useUtils();
  const addresses = trpc.typeb.listAddresses.useQuery();
  const upsert = trpc.typeb.upsertAddress.useMutation({
    onSuccess: () => void utils.typeb.listAddresses.invalidate(),
  });
  const remove = trpc.typeb.removeAddress.useMutation({
    onSuccess: () => void utils.typeb.listAddresses.invalidate(),
  });
  const [address, setAddress] = useState("");
  const [stationCode, setStationCode] = useState("");
  const [handlerName, setHandlerName] = useState("");
  const [types, setTypes] = useState<string[]>(["PNL", "ADL"]);
  return (
    <div className="space-y-4">
      <form
        className="grid gap-2 md:grid-cols-4"
        onSubmit={e => {
          e.preventDefault();
          upsert.mutate({
            address,
            stationCode: stationCode || null,
            handlerName,
            messageTypes: types as (typeof MESSAGE_TYPES)[number][],
          });
        }}
      >
        <label>
          {l("العنوان (7 أحرف)", "Address (7 chars)")}
          <Input
            value={address}
            maxLength={7}
            onChange={e => setAddress(e.target.value.toUpperCase())}
            required
          />
        </label>
        <label>
          {l("المحطة (فارغ = الكل)", "Station (blank = all)")}
          <Input
            value={stationCode}
            maxLength={3}
            onChange={e => setStationCode(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          {l("المناول", "Handler")}
          <Input
            value={handlerName}
            onChange={e => setHandlerName(e.target.value)}
            required
          />
        </label>
        <fieldset className="flex flex-wrap gap-2 items-end">
          {MESSAGE_TYPES.map(t => (
            <label key={t} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={types.includes(t)}
                onChange={e =>
                  setTypes(
                    e.target.checked
                      ? [...types, t]
                      : types.filter(x => x !== t)
                  )
                }
              />
              {t}
            </label>
          ))}
          <Button type="submit" disabled={upsert.isPending}>
            {l("حفظ", "Save")}
          </Button>
        </fieldset>
      </form>
      {upsert.error && <p role="alert">{upsert.error.message}</p>}
      <OperationalReadState query={addresses}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th>{l("العنوان", "Address")}</th>
              <th>{l("المحطة", "Station")}</th>
              <th>{l("المناول", "Handler")}</th>
              <th>{l("الأنواع", "Types")}</th>
              <th>{l("مفعّل", "Enabled")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {addresses.data?.map(a => (
              <tr key={a.id}>
                <td>{a.address}</td>
                <td>{a.stationCode ?? "*"}</td>
                <td>{a.handlerName}</td>
                <td>{a.messageTypes.join(" ")}</td>
                <td>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      upsert.mutate({
                        id: a.id,
                        address: a.address,
                        stationCode: a.stationCode,
                        handlerName: a.handlerName,
                        messageTypes:
                          a.messageTypes as (typeof MESSAGE_TYPES)[number][],
                        enabled: !a.enabled,
                      })
                    }
                  >
                    {a.enabled ? l("نعم", "Yes") : l("لا", "No")}
                  </Button>
                </td>
                <td>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => remove.mutate({ id: a.id })}
                  >
                    {l("حذف", "Delete")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {addresses.data?.length === 0 && (
          <p>
            {l(
              "لا عناوين؛ لن تُولَّد رسائل آلية حتى يُضاف عنوان مشترك.",
              "No addresses; automatic messages are not generated until a subscribed address exists."
            )}
          </p>
        )}
      </OperationalReadState>
    </div>
  );
}

function QueueTab() {
  const l = useOperationalLabels();
  const utils = trpc.useUtils();
  const [direction, setDirection] = useState<"outbound" | "inbound">(
    "outbound"
  );
  const messages = trpc.typeb.listMessages.useQuery(
    { direction, limit: 100 },
    { refetchInterval: 30000 }
  );
  const retry = trpc.typeb.retryMessage.useMutation({
    onSuccess: () => void utils.typeb.listMessages.invalidate(),
  });
  const ack = trpc.typeb.acknowledgeMessage.useMutation({
    onSuccess: () => void utils.typeb.listMessages.invalidate(),
  });
  const tick = trpc.typeb.runTick.useMutation({
    onSuccess: () => void utils.typeb.invalidate(),
  });
  const [open, setOpen] = useState<number | null>(null);
  const detail = trpc.typeb.getMessage.useQuery(
    { id: open ?? 0 },
    { enabled: open !== null }
  );
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          variant={direction === "outbound" ? "default" : "outline"}
          onClick={() => setDirection("outbound")}
        >
          {l("صادر", "Outbound")}
        </Button>
        <Button
          variant={direction === "inbound" ? "default" : "outline"}
          onClick={() => setDirection("inbound")}
        >
          {l("وارد", "Inbound")}
        </Button>
        <Button
          variant="secondary"
          disabled={tick.isPending}
          onClick={() => tick.mutate()}
        >
          {l("تشغيل دورة الآن", "Run tick now")}
        </Button>
      </div>
      {tick.error && <p role="alert">{tick.error.message}</p>}
      {tick.data && (
        <p className="text-sm">
          {l("النقل", "Transport")}: {tick.data.transport ?? "disabled"} ·{" "}
          {l("أُرسل", "sent")} {tick.data.outbound.sent} · PNL{" "}
          {tick.data.pnl.queued} · {l("أحداث", "events")}{" "}
          {tick.data.events.processed}
        </p>
      )}
      <OperationalReadState query={messages}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>{l("النوع", "Type")}</th>
              <th>{l("الرحلة", "Flight")}</th>
              <th>{l("المحطة", "Station")}</th>
              <th>{l("الحالة", "Status")}</th>
              <th>{l("محاولات", "Attempts")}</th>
              <th>{l("أُنشئ", "Created")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {messages.data?.map(m => (
              <tr key={m.id}>
                <td>
                  <button className="underline" onClick={() => setOpen(m.id)}>
                    {m.id}
                  </button>
                </td>
                <td>{m.messageType}</td>
                <td>
                  {m.flightDesignator ?? "—"} {m.flightDate ?? ""}
                </td>
                <td>{m.station ?? "—"}</td>
                <td title={m.lastError ?? undefined}>{m.status}</td>
                <td>{m.attempts}</td>
                <td>{new Date(m.createdAt).toLocaleString()}</td>
                <td className="flex gap-1">
                  {m.status === "failed" && m.direction === "outbound" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retry.mutate({ id: m.id })}
                    >
                      {l("إعادة", "Retry")}
                    </Button>
                  )}
                  {m.status === "sent" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => ack.mutate({ id: m.id })}
                    >
                      {l("إقرار", "Ack")}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {messages.data?.length === 0 && <p>{l("لا رسائل", "No messages")}</p>}
      </OperationalReadState>
      {open !== null && detail.data && (
        <section className="space-y-2">
          <h3>
            {l("الرسالة", "Message")} {detail.data.id} ·{" "}
            {detail.data.addresses.join(" ")}
          </h3>
          <pre className="whitespace-pre-wrap border p-2 text-xs">
            {detail.data.body}
          </pre>
          {detail.data.lastError && <p role="alert">{detail.data.lastError}</p>}
          {detail.data.parsed && (
            <pre className="whitespace-pre-wrap border p-2 text-xs">
              {JSON.stringify(detail.data.parsed, null, 2)}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}

function GenerateTab() {
  const l = useOperationalLabels();
  const [flightId, setFlightId] = useState(0);
  const [enqueue, setEnqueue] = useState(false);
  const [registration, setRegistration] = useState("");
  const pnl = trpc.typeb.generatePnl.useMutation();
  const mvt = trpc.typeb.generateMvt.useMutation();
  const result = pnl.data ?? mvt.data;
  const error = pnl.error ?? mvt.error;
  return (
    <div className="space-y-3">
      <label>
        {l("رقم الرحلة الداخلي", "Flight ID")}
        <Input
          type="number"
          min={1}
          value={flightId || ""}
          onChange={e => setFlightId(Number(e.target.value))}
        />
      </label>
      <label>
        {l("تسجيل الطائرة (لرسالة MVT)", "Registration (for MVT)")}
        <Input
          value={registration}
          onChange={e => setRegistration(e.target.value.toUpperCase())}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enqueue}
          onChange={e => setEnqueue(e.target.checked)}
        />
        {l("إدراج في الطابور (وإلا معاينة فقط)", "Queue (otherwise preview)")}
      </label>
      <div className="flex gap-2">
        <Button
          disabled={flightId <= 0 || pnl.isPending}
          onClick={() => pnl.mutate({ flightId, enqueue })}
        >
          PNL
        </Button>
        <Button
          variant="outline"
          disabled={flightId <= 0 || mvt.isPending}
          onClick={() =>
            mvt.mutate({
              flightId,
              enqueue,
              registration: registration || undefined,
              movement: { kind: "NI", nextInformation: new Date() },
            })
          }
        >
          MVT NI
        </Button>
      </div>
      {error && <p role="alert">{error.message}</p>}
      {result && "parts" in result && (
        <>
          <p className="text-sm">
            {l("المستلمون", "Recipients")}:{" "}
            {result.addresses.join(" ") || l("لا أحد", "none")}
          </p>
          {result.parts.map((part, i) => (
            <pre key={i} className="whitespace-pre-wrap border p-2 text-xs">
              {part}
            </pre>
          ))}
        </>
      )}
      {result && "ids" in result && (
        <p>
          {l("أُدرج", "Queued")}: {result.ids.join(", ")}
        </p>
      )}
    </div>
  );
}

function InboundTab() {
  const l = useOperationalLabels();
  const utils = trpc.useUtils();
  const [raw, setRaw] = useState("");
  const ingest = trpc.typeb.ingestInbound.useMutation({
    onSuccess: () => void utils.typeb.listMessages.invalidate(),
  });
  return (
    <div className="space-y-2">
      <Textarea
        rows={10}
        value={raw}
        onChange={e => setRaw(e.target.value)}
        placeholder={
          "QU RUHKKXY\n.JEDKPXY 031410\nMVT\nXY123/03.HZASA.JED\nAA1358/1406"
        }
      />
      <Button
        disabled={!raw.trim() || ingest.isPending}
        onClick={() => ingest.mutate({ raw })}
      >
        {l("استيراد", "Ingest")}
      </Button>
      {ingest.error && <p role="alert">{ingest.error.message}</p>}
      {ingest.data && (
        <p>
          {ingest.data.type} · {ingest.data.status}
          {ingest.data.duplicate ? ` · ${l("مكرر", "duplicate")}` : ""}
          {"error" in ingest.data && ingest.data.error
            ? ` · ${ingest.data.error}`
            : ""}
        </p>
      )}
    </div>
  );
}
