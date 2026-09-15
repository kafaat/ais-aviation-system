import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export interface FlightProgressProps {
  departureTime: Date | string;
  arrivalTime: Date | string;
  origin: string;
  destination: string;
  originCode: string;
  destinationCode: string;
  flightNumber: string;
  distanceKm?: number;
  showFlightData?: boolean;
  className?: string;
  telemetry?: {
    altitude: number;
    groundSpeed: number;
    heading: number;
    distanceRemaining: number | null;
    recordedAt: Date | string;
  } | null;
}
export function FlightProgress(props: FlightProgressProps) {
  const { i18n } = useTranslation();
  const l = (ar: string, en: string) =>
    i18n.language.startsWith("ar") ? ar : en;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const start = new Date(props.departureTime).getTime(),
    end = new Date(props.arrivalTime).getTime();
  const progress =
    end > start
      ? Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100))
      : null;
  const observation = props.telemetry;
  const age = observation
    ? now - new Date(observation.recordedAt).getTime()
    : null;
  const current =
    age !== null && age >= 0 && age <= 5 * 60000 ? observation : null;
  return (
    <Card className={props.className}>
      <CardHeader>
        <CardTitle>
          {props.flightNumber}: {props.originCode} → {props.destinationCode}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>
          {l(
            "تقدم زمني تقديري حسب الجدول؛ لا يثبت موضع الطائرة أو وصولها.",
            "Estimated schedule progress; it does not attest aircraft position or arrival."
          )}
        </p>
        {progress !== null && (
          <progress
            aria-label={l("تقدم الجدول", "Schedule progress")}
            className="w-full"
            max={100}
            value={progress}
          />
        )}
        <p>
          {new Date(props.departureTime).toLocaleString()} —{" "}
          {new Date(props.arrivalTime).toLocaleString()}
        </p>
        {props.showFlightData &&
          (current ? (
            <dl className="grid grid-cols-2 gap-2">
              <dt>{l("الارتفاع بالقدم", "Altitude (ft)")}</dt>
              <dd>{current.altitude.toLocaleString()}</dd>
              <dt>{l("السرعة الأرضية", "Ground speed")}</dt>
              <dd>{current.groundSpeed}</dd>
              <dt>{l("الاتجاه بالدرجات", "Heading (degrees)")}</dt>
              <dd>{current.heading}</dd>
              <dt>{l("المسافة المتبقية", "Distance remaining")}</dt>
              <dd>{current.distanceRemaining ?? "—"}</dd>
              <dt>{l("وقت القياس", "Observed at")}</dt>
              <dd>{new Date(current.recordedAt).toLocaleString()}</dd>
            </dl>
          ) : (
            <p role="status">
              {l(
                "قياسات الرحلة الحالية غير متاحة",
                "Current flight telemetry unavailable"
              )}
            </p>
          ))}
      </CardContent>
    </Card>
  );
}
export default FlightProgress;
