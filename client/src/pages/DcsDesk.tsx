import { useCallback, useState, useSyncExternalStore } from "react";
import {
  matchMutation,
  matchQuery,
  useIsMutating,
  useQueryClient,
  type MutationFilters,
  type QueryFilters,
} from "@tanstack/react-query";
import { getMutationKey, getQueryKey } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { Redirect } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import {
  OperationalReadState,
  useOperationalLabels,
} from "@/components/OperationalReadState";
import { DcsBaggageRegistration } from "@/components/DcsBaggageRegistration";
import { DcsStationPanel } from "@/components/DcsStationPanel";
import { BaggageCloseout } from "@/components/BaggageCloseout";
import { useCommandIdempotencyKey } from "@/hooks/useCommandIdempotencyKey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Desk = inferRouterOutputs<AppRouter>["dcsOperations"]["getDesk"];
type Passenger = Desk["passengers"][number];
function ReturnBag({
  flightId,
  passenger,
  segmentId,
  disabled,
}: {
  flightId: number;
  passenger: Passenger;
  segmentId: number;
  disabled: boolean;
}) {
  const l = useOperationalLabels();
  const cache = useQueryClient();
  const [tagNumber, setTag] = useState("");
  const [reason, setReason] = useState("");
  const key = useCommandIdempotencyKey();
  const mutation = trpc.dcsOperations.returnBag.useMutation({
    onSuccess: () => {
      key.clear();
      setTag("");
      setReason("");
      void cache.invalidateQueries({
        queryKey: getQueryKey(trpc.dcsOperations.getDesk, { flightId }),
      });
      void cache.invalidateQueries({
        queryKey: getQueryKey(trpc.baggage.registrationSummary, { flightId }),
      });
      void cache.invalidateQueries({
        queryKey: getQueryKey(trpc.baggage.flightCloseout, { flightId }),
      });
    },
    onError: error => {
      if (["FORBIDDEN", "UNAUTHORIZED"].includes(error.data?.code ?? "")) {
        toast.error(error.message);
        void cache.invalidateQueries({
          queryKey: getQueryKey(trpc.dcsOperations.getDesk, { flightId }),
        });
      }
    },
  });
  const locked = disabled || mutation.isPending;
  const eligible =
    !locked && /^\d{10}$/.test(tagNumber) && reason.trim().length >= 5;
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={event => {
        event.preventDefault();
        if (!eligible) return;
        const payload = {
          bookingId: passenger.bookingId,
          passengerId: passenger.passengerId,
          flightId,
          segmentId,
          tagNumber,
          reason: reason.trim(),
        };
        mutation.mutate({
          ...payload,
          idempotencyKey: key.forPayload(payload),
        });
      }}
    >
      <h3 className="font-semibold">
        {l("تسليم حقيبة للراكب", "Return bag to passenger")}
      </h3>
      <p>
        {l(
          "تحقق من هوية الراكب ورقم الوسم، ثم سجّل التسليم بعد أن يستلم الراكب الحقيبة في مكتب المغادرة.",
          "Verify the passenger and physical tag. Record the handover after the passenger receives the bag at the departure desk."
        )}
      </p>
      <label>
        {l("رقم وسم الحقيبة المستردة", "Returned bag tag number")}
        <Input
          disabled={locked}
          value={tagNumber}
          maxLength={10}
          inputMode="numeric"
          onChange={e => setTag(e.target.value)}
        />
      </label>
      <label>
        {l("سبب تسليم الحقيبة", "Bag handover reason")}
        <Input
          disabled={locked}
          value={reason}
          maxLength={500}
          onChange={e => setReason(e.target.value)}
        />
      </label>
      <Button disabled={!eligible}>
        {l("تأكيد تسليم الحقيبة للراكب", "Confirm bag handover")}
      </Button>
      {mutation.data && (
        <p role="status">
          {l("إيصال تسليم الحقيبة", "Bag handover receipt")}{" "}
          {mutation.data.eventId} · {mutation.data.tagNumber}
        </p>
      )}
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
    </form>
  );
}

