import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  OperationalReadState,
  useOperationalLabels,
} from "./OperationalReadState";

export function ReaccommodationAdvisory() {
  const l = useOperationalLabels();
  const [flight, setFlight] = useState("");
  const [flightId, setFlightId] = useState(0);
  const query = trpc.passengerPriority.reaccommodationAdvisory.useQuery(
    { flightId },
    { enabled: flightId > 0, retry: false }
  );
  const result = query.error ? undefined : query.data;
  const bookings = [
    ...new Set(
      result?.plan.assignments
        .filter(a => a.flightId !== null)
        .map(a => a.bookingId) ?? []
    ),
  ];
  const candidates = [
    ...new Set(
      result?.plan.assignments.flatMap(a =>
        a.flightId === null ? [] : [a.flightId]
      ) ?? []
    ),
  ];
  return (
    <section className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault();
          const value = Number(flight);
          if (Number.isSafeInteger(value) && value > 0) setFlightId(value);
        }}
      >
        <label>
          {l("الرحلة المتعطلة", "Disrupted flight")}
          <Input
            type="number"
            min="1"
            required
            value={flight}
            onChange={event => setFlight(event.target.value)}
          />
        </label>
        <Button type="submit">{l("حساب التخصيص", "Compute assignment")}</Button>
      </form>
      {flightId > 0 && (
        <OperationalReadState query={query}>
          {result && (
            <>
              <p>
                {l(
                  "خطة استشارية لا تحجز مقاعد. تعظّم عدد المسافرين المخصصين، ثم تقلل التكلفة الموزونة.",
                  "Advisory plan; seats are not reserved. Maximize assigned passengers, then minimize weighted cost."
                )}
              </p>
              <p>
                {l("التكلفة", "Cost")}: {result.plan.objectiveValue} ·{" "}
                {l("غير المخصصين", "Unassigned")}:{" "}
                {result.plan.unassigned.length} ·{" "}
                {l("البدائل المدروسة", "Options considered")}:{" "}
                {result.consideredOptions}
              </p>
              <p>
                {result.window.fromISO} — {result.window.toISO}
              </p>
              {result.optionsTruncated && (
                <p role="status">
                  {l(
                    "البدائل مقتطعة؛ الأمثل ضمن المجموعة المدروسة فقط.",
                    "Options were truncated; optimality applies to the considered set only."
                  )}
                </p>
              )}
              <p>
                {l(
                  "عقوبة تخفيض الدرجة بالدقائق",
                  "Downgrade penalty in minutes"
                )}
                : {result.plan.objective.downgradeMinutes}.{" "}
                {l(
                  "الأولوية نسبية داخل هذا الطلب.",
                  "Priority is relative within this request."
                )}
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {[
                      l("المسافر / الحجز", "Passenger / booking"),
                      l("الرحلة / الدرجة", "Flight / cabin"),
                      l("التأخير", "Delay"),
                      l("التكلفة / السبب", "Cost / reason"),
                    ].map(label => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.plan.assignments.map(a => (
                    <tr key={a.passengerId}>
                      <td>
                        {a.passengerId} / {a.bookingId}
                      </td>
                      <td>
                        {a.flightNumber ?? l("غير مخصص", "Unassigned")} /{" "}
                        {a.cabin ?? "—"}
                      </td>
                      <td>{a.delayMinutes ?? "—"}</td>
                      <td>
                        {a.cost} / {a.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {bookings.length > 0 && (
                <>
                  <p>
                    {l(
                      "راجع خطة الحجز الجماعية قبل التنفيذ؛ قد تختلف عن تخصيص الأفراد الاستشاري.",
                      "Review the booking-level recovery plan before execution; it may differ from this passenger-level advisory."
                    )}
                  </p>
                  <Link
                    href={`/admin/operations?bookingIds=${bookings.join(",")}&candidateIds=${candidates.join(",")}`}
                  >
                    {l("مراجعة خطة الاستعادة", "Review recovery plan")}
                  </Link>
                </>
              )}
            </>
          )}
        </OperationalReadState>
      )}
    </section>
  );
}
