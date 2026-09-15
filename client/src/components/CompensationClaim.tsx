import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  OperationalReadState,
  useOperationalLabels,
} from "./OperationalReadState";
type Disruption = "delay" | "cancellation" | "denied_boarding" | "downgrade";
type Regulation = "eu261" | "dot" | "local";
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
  const assessment = trpc.compensation.checkEligibility.useQuery(
    { bookingId, flightId: selectedFlight, disruptionType: type },
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
              {claim.flightId}
              <p>
                {l("التقدير", "Estimate")}:{" "}
                {claim.calculatedAmount === null
                  ? l("بانتظار التقييم", "Awaiting assessment")
                  : `${(claim.calculatedAmount / 100).toFixed(2)} SAR`}
              </p>
              {claim.approvedAmount !== null && (
                <p>
                  {l(
                    "المعتمد؛ لا يعني الصرف",
                    "Approved; does not indicate payout"
                  )}
                  : {(claim.approvedAmount / 100).toFixed(2)} SAR
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
              {(
                [
                  "delay",
                  "cancellation",
                  "denied_boarding",
                  "downgrade",
                ] as const
              ).map(value => (
                <option key={value} value={value}>
                  {value}
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
              <option value="eu261">EU261</option>
              <option value="dot">US DOT</option>
              <option value="local">{l("محلي", "Local")}</option>
            </select>
          </label>
          {selectedFlight > 0 && (
            <OperationalReadState query={assessment}>
              <p>
                {l(
                  "تحتاج المطالبة إلى سياسة معتمدة ودليل للمسافة وتحويل العملة قبل تحديد الأهلية أو المبلغ.",
                  "Approved policy, distance and currency evidence are required before entitlement or amount can be determined."
                )}
              </p>
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
    </section>
  );
}