type PassengerAction =
  | "check_in"
  | "board"
  | "deplane"
  | "deny"
  | "allow"
  | "offload";
const FLIGHTS_PER_PAGE = 50;
type FlightCursor = { departureTime: Date; id: number };
function allowedActions(passenger: Passenger): PassengerAction[] {
  if (passenger.attendanceState === "boarded") return ["deplane"];
  if (passenger.boardingDenied)
    return passenger.checkedIn ? ["allow", "offload"] : ["allow"];
  if (passenger.attendanceState === "checked_in" && passenger.checkedIn)
    return ["board", "deny", "offload"];
  return ["check_in", "deny"];
}

function isRecoveryAction(action: PassengerAction) {
  return action === "deplane" || action === "offload";
}

function flightAllowsPassengerAction(data: Desk, action: PassengerAction) {
  if (data.flight.dcsClosedAt) return false;
  const active = ["scheduled", "delayed"].includes(data.flight.status);
  if (isRecoveryAction(action))
    return active || data.flight.status === "cancelled";
  if (!active) return false;
  const remaining = data.flight.departureTime.getTime() - Date.now();
  if (action === "check_in")
    return (
      data.checkInState === "open" &&
      data.checkInWindowOpen &&
      remaining > 3_600_000 &&
      remaining <= 48 * 3_600_000
    );
  return remaining > 0 && remaining <= 48 * 3_600_000;
}

function useFlightNavigationLock(flightId: number) {
  const cache = useQueryClient();
  const commandKeys = [
    getMutationKey(trpc.dcsOperations.checkIn),
    getMutationKey(trpc.dcsOperations.transition),
    getMutationKey(trpc.dcsOperations.returnBag),
    getMutationKey(trpc.dcsOperations.changeFlightState),
    getMutationKey(trpc.baggage.register),
    getMutationKey(trpc.baggage.correctWeight),
    getMutationKey(trpc.dcsOperations.openCase),
    getMutationKey(trpc.dcsOperations.resolveCase),
    getMutationKey(trpc.dcsOperations.addOsi),
    getMutationKey(trpc.dcsOperations.blockSeats),
    getMutationKey(trpc.dcsOperations.remapSeats),
    getMutationKey(trpc.dcsOperations.dismissCase),
    getMutationKey(trpc.dcsOperations.finalize),
    getMutationKey(trpc.dcsOperations.quoteDowngrade),
    getMutationKey(trpc.dcsOperations.confirmDowngrade),
  ];
  const commands: MutationFilters = {
    predicate: mutation => {
      const input = mutation.state.variables;
      return (
        flightId > 0 &&
        typeof input === "object" &&
        input !== null &&
        "flightId" in input &&
        input.flightId === flightId &&
        commandKeys.some(mutationKey =>
          matchMutation({ mutationKey, exact: true }, mutation)
        )
      );
    },
  };
  const readKeys = [
    getQueryKey(trpc.dcsOperations.getDesk, { flightId }),
    getQueryKey(trpc.dcsOperations.stationReport, { flightId }),
    getQueryKey(trpc.baggage.registrationSummary, { flightId }),
    getQueryKey(trpc.baggage.flightCloseout, { flightId }),
  ];
  const reads: QueryFilters = {
    predicate: query =>
      flightId > 0 &&
      readKeys.some(queryKey => matchQuery({ queryKey }, query)),
  };
  const pendingCommands = useIsMutating(commands);
  const hasPendingReads = () =>
    cache
      .getQueryCache()
      .findAll(reads)
      .some(query => query.state.fetchStatus !== "idle");
  // A refresh paused offline still owns the current command context.
  const pendingReads = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => cache.getQueryCache().subscribe(onChange),
      [cache]
    ),
    hasPendingReads,
    () => false
  );
  return {
    locked: pendingCommands > 0 || pendingReads,
    // Read the cache again in event handlers, including before the next render.
    isLocked: () => cache.isMutating(commands) > 0 || hasPendingReads(),
  };
}

