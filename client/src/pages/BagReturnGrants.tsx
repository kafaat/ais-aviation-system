import { useRef, useState, type FormEvent } from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
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
import { useCommandIdempotencyKey } from "@/hooks/useCommandIdempotencyKey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type GrantList =
  inferRouterOutputs<AppRouter>["dcsOperations"]["bagReturnGrants"];
type Grant = GrantList["grants"][number];
type Scope = GrantList["scope"];
type FlightCursor = { departureTime: Date; id: number };
const PAGE_SIZE = 25;

export default function BagReturnGrants() {
  const { user, loading } = useAuth();
  const l = useOperationalLabels();
  if (loading) return <p role="status">{l("جارٍ التحميل", "Loading")}</p>;
  if (!user || !["admin", "super_admin", "airline_admin"].includes(user.role))
    return <Redirect to="/" />;
  return (
    <DashboardLayout>
      <main className="space-y-6 p-4 md:p-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">
            {l("صلاحيات تسليم الأمتعة", "Bag return grants")}
          </h1>
          <p className="text-muted-foreground">
            {l(
              "حدّد الرحلة لتعيين الناقل ومحطة المغادرة، ثم امنح الموظف صلاحية تسليم الأمتعة أو ألغها مع تسجيل السبب.",
              "Choose a flight to identify the operating carrier and departure station, then grant or revoke staff bag handover access with a recorded reason."
            )}
          </p>
        </header>
        <GrantFlightSelector
          key={`${user.id}:${user.role}:${user.tenantId ?? "global"}`}
        />
      </main>
    </DashboardLayout>
  );
}

function GrantFlightSelector() {
  const l = useOperationalLabels();
  const [cursors, setCursors] = useState<FlightCursor[]>([]);
  const [flightId, setFlightId] = useState(0);
  const pending =
    useIsMutating({
      mutationKey: getMutationKey(trpc.dcsOperations.setBagReturnGrant),
    }) > 0;
  const flights = trpc.operations.airlineFlights.useQuery({
    after: cursors.at(-1),
    limit: PAGE_SIZE + 1,
  });
  const rows = flights.data?.slice(0, PAGE_SIZE);
  const locked = pending || flights.isFetching;
  function page(next: FlightCursor[]) {
    if (locked) return;
    setFlightId(0);
    setCursors(next);
  }
  return (
    <>
      <section
        className="space-y-3 rounded-lg border p-4"
        aria-label={l("اختيار الرحلة", "Flight selection")}
      >
        <OperationalReadState query={flights}>
          <label className="block space-y-1">
            <span>{l("الرحلة المرجعية", "Reference flight")}</span>
            <select
              className="w-full rounded-md border bg-background p-2"
              value={flightId || ""}
              disabled={locked}
              onChange={event => {
                if (!locked) setFlightId(Number(event.target.value));
              }}
            >
              <option value="">{l("اختر رحلة", "Select flight")}</option>
              {rows?.map(flight => (
                <option key={flight.id} value={flight.id}>
                  {flight.flightNumber} ·{" "}
                  {flight.departureTime.toLocaleString()} ({flight.id})
                </option>
              ))}
            </select>
          </label>
          {rows?.length === 0 && <p>{l("لا توجد رحلات", "No flights")}</p>}
        </OperationalReadState>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={locked || !cursors.length}
            onClick={() => page(cursors.slice(0, -1))}
          >
            {l("الرحلات السابقة", "Previous flights")}
          </Button>
          <Button
            variant="outline"
            disabled={
              locked ||
              !!flights.error ||
              (flights.data?.length ?? 0) <= PAGE_SIZE
            }
            onClick={() => {
              const last = rows?.at(-1);
              if (last)
                page([
                  ...cursors,
                  { id: last.id, departureTime: last.departureTime },
                ]);
            }}
          >
            {l("الرحلات التالية", "Next flights")}
          </Button>
        </div>
      </section>
      {flightId > 0 && !flights.error && (
        <StationGrants key={flightId} flightId={flightId} />
      )}
    </>
  );
}

