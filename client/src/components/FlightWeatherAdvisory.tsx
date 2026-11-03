import { useState } from "react";
import { icaoCode, type FieldWeather } from "@shared/aviation-weather";
import { trpc } from "@/lib/trpc";
import { useOperationalLabels } from "./OperationalReadState";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";

function AirportBulletin({
  field,
  onMapped,
}: {
  field: FieldWeather;
  onMapped: () => void;
}) {
  const l = useOperationalLabels();
  const [station, setStation] = useState("");
  const [evidence, setEvidence] = useState("");
  const mapping = trpc.weather.mapStation.useMutation({ onSuccess: onMapped });
  const coverage = {
    station_unmapped: l("لا توجد محطة مربوطة", "Station not mapped"),
    no_observation: l("لا توجد نشرة", "No bulletin"),
    stale_observation: l(
      "نشرة خارج فترة الصلاحية",
      "Bulletin outside freshness window"
    ),
    classified:
      field.flightCategory ??
      l("قياسات غير كافية للتصنيف", "Insufficient measurements for category"),
  };
  const concerns = {
    low_visibility: l("ضعف الرؤية", "Low visibility"),
    low_ceiling: l("سقف سحب منخفض", "Low ceiling"),
    strong_wind: l("رياح قوية", "Strong wind"),
    gusting: l("هبات رياح", "Wind gusts"),
    freezing: l("تجمد", "Freezing"),
  };
  return (
    <section className="space-y-2 border p-3">
      <h3>
        {field.role === "origin"
          ? l("المغادرة", "Origin")
          : l("الوصول", "Destination")}{" "}
        · {field.airportCode} {field.icaoCode && <bdi>({field.icaoCode})</bdi>}
      </h3>
      <p>{coverage[field.coverage]}</p>
      {field.coverage === "classified" && field.concerns.length > 0 && (
        <p>{field.concerns.map(c => concerns[c]).join(" · ")}</p>
      )}
      {field.issuedAt && (
        <p>
          {l("صدرت في", "Issued at")}{" "}
          <time dateTime={field.issuedAt}>{field.issuedAt}</time>
        </p>
      )}
      {field.rawText && (
        <pre dir="ltr" className="whitespace-pre-wrap">
          {field.rawText}
        </pre>
      )}
      {field.coverage === "station_unmapped" && (
        <form
          className="space-y-2"
          onSubmit={e => {
            e.preventDefault();
            const code = icaoCode.safeParse(station);
            if (
              code.success &&
              evidence.trim().length >= 5 &&
              !mapping.isPending
            )
              mapping.mutate({
                airportId: field.airportId,
                icaoCode: code.data,
                mappingEvidence: evidence.trim(),
              });
          }}
        >
          <label>
            {l("محطة ICAO", "ICAO station")}
            <Input
              value={station}
              maxLength={4}
              required
              onChange={e => setStation(e.target.value.toUpperCase())}
            />
          </label>
          <label>
            {l("مرجع التحقق من المحطة", "Station verification reference")}
            <Input
              value={evidence}
              minLength={5}
              maxLength={255}
              required
              onChange={e => setEvidence(e.target.value)}
            />
          </label>
          <Button
            disabled={
              mapping.isPending ||
              !icaoCode.safeParse(station).success ||
              evidence.trim().length < 5
            }
          >
            {l("حفظ الربط بالمطار", "Save airport station mapping")}
          </Button>
          {mapping.error && <p role="alert">{mapping.error.message}</p>}
        </form>
      )}
    </section>
  );
}

function FlightBulletins({ flightId }: { flightId: number }) {
  const l = useOperationalLabels();
  const query = trpc.weather.flightAdvisory.useQuery(
    { flightId },
    { retry: false, refetchInterval: 60_000 }
  );
  const refresh = trpc.weather.refresh.useMutation({
    onSuccess: () => {
      void query.refetch();
    },
  });
  if (query.isError)
    return (
      <div role="alert">
        {query.error.message}{" "}
        <Button onClick={() => void query.refetch()}>
          {l("إعادة المحاولة", "Retry")}
        </Button>
      </div>
    );
  if (!query.data)
    return <p role="status">{l("جارٍ قراءة النشرات", "Loading bulletins")}</p>;
  const { evaluatedAt, fields } = query.data;
  const airportIds = [
    ...new Set(fields.filter(f => f.icaoCode).map(f => f.airportId)),
  ];
  return (
    <div className="space-y-3">
      <p>
        {l("الرحلة", "Flight")} #{flightId} · {l("التقييم في", "Evaluated at")}{" "}
        <time dateTime={evaluatedAt}>{evaluatedAt}</time>
      </p>
      {fields.map(field => (
        <AirportBulletin
          key={field.role + "-" + field.airportId}
          field={field}
          onMapped={() => void query.refetch()}
        />
      ))}
      <Button
        variant="outline"
        disabled={!airportIds.length || refresh.isPending}
        onClick={() => refresh.mutate({ airportIds, kind: "metar" })}
      >
        {l("جلب METAR من المصدر المهيأ", "Fetch METAR from configured source")}
      </Button>
      {refresh.error && <p role="alert">{refresh.error.message}</p>}
      {refresh.data && (
        <p role="status">
          {l("النشرات المستلمة", "Bulletins received")}: {refresh.data.fetched}{" "}
          · {l("أضيفت", "Stored")}: {refresh.data.stored} ·{" "}
          {l("مكررة", "Duplicates")}: {refresh.data.duplicates} ·{" "}
          {l("مطارات غير مربوطة", "Unmapped airports")}:{" "}
          {refresh.data.unmapped.length}
        </p>
      )}
    </div>
  );
}

export function FlightWeatherAdvisory() {
  const l = useOperationalLabels();
  const [draftId, setDraftId] = useState("");
  const [flightId, setFlightId] = useState(0);
  const id = Number(draftId);
  return (
    <Card className="space-y-3 p-4">
      <h2>{l("نشرات طقس الرحلة", "Flight weather advisory")}</h2>
      <p>
        {l(
          "للاسترشاد. تحقق من مصدر الطقس المعتمد لدى المشغّل قبل اتخاذ قرار.",
          "Advisory only. Verify against the operator’s dispatch weather source before acting."
        )}
      </p>
      <form
        onSubmit={e => {
          e.preventDefault();
          if (Number.isSafeInteger(id) && id > 0) setFlightId(id);
        }}
      >
        <label>
          {l("رقم الرحلة الداخلي للطقس", "Weather flight ID")}
          <Input
            value={draftId}
            type="number"
            min={1}
            step={1}
            required
            onChange={e => {
              setDraftId(e.target.value);
              setFlightId(0);
            }}
          />
        </label>
        <Button>{l("عرض نشرات الرحلة", "Show flight bulletins")}</Button>
      </form>
      {flightId > 0 && <FlightBulletins key={flightId} flightId={flightId} />}
    </Card>
  );
}