function useDcsLabels() {
  const l = useOperationalLabels();
  return {
    state: (value: Passenger["departureState"]) =>
      ({
        not_checked_in: l("لم يُسجّل", "Not checked in"),
        checked_in: l("مسجّل", "Checked in"),
        boarding_denied: l("ممنوع من الصعود", "Boarding denied"),
        boarded: l("صعد إلى الطائرة", "Boarded"),
        offloaded: l("أُلغي سفره على الرحلة", "Offloaded"),
      })[value],
    action: (value: PassengerAction) =>
      ({
        check_in: l("تسجيل الراكب", "Check in passenger"),
        board: l("تسجيل الصعود", "Board passenger"),
        deplane: l("تسجيل النزول", "Deplane passenger"),
        deny: l("منع الصعود", "Deny boarding"),
        allow: l("رفع منع الصعود", "Allow boarding"),
        offload: l("إلغاء سفر الراكب على الرحلة", "Offload passenger"),
      })[value],
  };
}

export default function DcsDesk() {
  const { user, loading } = useAuth();
  const l = useOperationalLabels();
  if (loading) return <p role="status">{l("جارٍ التحميل", "Loading")}</p>;
  if (
    !user ||
    !["admin", "super_admin", "airline_admin", "ops"].includes(user.role)
  )
    return <Redirect to="/" />;
  return (
    <DashboardLayout>
      <main className="space-y-6 p-4 md:p-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">
            {l("مكتب المغادرة", "Departure desk")}
          </h1>
          <p className="text-muted-foreground">
            {l(
              "إدارة تسجيل الركاب والصعود والأمتعة لكل رحلة مع توثيق الموظف وسبب تغيير الحالة.",
              "Manage passenger check-in, boarding and baggage for each flight, with an actor and reason recorded for state changes."
            )}
          </p>
        </header>
        <FlightSelector />
      </main>
    </DashboardLayout>
  );
}

function FlightSelector() {
  const l = useOperationalLabels();
  const [cursors, setCursors] = useState<FlightCursor[]>([]);
  const [flightId, setFlightId] = useState(0);
  const activity = useFlightNavigationLock(flightId);
  const query = trpc.operations.airlineFlights.useQuery({
    after: cursors.at(-1),
    limit: FLIGHTS_PER_PAGE + 1,
  });
  const flights = query.data?.slice(0, FLIGHTS_PER_PAGE);
  const navigationLocked = query.isFetching || activity.locked;
  function changePage(next: FlightCursor[]) {
    if (query.isFetching || activity.isLocked()) return;
    setFlightId(0);
    setCursors(next);
  }
  return (
    <>
      <section
        className="space-y-3 rounded-lg border p-4"
        aria-label={l("اختيار الرحلة", "Flight selection")}
      >
        <OperationalReadState query={query}>
          <div className="space-y-1">
            <label htmlFor="dcs-flight">{l("الرحلة", "Flight")}</label>
            <select
              id="dcs-flight"
              className="w-full rounded-md border bg-background p-2"
              value={flightId || ""}
              disabled={navigationLocked}
              onChange={e => {
                if (!query.isFetching && !activity.isLocked())
                  setFlightId(Number(e.target.value));
              }}
            >
              <option value="">{l("اختر رحلة", "Select flight")}</option>
              {flights?.map(flight => (
                <option key={flight.id} value={flight.id}>
                  {flight.flightNumber} ·{" "}
                  {flight.departureTime.toLocaleString()} ({flight.id})
                </option>
              ))}
            </select>
          </div>
          {flights?.length === 0 && <p>{l("لا توجد رحلات", "No flights")}</p>}
        </OperationalReadState>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!cursors.length || navigationLocked}
            onClick={() => changePage(cursors.slice(0, -1))}
          >
            {l("الرحلات السابقة", "Previous flights")}
          </Button>
          <Button
            variant="outline"
            disabled={
              !query.data ||
              query.data.length <= FLIGHTS_PER_PAGE ||
              !!query.error ||
              navigationLocked
            }
            onClick={() => {
              const last = flights?.at(-1);
              if (last)
                changePage([
                  ...cursors,
                  { id: last.id, departureTime: last.departureTime },
                ]);
            }}
          >
            {l("الرحلات التالية", "Next flights")}
          </Button>
        </div>
        {activity.locked && (
          <p role="status" className="text-sm text-muted-foreground">
            {l(
              "انتظر اكتمال الإجراء وتحديث بيانات الرحلة قبل تغيير الرحلة أو الراكب.",
              "Wait for the command and flight data refresh to finish before changing the flight or passenger."
            )}
          </p>
        )}
      </section>
      {flightId > 0 && (
        <>
          <FlightDesk
            key={flightId}
            flightId={flightId}
            navigationLocked={activity.locked}
            isNavigationLocked={activity.isLocked}
          />
          <section
            className="space-y-2 rounded-lg border p-4"
            aria-label={l(
              "مطابقة أمتعة الرحلة",
              "Flight baggage reconciliation"
            )}
          >
            <h2 className="text-lg font-semibold">
              {l(
                "مطابقة الأمتعة قبل الإقفال",
                "Baggage reconciliation before closeout"
              )}
            </h2>
            <BaggageCloseout key={flightId} flightId={flightId} />
          </section>
        </>
      )}
    </>
  );
}

