import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
type RouterInputs = inferRouterInputs<AppRouter>;
type Profile = NonNullable<
  RouterInputs["travelScenarios"]["getTravelRequirements"]["profile"]
>;
export function TravelRequirements({
  flightId,
  className = "",
}: {
  flightId: number;
  className?: string;
}) {
  const { t, i18n } = useTranslation(),
    ar = i18n.language.startsWith("ar"),
    id = useId();
  const { data: airportOptions } = trpc.reference.airports.useQuery();
  const [profile, setProfile] = useState<Profile>();
  const { data, isLoading } =
    trpc.travelScenarios.getTravelRequirements.useQuery(
      { flightId, profile },
      { enabled: flightId > 0 }
    );
  const label = (a: string, b: string) => (ar ? a : b);
  return (
    <Card className={`p-4 space-y-3 ${className}`}>
      <h4 className="font-semibold">
        {t("travelDocs.title")}
        {data ? ` — ${data.destination.city}` : ""}
      </h4>
      <form
        className="grid grid-cols-2 gap-2 text-xs"
        onSubmit={event => {
          event.preventDefault();
          const d = new FormData(event.currentTarget);
          setProfile({
            nationality: String(d.get("nationality")).toUpperCase(),
            residenceCountry: String(d.get("residence")).toUpperCase() || null,
            documentType: d.get("documentType") as Profile["documentType"],
            purpose: d.get("purpose") as Profile["purpose"],
            stayDays: Number(d.get("stayDays")),
            dateOfBirth: String(d.get("birth")) || null,
            transitAirportIds: d.getAll("transit").map(Number),
          });
        }}
      >
        <label htmlFor={`${id}-nationality`}>
          {label("الجنسية (رمز الدولة)", "Nationality (country code)")}
          <Input
            id={`${id}-nationality`}
            name="nationality"
            required
            pattern="[A-Za-z]{2,3}"
            placeholder="SA"
          />
        </label>
        <label>
          {label("الإقامة (رمز الدولة)", "Residence (country code)")}
          <Input name="residence" pattern="[A-Za-z]{2,3}" placeholder="SA" />
        </label>
        <label>
          {label("نوع الوثيقة", "Document type")}
          <select
            name="documentType"
            className="w-full border rounded p-2 bg-background"
          >
            <option value="passport">{label("جواز سفر", "Passport")}</option>
            <option value="national_id">
              {label("هوية وطنية", "National ID")}
            </option>
          </select>
        </label>
        <label>
          {label("الغرض", "Purpose")}
          <select
            name="purpose"
            className="w-full border rounded p-2 bg-background"
          >
            <option value="tourism">{label("سياحة", "Tourism")}</option>
            <option value="business">{label("عمل", "Business")}</option>
            <option value="transit">{label("عبور", "Transit")}</option>
          </select>
        </label>
        <label>
          {label("مدة الزيارة بالأيام", "Stay in days")}
          <Input type="number" name="stayDays" min={0} max={365} required />
        </label>
        <label>
          {label("تاريخ الميلاد", "Date of birth")}
          <Input type="date" name="birth" />
        </label>
        <label className="col-span-2">
          {label("مطارات العبور (إن وجدت)", "Transit airports (if any)")}
          <select
            multiple
            name="transit"
            className="w-full border rounded p-2 bg-background"
            aria-label={label("مطارات العبور", "Transit airports")}
          >
            {airportOptions?.map(a => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.city}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          size="sm"
          className="col-span-2"
          disabled={isLoading}
        >
          {label("التحقق من المتطلبات", "Check requirements")}
        </Button>
      </form>
      {data && (
        <div className="space-y-2 text-sm">
          {data.status === "unknown" ? (
            <p className="text-amber-700 dark:text-amber-300">
              {label(
                "متطلبات الدخول غير مؤكدة لهذه البيانات.",
                "Entry requirements are unconfirmed for this profile."
              )}
            </p>
          ) : (
            <>
              <p>
                {data.requirements.visaRequired === true
                  ? t("travelDocs.visaRequired")
                  : t("travelDocs.visaFree")}
                {data.requirements.visaOnArrival === true
                  ? ` · ${t("travelDocs.visaOnArrival")}`
                  : ""}
              </p>
              {data.requirements.passportValidUntil && (
                <p>
                  {label(
                    "صلاحية الوثيقة المطلوبة حتى",
                    "Required document validity through"
                  )}
                  : {data.requirements.passportValidUntil}
                </p>
              )}
              {data.reference && (
                <a
                  className="underline text-xs"
                  href={data.reference}
                  target="_blank"
                  rel="noreferrer"
                >
                  {label("مصدر القاعدة", "Rule source")} · {data.version}
                </a>
              )}
              {data.validUntil && (
                <p className="text-xs">
                  {label("النتيجة صالحة حتى", "Result valid until")}:{" "}
                  {data.validUntil.toLocaleString()}
                </p>
              )}
            </>
          )}
          <ul className="list-disc ps-4 text-xs">
            {data.requirements.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