function StationGrants({ flightId }: { flightId: number }) {
  const l = useOperationalLabels();
  const [cursors, setCursors] = useState<number[]>([]);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const [receipt, setReceipt] = useState<number | null>(null);
  const pending =
    useIsMutating({
      mutationKey: getMutationKey(trpc.dcsOperations.setBagReturnGrant),
    }) > 0;
  const query = trpc.dcsOperations.bagReturnGrants.useQuery(
    { flightId, after: cursors.at(-1), limit: PAGE_SIZE },
    { refetchInterval: 30_000, refetchOnWindowFocus: true }
  );
  const locked = pending || query.isFetching;
  const complete = (eventId: number) => {
    setReceipt(eventId);
    setRevoking(null);
  };
  return (
    <section
      className="space-y-4"
      aria-label={l("صلاحيات المحطة", "Station grants")}
    >
      {receipt !== null && (
        <p role="status">
          {l("تم تسجيل الأمر. إيصال", "Command recorded. Receipt")} {receipt}.{" "}
          {l(
            "يعرض الجدول الحالة الحالية بعد التحديث.",
            "The table shows the current state after refresh."
          )}
        </p>
      )}
      <OperationalReadState query={query}>
        {query.data && (
          <>
            <div className="space-y-2 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">
                {query.data.scope.flightNumber}
              </h2>
              <p>
                {l("الناقل", "Carrier")} {query.data.scope.airlineId} ·{" "}
                {l("محطة المغادرة", "Departure station")}{" "}
                {query.data.scope.airportId} · {l("المستأجر", "Tenant")}{" "}
                {query.data.scope.tenantId}
              </p>
              <p>
                {l(
                  "تسري الصلاحية حتى إلغائها على رحلات هذا الناقل من هذه المحطة، وليست مقصورة على الرحلة المرجعية.",
                  "Access lasts until revoked and applies to this carrier at this departure station, across flights."
                )}
              </p>
            </div>
            <GrantCommand
              scope={query.data.scope}
              enabled
              disabled={locked}
              onComplete={complete}
            />
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">
                  {l("الصلاحيات المسجلة", "Recorded grants")}
                </h2>
                <Button
                  variant="outline"
                  disabled={locked}
                  onClick={() => {
                    void query.refetch();
                  }}
                >
                  {l("تحديث الصلاحيات", "Refresh grants")}
                </Button>
              </div>
              {query.data.grants.length === 0 ? (
                <p>
                  {l(
                    "لا توجد صلاحيات في هذه الصفحة.",
                    "No grants on this page."
                  )}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-start">
                    <thead>
                      <tr>
                        <th className="p-2 text-start">
                          {l("الموظف", "Staff")}
                        </th>
                        <th className="p-2 text-start">{l("الدور", "Role")}</th>
                        <th className="p-2 text-start">
                          {l("الحالة", "Status")}
                        </th>
                        <th className="p-2 text-start">
                          {l("الإجراء", "Action")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.grants.map(grant => (
                        <tr key={grant.id}>
                          <td className="p-2">
                            {grant.staffName ??
                              l("موظف غير متاح", "Staff unavailable")}{" "}
                            ({grant.staffId})
                          </td>
                          <td className="p-2">{grant.staffRole ?? "—"}</td>
                          <td className="p-2">
                            <Badge
                              variant={grant.enabled ? "default" : "secondary"}
                            >
                              {grant.enabled
                                ? l("مفعلة", "Enabled")
                                : l("ملغاة", "Revoked")}
                            </Badge>
                            {!grant.eligible && (
                              <p className="text-sm">
                                {l(
                                  "الموظف غير مؤهل حاليًا؛ يمكن إلغاء السجل.",
                                  "Staff is no longer eligible; the grant can be revoked."
                                )}
                              </p>
                            )}
                          </td>
                          <td className="p-2">
                            {grant.enabled && (
                              <Button
                                variant="destructive"
                                disabled={locked}
                                aria-label={l(
                                  `إلغاء صلاحية الموظف ${grant.staffId}`,
                                  `Revoke access for staff ${grant.staffId}`
                                )}
                                onClick={() => setRevoking(grant)}
                              >
                                {l("إلغاء الصلاحية", "Revoke")}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={locked || !cursors.length}
                  onClick={() => setCursors(cursors.slice(0, -1))}
                >
                  {l("الصلاحيات السابقة", "Previous grants")}
                </Button>
                <Button
                  variant="outline"
                  disabled={locked || query.data.nextCursor === null}
                  onClick={() => {
                    if (query.data?.nextCursor)
                      setCursors([...cursors, query.data.nextCursor]);
                  }}
                >
                  {l("الصلاحيات التالية", "Next grants")}
                </Button>
              </div>
            </div>
            <Dialog
              open={revoking !== null}
              onOpenChange={open => {
                if (!open && !pending) setRevoking(null);
              }}
            >
              <DialogContent
                onEscapeKeyDown={event => {
                  if (pending) event.preventDefault();
                }}
                onInteractOutside={event => {
                  if (pending) event.preventDefault();
                }}
              >
                <DialogHeader>
                  <DialogTitle>
                    {l(
                      "إلغاء صلاحية تسليم الأمتعة",
                      "Revoke bag return access"
                    )}
                  </DialogTitle>
                  <DialogDescription>
                    {l(
                      "يلزم تفويض جديد قبل تسليم أي حقيبة لاحقًا. يظل الخادم مسؤولًا عن رفض التسليم من شاشة مفتوحة بعد الإلغاء.",
                      "A new grant will be required for later bag handovers. Revocation is enforced even when a departure desk was already open."
                    )}
                  </DialogDescription>
                </DialogHeader>
                {revoking && (
                  <GrantCommand
                    key={revoking.id}
                    scope={query.data.scope}
                    enabled={false}
                    staff={revoking}
                    disabled={locked}
                    onComplete={complete}
                  />
                )}
              </DialogContent>
            </Dialog>
          </>
        )}
      </OperationalReadState>
    </section>
  );
}

function GrantCommand({
  scope,
  enabled,
  staff,
  disabled,
  onComplete,
}: {
  scope: Scope;
  enabled: boolean;
  staff?: Grant;
  disabled: boolean;
  onComplete: (eventId: number) => void;
}) {
  const l = useOperationalLabels();
  const cache = useQueryClient();
  const key = useCommandIdempotencyKey();
  const sending = useRef(false);
  const [staffId, setStaffId] = useState(staff ? String(staff.staffId) : "");
  const [reason, setReason] = useState("");
  const mutation = trpc.dcsOperations.setBagReturnGrant.useMutation({
    onSuccess: async result => {
      // A replay returns its original receipt. Refetch current grants so that
      // an old enable receipt never makes a later revocation look enabled.
      await Promise.all([
        cache.invalidateQueries({
          queryKey: getQueryKey(trpc.dcsOperations.bagReturnGrants, {
            flightId: scope.flightId,
          }),
        }),
        cache.invalidateQueries({
          queryKey: getQueryKey(trpc.dcsOperations.getDesk),
        }),
      ]);
      key.clear();
      setReason("");
      if (!staff) setStaffId("");
      onComplete(result.eventId);
    },
    onError: error => {
      if (["UNAUTHORIZED", "FORBIDDEN"].includes(error.data?.code ?? ""))
        void cache.invalidateQueries({
          queryKey: getQueryKey(trpc.dcsOperations.bagReturnGrants, {
            flightId: scope.flightId,
          }),
        });
    },
    onSettled: () => {
      sending.current = false;
    },
  });
  const id = Number(staffId);
  const valid =
    Number.isSafeInteger(id) &&
    id > 0 &&
    reason.trim().length >= 5 &&
    reason.trim().length <= 500;
  const locked = disabled || mutation.isPending;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || locked || sending.current) return;
    sending.current = true;
    const payload = {
      flightId: scope.flightId,
      airlineId: scope.airlineId,
      airportId: scope.airportId,
      staffId: id,
      enabled,
      reason: reason.trim(),
    };
    mutation.mutate({ ...payload, idempotencyKey: key.forPayload(payload) });
  }
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      aria-label={
        enabled
          ? l("منح صلاحية تسليم الأمتعة", "Grant bag return access")
          : l("تأكيد إلغاء الصلاحية", "Confirm access revocation")
      }
      onSubmit={submit}
    >
      {enabled && (
        <>
          <h2 className="text-lg font-semibold">
            {l("منح صلاحية", "Grant access")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {l(
              "أدخل رقم موظف العمليات أو الإدارة في مستأجر شركة الطيران نفسه.",
              "Enter the ID of operations or administration staff in the same airline tenant."
            )}
          </p>
        </>
      )}
      {staff ? (
        <p>
          {staff.staffName ?? l("الموظف", "Staff")} ({staff.staffId})
        </p>
      ) : (
        <label className="block space-y-1">
          <span>{l("رقم الموظف", "Staff ID")}</span>
          <Input
            type="number"
            min={1}
            step={1}
            value={staffId}
            disabled={locked}
            onChange={event => setStaffId(event.target.value)}
          />
        </label>
      )}
      <label className="block space-y-1">
        <span>{l("سبب تغيير الصلاحية", "Grant change reason")}</span>
        <Input
          value={reason}
          minLength={5}
          maxLength={500}
          disabled={locked}
          onChange={event => setReason(event.target.value)}
        />
      </label>
      <Button
        type="submit"
        variant={enabled ? "default" : "destructive"}
        disabled={!valid || locked}
      >
        {mutation.isPending
          ? l("جارٍ الحفظ", "Saving")
          : enabled
            ? l("منح الصلاحية", "Grant access")
            : l("تأكيد الإلغاء", "Confirm revocation")}
      </Button>
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
    </form>
  );
}