function FlightDesk({
  flightId,
  navigationLocked,
  isNavigationLocked,
}: {
  flightId: number;
  navigationLocked: boolean;
  isNavigationLocked: () => boolean;
}) {
  const l = useOperationalLabels();
  const labels = useDcsLabels();
  const [search, setSearch] = useState("");
  const [passengerId, setPassengerId] = useState(0);
  const query = trpc.dcsOperations.getDesk.useQuery(
    { flightId },
    { retry: false }
  );
  const utils = trpc.useUtils();
  const refreshDesk = () =>
    Promise.all([
      query.refetch(),
      utils.dcsOperations.stationReport.invalidate({ flightId }),
    ]);
  const data = query.data;
  const selected = data?.passengers.find(p => p.passengerId === passengerId);
  const needle = search.trim().toLocaleLowerCase();
  const visible = data?.passengers.filter(p =>
    `${p.name} ${p.pnr} ${p.bookingReference} ${p.seatNumber ?? ""}`
      .toLocaleLowerCase()
      .includes(needle)
  );
  const flightActive =
    data?.flight.status === "scheduled" || data?.flight.status === "delayed";
  const canReopenCancelledFlight =
    data?.flight.status === "cancelled" &&
    !!data.flight.dcsClosedAt &&
    !data.flight.stationOffBlocksAt;
  const readReady =
    !!data &&
    !query.error &&
    !query.isFetching &&
    query.fetchStatus !== "paused";
  return (
    <OperationalReadState query={query}>
      {data && (
        <>
          <section className="space-y-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  {data.flight.flightNumber}
                </h2>
                <p>
                  {l("المغادرة بتوقيت جهازك", "Departure in your local time")}:{" "}
                  {data.flight.departureTime.toLocaleString()}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={() => void refreshDesk()}
              >
                {l("تحديث المكتب", "Refresh desk")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={data.checkInState === "open" ? "default" : "secondary"}
              >
                {data.checkInState === "open"
                  ? l("التسجيل مفتوح", "Check-in open")
                  : l("التسجيل مغلق", "Check-in closed")}
              </Badge>
              {!data.checkInWindowOpen && (
                <Badge variant="outline">
                  {l("خارج نافذة التسجيل", "Outside check-in window")}
                </Badge>
              )}
              {!flightActive && (
                <Badge variant="destructive">{data.flight.status}</Badge>
              )}
              <Badge variant="outline">
                {l("الركاب", "Passengers")}: {data.passengers.length}
              </Badge>
              <Badge variant="outline">
                {l("على الطائرة", "On board")}:{" "}
                {
                  data.passengers.filter(p => p.departureState === "boarded")
                    .length
                }
              </Badge>
            </div>
            {!data.stateConfigured && (
              <p className="text-sm text-muted-foreground">
                {l(
                  "لم تُحفظ حالة تشغيلية للتسجيل بعد؛ تسري نافذة التسجيل الحالية إلى أن يحدد الموظف الحالة.",
                  "No operational check-in state has been recorded yet; the existing check-in window applies until staff set the state."
                )}
              </p>
            )}
            <FlightStateControl
              data={data}
              disabled={
                !readReady || !flightActive || !!data.flight.dcsClosedAt
              }
              refresh={refreshDesk}
            />
          </section>

          <section
            className="space-y-3 rounded-lg border p-4"
            aria-label={l("قائمة الركاب", "Passenger list")}
          >
            <label className="block space-y-1">
              <span>
                {l(
                  "بحث بالاسم أو الحجز أو المقعد",
                  "Search name, booking or seat"
                )}
              </span>
              <Input value={search} onChange={e => setSearch(e.target.value)} />
            </label>
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 text-start">
                      {l("الراكب", "Passenger")}
                    </th>
                    <th className="p-2 text-start">{l("الحجز", "Booking")}</th>
                    <th className="p-2 text-start">{l("المقعد", "Seat")}</th>
                    <th className="p-2 text-start">{l("الحالة", "State")}</th>
                    <th className="p-2">
                      <span className="sr-only">{l("الإجراء", "Action")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible?.map(passenger => (
                    <tr
                      key={passenger.passengerId}
                      className={
                        passengerId === passenger.passengerId
                          ? "border-b bg-muted"
                          : "border-b"
                      }
                    >
                      <td className="p-2 font-medium">{passenger.name}</td>
                      <td className="p-2">
                        <span dir="ltr">{passenger.pnr}</span>
                        <br />
                        <span className="text-muted-foreground">
                          {passenger.bookingReference}
                        </span>
                      </td>
                      <td className="p-2">{passenger.seatNumber ?? "—"}</td>
                      <td className="p-2">
                        {labels.state(passenger.departureState)}
                      </td>
                      <td className="p-2">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={l(
                            `اختيار ${passenger.name}`,
                            `Select ${passenger.name}`
                          )}
                          aria-pressed={passengerId === passenger.passengerId}
                          disabled={navigationLocked || !readReady}
                          onClick={() => {
                            if (readReady && !isNavigationLocked())
                              setPassengerId(passenger.passengerId);
                          }}
                        >
                          {l("اختيار", "Select")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!visible?.length && (
              <p>{l("لا يوجد ركاب مطابقون", "No matching passengers")}</p>
            )}
          </section>

          <DcsStationPanel
            flightId={flightId}
            passengers={data.passengers}
            disabled={
              !readReady || (!flightActive && !canReopenCancelledFlight)
            }
            reportReady={readReady && !navigationLocked}
            reopenOnly={canReopenCancelledFlight}
          />
          {selected && (
            <section
              className="grid gap-4 xl:grid-cols-2"
              aria-label={l(
                "إجراءات الراكب المحدد",
                "Selected passenger operations"
              )}
            >
              {data.canReturnBags &&
                selected.segmentId != null &&
                selected.checkedIn &&
                selected.attendanceState !== "boarded" &&
                flightAllowsPassengerAction(data, "offload") && (
                  <ReturnBag
                    key={`return:${flightId}:${selected.passengerId}`}
                    flightId={flightId}
                    passenger={selected}
                    segmentId={selected.segmentId}
                    disabled={!readReady}
                  />
                )}
              <PassengerControl
                key={`${selected.passengerId}:${selected.attendanceState}:${selected.boardingDenied}`}
                passenger={selected}
                data={data}
                disabled={!readReady}
                refresh={refreshDesk}
              />
              {selected.segmentId === null ? (
                <div className="rounded-lg border p-4">
                  <h3 className="font-semibold">{l("الأمتعة", "Baggage")}</h3>
                  <p>
                    {l(
                      "يتطلب قبول الأمتعة ربط الحجز بقطاع رحلة محدد. راجع بيانات القطاع قبل التسجيل.",
                      "Baggage acceptance requires an exact booking segment. Review the segment mapping before registering a bag."
                    )}
                  </p>
                </div>
              ) : (
                <DcsBaggageRegistration
                  key={`registration:${flightId}:${selected.passengerId}`}
                  flightId={flightId}
                  bookingId={selected.bookingId}
                  passengerId={selected.passengerId}
                  segmentId={selected.segmentId}
                  disabled={
                    !readReady ||
                    !flightActive ||
                    !!data.flight.dcsClosedAt ||
                    selected.departureState !== "checked_in" ||
                    data.checkInState !== "open" ||
                    !data.checkInWindowOpen
                  }
                />
              )}
            </section>
          )}

          <section
            className="space-y-3 rounded-lg border p-4"
            aria-label={l("سجل المكتب", "Desk history")}
          >
            <h2 className="text-lg font-semibold">
              {l("آخر تغييرات الحالة", "Recent state changes")}
            </h2>
            {data.historyHasMore && (
              <p className="text-sm text-muted-foreground">
                {l(
                  "تُعرض أحدث 200 عملية؛ تبقى العمليات السابقة محفوظة في سجل التدقيق.",
                  "Showing the latest 200 operations; earlier operations remain in the audit history."
                )}
              </p>
            )}
            {!data.history.length ? (
              <p>{l("لا توجد تغييرات مسجلة", "No recorded changes")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="p-2 text-start">{l("الوقت", "Time")}</th>
                      <th className="p-2 text-start">
                        {l("التغيير", "Change")}
                      </th>
                      <th className="p-2 text-start">{l("الموظف", "Actor")}</th>
                      <th className="p-2 text-start">{l("السبب", "Reason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map(event => (
                      <tr key={event.id} className="border-t">
                        <td className="p-2">
                          {event.createdAt.toLocaleString()}
                        </td>
                        <td className="p-2">
                          <span dir="ltr">
                            {event.fromState ?? "—"} → {event.toState}
                          </span>
                          {event.passengerId !== null && (
                            <div>
                              {l("الراكب", "Passenger")} #{event.passengerId}
                            </div>
                          )}
                        </td>
                        <td className="p-2">
                          {event.actorRole} #{event.actorId ?? "—"}
                        </td>
                        <td className="p-2">{event.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </OperationalReadState>
  );
}

function FlightStateControl({
  data,
  disabled,
  refresh,
}: {
  data: Desk;
  disabled: boolean;
  refresh: () => unknown;
}) {
  const l = useOperationalLabels();
  const [reason, setReason] = useState("");
  const [receipt, setReceipt] = useState<number | null>(null);
  const key = useCommandIdempotencyKey();
  const mutation = trpc.dcsOperations.changeFlightState.useMutation({
    onSuccess: result => {
      key.clear();
      setReason("");
      setReceipt(result.eventId);
      toast.success(l("حُفظت حالة التسجيل", "Check-in state recorded"));
      void refresh();
    },
    onError: error => toast.error(error.message),
  });
  function apply(action: "open" | "close" | "reopen") {
    if (disabled || mutation.isPending || reason.trim().length < 5) return;
    const payload = { flightId: data.flight.id, action, reason: reason.trim() };
    mutation.mutate({ ...payload, idempotencyKey: key.forPayload(payload) });
  }
  return (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span>{l("سبب تغيير حالة التسجيل", "Check-in state reason")}</span>
        <Input
          value={reason}
          maxLength={500}
          onChange={e => setReason(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {!data.stateConfigured && (
          <Button
            disabled={
              disabled || mutation.isPending || reason.trim().length < 5
            }
            onClick={() => apply("open")}
          >
            {l("فتح التسجيل", "Open check-in")}
          </Button>
        )}
        {data.checkInState === "open" ? (
          <Button
            variant="outline"
            disabled={
              disabled || mutation.isPending || reason.trim().length < 5
            }
            onClick={() => apply("close")}
          >
            {l("إغلاق التسجيل", "Close check-in")}
          </Button>
        ) : (
          <Button
            disabled={
              disabled || mutation.isPending || reason.trim().length < 5
            }
            onClick={() => apply("reopen")}
          >
            {l("إعادة فتح التسجيل", "Reopen check-in")}
          </Button>
        )}
      </div>
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
      {receipt !== null && (
        <p role="status">
          {l("مرجع تغيير الحالة", "State change reference")}: {receipt}
        </p>
      )}
    </div>
  );
}

function PassengerControl({
  passenger,
  data,
  disabled,
  refresh,
}: {
  passenger: Passenger;
  data: Desk;
  disabled: boolean;
  refresh: () => unknown;
}) {
  const l = useOperationalLabels();
  const labels = useDcsLabels();
  const actions = allowedActions(passenger);
  const [action, setAction] = useState<PassengerAction>(() => {
    const initial = actions[0];
    if (flightAllowsPassengerAction(data, initial)) return initial;
    return (
      actions.find(
        value =>
          isRecoveryAction(value) && flightAllowsPassengerAction(data, value)
      ) ?? initial
    );
  });
  const [reason, setReason] = useState("");
  const [seatNumber, setSeatNumber] = useState("");
  const [boardingPassToken, setBoardingPassToken] = useState("");
  const key = useCommandIdempotencyKey();
  function succeeded() {
    key.clear();
    setReason("");
    setBoardingPassToken("");
    toast.success(l("حُفظت حالة الراكب", "Passenger state recorded"));
    void refresh();
  }
  const checkIn = trpc.dcsOperations.checkIn.useMutation({
    onSuccess: succeeded,
    onError: error => toast.error(error.message),
  });
  const transition = trpc.dcsOperations.transition.useMutation({
    onSuccess: succeeded,
    onError: error => toast.error(error.message),
  });
  const pending = checkIn.isPending || transition.isPending;
  const checkInClosed =
    action === "check_in" &&
    (data.checkInState !== "open" || !data.checkInWindowOpen);
  const flightAllowsAction = flightAllowsPassengerAction(data, action);
  const controlsDisabled =
    disabled ||
    pending ||
    !actions.some(value => flightAllowsPassengerAction(data, value));
  const unavailable =
    disabled ||
    pending ||
    !flightAllowsAction ||
    !actions.includes(action) ||
    reason.trim().length < 5;
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={event => {
        event.preventDefault();
        // The clock can pass the cutoff while a populated form stays open.
        if (unavailable || !flightAllowsPassengerAction(data, action)) return;
        const context = {
          flightId: data.flight.id,
          bookingId: passenger.bookingId,
          passengerId: passenger.passengerId,
          reason: reason.trim(),
        };
        if (action === "check_in") {
          const payload = {
            ...context,
            seatNumber: seatNumber.trim().toUpperCase() || undefined,
          };
          checkIn.mutate({
            ...payload,
            idempotencyKey: key.forPayload({ action, ...payload }),
          });
        } else {
          const payload = {
            ...context,
            action,
            boardingPassToken:
              action === "board"
                ? boardingPassToken.trim() || undefined
                : undefined,
          };
          transition.mutate({
            ...payload,
            idempotencyKey: key.forPayload(payload),
          });
        }
      }}
    >
      <h3 className="text-lg font-semibold">{passenger.name}</h3>
      <p>
        {labels.state(passenger.departureState)}
        {passenger.boardingDenied &&
          ` · ${labels.state(passenger.attendanceState)}`}{" "}
        · {l("المقعد", "Seat")}: {passenger.seatNumber ?? "—"}
      </p>
      <div className="space-y-1">
        <label htmlFor="dcs-passenger-action">
          {l("إجراء الراكب", "Passenger action")}
        </label>
        <select
          id="dcs-passenger-action"
          className="w-full rounded-md border bg-background p-2"
          value={action}
          disabled={controlsDisabled}
          onChange={event => setAction(event.target.value as PassengerAction)}
        >
          {actions.map(value => (
            <option
              key={value}
              value={value}
              disabled={!flightAllowsPassengerAction(data, value)}
            >
              {labels.action(value)}
            </option>
          ))}
        </select>
      </div>
      {action === "check_in" && (
        <label className="block space-y-1">
          <span>
            {l("المقعد المطلوب (اختياري)", "Requested seat (optional)")}
          </span>
          <Input
            value={seatNumber}
            disabled={controlsDisabled}
            maxLength={5}
            onChange={e => setSeatNumber(e.target.value)}
            placeholder={l(
              "تخصيص تلقائي عند تركه فارغًا",
              "Leave blank for automatic allocation"
            )}
          />
        </label>
      )}
      {action === "board" && (
        <div className="space-y-1">
          <label htmlFor="dcs-boarding-token">
            {l("رمز بطاقة الصعود (اختياري)", "Boarding pass token (optional)")}
          </label>
          <Input
            id="dcs-boarding-token"
            aria-describedby="dcs-boarding-token-help"
            value={boardingPassToken}
            disabled={controlsDisabled}
            maxLength={8192}
            autoComplete="off"
            onChange={e => setBoardingPassToken(e.target.value)}
          />
          <p
            id="dcs-boarding-token-help"
            className="text-sm text-muted-foreground"
          >
            {l(
              "إذا أُدخل الرمز، يُتحقق من صلاحيته ومطابقته للراكب والرحلة قبل تسجيل الصعود.",
              "When supplied, the token must be current and match this passenger and flight before boarding."
            )}
          </p>
        </div>
      )}
      {action === "offload" && (
        <p className="text-sm">
          {l(
            "يُرفض الإجراء إذا بقي الراكب على الطائرة أو كانت أمتعته في عهدة تشغيلية لم تُسوَّ بعد.",
            "Offload is refused while the passenger is on board or baggage custody remains unresolved."
          )}
        </p>
      )}
      <label className="block space-y-1">
        <span>{l("سبب إجراء الراكب", "Passenger action reason")}</span>
        <Input
          required
          minLength={5}
          maxLength={500}
          value={reason}
          disabled={controlsDisabled}
          onChange={e => setReason(e.target.value)}
        />
      </label>
      {checkInClosed && (
        <p role="status">
          {l(
            "التسجيل مغلق أو خارج نافذته الزمنية",
            "Check-in is closed or outside its time window"
          )}
        </p>
      )}
      {data.flight.status === "completed" ? (
        <p role="status">
          {l(
            "الرحلة مكتملة؛ لا يمكن تغيير حالة الراكب.",
            "This flight is completed; passenger state changes are unavailable."
          )}
        </p>
      ) : data.flight.status === "cancelled" ? (
        <p role="status">
          {l(
            "الرحلة ملغاة؛ يُتاح تسجيل النزول وإلغاء السفر فقط عندما تسمح حالة الراكب المسجلة.",
            "This flight is cancelled; only deplane and offload are available when the recorded passenger state permits."
          )}
        </p>
      ) : !flightAllowsAction && !checkInClosed ? (
        <p role="status">
          {l(
            "هذا الإجراء غير متاح في حالة الرحلة أو نافذتها الزمنية الحالية.",
            "This action is unavailable for the flight's current status or time window."
          )}
        </p>
      ) : null}
      <Button type="submit" disabled={unavailable}>
        {labels.action(action)}
      </Button>
      {(checkIn.error || transition.error) && (
        <p role="alert">
          {checkIn.error?.message ?? transition.error?.message}
        </p>
      )}
    </form>
  );
}
