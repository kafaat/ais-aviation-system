import {
  arrivalDelayTariffXdr,
  GACA_PASSENGER_RIGHTS,
} from "@shared/gaca-arrival-delay";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  OperationalReadState,
  useOperationalLabels,
} from "./OperationalReadState";
import {
  claimTypeLabel,
  PassengerRightsEvaluation,
} from "./PassengerRightsEvaluation";
import { CLAIM_TYPE_BY_STORED } from "@shared/passenger-rights/stored";
type Disruption = keyof typeof CLAIM_TYPE_BY_STORED;
type Regulation = "eu261" | "dot" | "local" | "uk261";
const DISRUPTIONS = Object.keys(CLAIM_TYPE_BY_STORED) as Disruption[];
export function CompensationClaim({
  bookingId,
  bookingReference,
  className,
}: {
  bookingId: number;
  bookingReference?: string;
  className?: string;
}) {
  const l = useOperationalLabels();
  const [flightId, setFlight] = useState(0),
    [passengerId, setPassenger] = useState(0);
  const [type, setType] = useState<Disruption>("delay");
  const [regulation, setRegulation] = useState<Regulation | "">("");
  const [arrivalDelay, setArrivalDelay] = useState("");
  const [departureDelay, setDepartureDelay] = useState("");
  const [baggageDays, setBaggageDays] = useState("");
  const [tarmac, setTarmac] = useState("");
  const minutes = arrivalDelay.trim() ? Number(arrivalDelay) : NaN;
  const numberOr = (value: string) =>
    value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0
      ? Number(value)
      : undefined;
  const [reason, setReason] = useState("");
  const targets = trpc.compensation.claimTargets.useQuery({ bookingId });
  const claims = trpc.compensation.getMyClaims.useQuery(undefined, {
    select: data => data.filter(c => c.bookingId === bookingId),
  });
  const selectedFlight =
    flightId ||
    (targets.data?.flights.length === 1 ? targets.data.flights[0].id : 0);
  const selectedPassenger =
    passengerId ||
    (targets.data?.passengers.length === 1 ? targets.data.passengers[0].id : 0);
  const preview = trpc.compensation.previewEntitlements.useQuery(
    {
      bookingId,
      flightId: selectedFlight,
      claimType: type,
      regulationType: regulation || undefined,
      facts: {
        arrivalDelayMinutes: numberOr(arrivalDelay),
        departureDelayMinutes: numberOr(departureDelay),
        baggageDelayDays: numberOr(baggageDays),
        tarmacMinutes: numberOr(tarmac),
      },
    },
    { enabled: selectedFlight > 0 }
  );
  const file = trpc.compensation.fileClaim.useMutation({
    onSuccess: () => {
      void claims.refetch();
      toast.success(l("سُجلت المطالبة للمراجعة", "Claim recorded for review"));
      setReason("");
    },
    onError: e => toast.error(e.message),
  });
  const factField = (
    label: string,
    value: string,
    set: (v: string) => void,
    step = "any"
  ) => (
    <label className="block">
      {label}
      <input
        className="border block p-2"
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={event => set(event.target.value)}
      />
    </label>
  );
  return (
    <section className={className}>
      <h3>
        {l("التعويضات", "Compensation")} {bookingReference}
      </h3>
      <OperationalReadState query={claims}>
        <ul>
          {claims.data?.map(claim => (
            <li className="border p-3 my-2" key={claim.id}>
              #{claim.id} · {claim.status} · {l("الرحلة", "Flight")}{" "}
              {claim.flightId} ·{" "}
              {claimTypeLabel(
                CLAIM_TYPE_BY_STORED[claim.claimType],
                l("ar", "en")
              )}
              <p>
                {l("التقدير", "Estimate")}:{" "}
                {claim.calculatedAmount === null
                  ? l("بانتظار التقييم", "Awaiting assessment")
                  : `${(claim.calculatedAmount / 100).toFixed(2)} ${claim.currency}`}
              </p>
              {claim.approvedAmount !== null && (
                <p>
                  {l(
                    "المعتمد؛ لا يعني الصرف",
                    "Approved; does not indicate payout"
                  )}
                  : {(claim.approvedAmount / 100).toFixed(2)} {claim.currency}
                </p>
              )}
            </li>
          ))}
        </ul>
      </OperationalReadState>
      <OperationalReadState query={targets}>
        <form
          className="space-y-3"
          onSubmit={event => {
            event.preventDefault();
            if (regulation && selectedFlight && selectedPassenger)
              file.mutate({
                bookingId,
                flightId: selectedFlight,
                passengerId: selectedPassenger,
                regulationType: regulation,
                claimType: type,
                reason: reason || undefined,
              });
          }}
        >
          <label className="block">
            {l("المقطع المقصود", "Affected flight")}
            <select
              className="border block p-2 w-full"
              required
              value={selectedFlight || ""}
              onChange={e => setFlight(Number(e.target.value))}
            >
              <option value="">{l("اختر الرحلة", "Choose flight")}</option>
              {targets.data?.flights.map(f => (
                <option key={f.id} value={f.id}>
                  {f.flightNumber}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {l("المسافر", "Passenger")}
            <select
              className="border block p-2 w-full"
              required
              value={selectedPassenger || ""}
              onChange={e => setPassenger(Number(e.target.value))}
            >
              <option value="">{l("اختر المسافر", "Choose passenger")}</option>
              {targets.data?.passengers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {l("نوع المطالبة", "Claim type")}
            <select
              className="border block p-2 w-full"
              value={type}
              onChange={e => setType(e.target.value as Disruption)}
            >
              {DISRUPTIONS.map(value => (
                <option key={value} value={value}>
                  {claimTypeLabel(CLAIM_TYPE_BY_STORED[value], l("ar", "en"))}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {l(
              "أساس المطالبة المطلوب؛ يخضع للمراجعة",
              "Requested policy basis; subject to review"
            )}
            <select
              className="border block p-2 w-full"
              required
              value={regulation}
              onChange={e => setRegulation(e.target.value as Regulation)}
            >
              <option value="">{l("اختر الأساس", "Choose basis")}</option>
              <option value="local">
                {l("السعودية (لائحة GACA 2023)", "Saudi Arabia (GACA 2023)")}
              </option>
              <option value="eu261">EU261</option>
              <option value="uk261">UK261</option>
              <option value="dot">US DOT 14 CFR 260</option>
            </select>
          </label>
          <fieldset className="space-y-2 border p-3">
            <legend>
              {l(
                "وقائع تقريبية للمعاينة فقط (غير موثقة)",
                "Approximate facts for the preview only (unverified)"
              )}
            </legend>
            {(type === "delay" || type === "downgrade") &&
              factField(
                l(
                  "الدقائق بين الوصول المحدد في الحجز والوصول الفعلي",
                  "Minutes between your booked and actual arrival"
                ),
                arrivalDelay,
                setArrivalDelay
              )}
            {type === "care" &&
              factField(
                l("دقائق تأخير المغادرة", "Departure delay in minutes"),
                departureDelay,
                setDepartureDelay
              )}
            {type === "baggage_delay" &&
              factField(
                l("أيام تأخير الأمتعة", "Days the bag was delayed"),
                baggageDays,
                setBaggageDays,
                "1"
              )}
            {type === "tarmac_delay" &&
              factField(
                l("دقائق الانتظار على المدرج", "Minutes held on the tarmac"),
                tarmac,
                setTarmac
              )}
          </fieldset>
          {selectedFlight > 0 && (
            <OperationalReadState query={preview}>
              {preview.data && (
                <div className="border p-3 space-y-2" aria-live="polite">
                  <p className="font-medium">
                    {l(
                      "ما قد تستحقه (غير ملزم)",
                      "What you may be entitled to (non-binding)"
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {l(
                      "معاينة إرشادية فقط. يُقرَّر الاستحقاق والمبلغ بعد مراجعة الأدلة؛ القيم المستندة إلى مصادر ثانوية أو متضاربة تُعرض ولا تُعتمد قبل تأكيدها.",
                      preview.data.disclaimer
                    )}
                  </p>
                  <PassengerRightsEvaluation
                    evaluation={preview.data.evaluation}
                  />
                </div>
              )}
            </OperationalReadState>
          )}
          <label>
            {l("تفاصيل إضافية", "Additional details")}
            <Textarea
              value={reason}
              maxLength={1000}
              onChange={e => setReason(e.target.value)}
            />
          </label>
          <Button
            disabled={
              file.isPending ||
              !selectedFlight ||
              !selectedPassenger ||
              !regulation
            }
          >
            {l("تقديم للمراجعة", "Submit for review")}
          </Button>
        </form>
      </OperationalReadState>
      {regulation === "local" && type === "delay" && (
        <fieldset className="space-y-2 border p-3">
          <legend>
            {l("دليل تأخير الوصول في السعودية", "Saudi arrival delay guide")}
          </legend>
          {Number.isFinite(minutes) && minutes >= 0 && (
            <p aria-live="polite">
              {l(
                "قيمة شريحة التأخير إذا انطبقت المادة ١٠",
                "Delay tariff if article 10 applies"
              )}
              : {arrivalDelayTariffXdr(minutes)}{" "}
              {l("وحدة حقوق سحب خاصة", "SDR")}
            </p>
          )}
          <p>
            {l(
              "يراجع المختص انطباق اللائحة وظروف الرحلة قبل اعتماد التعويض. تُقيَّم حقوق الرعاية وفق تأخير المغادرة.",
              "A reviewer checks the route and circumstances before approving compensation. Care depends on departure delay."
            )}
          </p>
          <a className="underline" href={GACA_PASSENGER_RIGHTS}>
            {l(
              "لائحة حماية حقوق المسافرين، المادة العاشرة",
              "GACA Passenger Rights Protection Regulations, article 10 (Arabic)"
            )}
          </a>
        </fieldset>
      )}
    </section>
  );
}
