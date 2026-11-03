import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEO } from "@/components/SEO";
import type { AgentPortalBooking } from "../../../server/contracts/agent-portal";
import {
  formatFlightDate,
  formatFlightTime,
  isValidTimeZone,
} from "@/lib/flight-time";

type Agency = {
  id: number;
  agencyName: string;
  iataNumber: string;
  contactEmail: string;
  contactPhone: string;
};
type Passenger = {
  type: "adult" | "child" | "infant";
  firstName: string;
  lastName: string;
};
const blankPassenger = (): Passenger => ({
  type: "adult",
  firstName: "",
  lastName: "",
});
const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function AgencyWorkspace({
  agency,
  onCommandLockChange,
}: {
  agency: Agency;
  onCommandLockChange: (agency: Agency | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const [originCode, setOriginCode] = useState("");
  const [destinationCode, setDestinationCode] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [cabinClass, setCabinClass] = useState<"economy" | "business">(
    "economy"
  );
  const [passengers, setPassengers] = useState<Passenger[]>([blankPassenger()]);
  const [flightId, setFlightId] = useState<number | null>(null);
  const [externalReference, setExternalReference] = useState("");
  const [page, setPage] = useState(1);
  const [commandLocked, setCommandLocked] = useState(false);
  const command = useRef<AgentPortalBooking | null>(null);
  const requestInFlight = useRef(false);
  const uncertainResponse = useRef(false);
  const search = trpc.agentPortal.search.useMutation({
    retry: false,
    gcTime: 0,
  });
  const dashboard = trpc.agentPortal.dashboard.useQuery(
    { agencyId: agency.id, page },
    { retry: false, staleTime: 0, gcTime: 0 }
  );
  const createBooking = trpc.agentPortal.createBooking.useMutation({
    retry: false,
    gcTime: 0,
    onSuccess: result => {
      requestInFlight.current = false;
      navigate(`/checkout/${result.bookingId}`);
    },
    onError: error => {
      requestInFlight.current = false;
      // Only a definitive rejection of the first attempt permits editing.
      // A later rejection cannot rule out an earlier, lost committed response.
      // CONFLICT can also mean a committed idempotency response is unavailable.
      const rejected = [
        "BAD_REQUEST",
        "UNAUTHORIZED",
        "FORBIDDEN",
        "NOT_FOUND",
        "PRECONDITION_FAILED",
        "TOO_MANY_REQUESTS",
      ].includes(error.data?.code ?? "");
      if (rejected && !uncertainResponse.current) {
        command.current = null;
        setCommandLocked(false);
        onCommandLockChange(null);
      } else {
        uncertainResponse.current = true;
      }
    },
  });
  const money = (amount: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: "currency",
      currency: "SAR",
    }).format(amount / 100);
  const selectedFlight = search.data?.find(flight => flight.id === flightId);

  function resetSearch() {
    if (command.current) return false;
    search.reset();
    setFlightId(null);
    return true;
  }
  function findFlights(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (command.current || search.isPending) return;
    setFlightId(null);
    createBooking.reset();
    search.mutate({
      agencyId: agency.id,
      originCode,
      destinationCode,
      departureDate,
      cabinClass,
      passengers: passengers.length,
    });
  }
  function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;
    if (!command.current) {
      if (!selectedFlight) return;
      command.current = {
        agencyId: agency.id,
        flightId: selectedFlight.id,
        cabinClass,
        passengers: passengers.map(passenger => ({ ...passenger })),
        // Required by the existing command contract/hash. The authority does
        // not persist new passenger contact records from these fields.
        contactEmail: agency.contactEmail,
        contactPhone: agency.contactPhone,
        externalReference: externalReference.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      };
      uncertainResponse.current = false;
      setCommandLocked(true);
      onCommandLockChange(agency);
    }
    requestInFlight.current = true;
    // Retry the complete immutable snapshot, never current draft state.
    createBooking.mutate(command.current);
  }
  const busy = search.isPending || createBooking.isPending;
  const editingDisabled = busy || commandLocked;

  return (
    <div className="space-y-8">
      <Card className="p-6 space-y-4">
        <h2 className="text-xl font-semibold">
          {t("agentPortal.searchTitle")}
        </h2>
        <form onSubmit={findFlights} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="agent-origin">{t("agentPortal.origin")}</Label>
            <Input
              id="agent-origin"
              required
              minLength={3}
              maxLength={3}
              value={originCode}
              disabled={editingDisabled}
              onChange={event => {
                if (!resetSearch()) return;
                setOriginCode(event.target.value.toUpperCase());
              }}
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-destination">
              {t("agentPortal.destination")}
            </Label>
            <Input
              id="agent-destination"
              required
              minLength={3}
              maxLength={3}
              value={destinationCode}
              disabled={editingDisabled}
              onChange={event => {
                if (!resetSearch()) return;
                setDestinationCode(event.target.value.toUpperCase());
              }}
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-date">{t("agentPortal.departureDate")}</Label>
            <Input
              id="agent-date"
              type="date"
              required
              value={departureDate}
              disabled={editingDisabled}
              onChange={event => {
                if (!resetSearch()) return;
                setDepartureDate(event.target.value);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-cabin">{t("agentPortal.cabin")}</Label>
            <select
              id="agent-cabin"
              className={selectClass}
              value={cabinClass}
              disabled={editingDisabled}
              onChange={event => {
                if (!resetSearch()) return;
                setCabinClass(event.target.value as "economy" | "business");
              }}
            >
              <option value="economy">{t("agentPortal.economy")}</option>
              <option value="business">{t("agentPortal.business")}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-party">
              {t("agentPortal.passengerCount")}
            </Label>
            <select
              id="agent-party"
              className={selectClass}
              value={passengers.length}
              disabled={editingDisabled}
              onChange={event => {
                if (!resetSearch()) return;
                const count = Number(event.target.value);
                setPassengers(current =>
                  Array.from(
                    { length: count },
                    (_, index) => current[index] ?? blankPassenger()
                  )
                );
              }}
            >
              {Array.from({ length: 9 }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={editingDisabled}>
              {t(
                search.isPending
                  ? "agentPortal.searching"
                  : "agentPortal.search"
              )}
            </Button>
          </div>
        </form>
        {search.error && (
          <p role="alert" className="text-destructive">
            {t("agentPortal.searchError")}
          </p>
        )}
        {search.isSuccess && search.data.length === 0 && (
          <p role="status">{t("agentPortal.noFlights")}</p>
        )}
        {!!search.data?.length && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("agentPortal.baseFareHelp")}
            </p>
            {search.data.map(flight => {
              const zone = isValidTimeZone(flight.origin.timezone)
                ? flight.origin.timezone
                : "UTC";
              return (
                <div
                  key={flight.id}
                  className="rounded-md border p-4 flex flex-wrap gap-4 justify-between items-center"
                >
                  <div>
                    <p className="font-semibold">
                      <bdi>{flight.flightNumber}</bdi> ·{" "}
                      <bdi>
                        {flight.origin.code} → {flight.destination.code}
                      </bdi>
                    </p>
                    <p>
                      {formatFlightDate(
                        flight.departureTime,
                        zone,
                        i18n.language
                      )}{" "}
                      ·{" "}
                      {formatFlightTime(
                        flight.departureTime,
                        zone,
                        i18n.language
                      )}{" "}
                      <bdi>{zone}</bdi>
                    </p>
                    <p>
                      {t("agentPortal.baseFare")}: {money(flight.adultBaseFare)}
                    </p>
                    <p className="text-sm">
                      {t("agentPortal.availableSeats", {
                        count: flight.availableSeats,
                      })}
                    </p>
                  </div>
                  <Button
                    variant={flightId === flight.id ? "default" : "outline"}
                    disabled={editingDisabled}
                    onClick={() => {
                      if (command.current) return;
                      setFlightId(flight.id);
                      createBooking.reset();
                    }}
                  >
                    {t(
                      flightId === flight.id
                        ? "agentPortal.selected"
                        : "agentPortal.selectFlight"
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {selectedFlight && (
        <Card className="p-6 space-y-4">
          <h2 className="text-xl font-semibold">
            {t("agentPortal.passengerDetails")} ·{" "}
            <bdi>{selectedFlight.flightNumber}</bdi>
          </h2>
          <form onSubmit={book} className="space-y-5">
            {passengers.map((passenger, index) => (
              <fieldset
                key={index}
                className="rounded-md border p-4 grid gap-3 sm:grid-cols-3"
                disabled={editingDisabled}
              >
                <legend className="px-2">
                  {t("agentPortal.passenger", { number: index + 1 })}
                </legend>
                <div className="space-y-2">
                  <Label htmlFor={`agent-first-${index}`}>
                    {t("agentPortal.firstName")}
                  </Label>
                  <Input
                    id={`agent-first-${index}`}
                    required
                    maxLength={100}
                    value={passenger.firstName}
                    onChange={event => {
                      if (command.current) return;
                      setPassengers(current =>
                        current.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, firstName: event.target.value }
                            : row
                        )
                      );
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`agent-last-${index}`}>
                    {t("agentPortal.lastName")}
                  </Label>
                  <Input
                    id={`agent-last-${index}`}
                    required
                    maxLength={100}
                    value={passenger.lastName}
                    onChange={event => {
                      if (command.current) return;
                      setPassengers(current =>
                        current.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, lastName: event.target.value }
                            : row
                        )
                      );
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`agent-type-${index}`}>
                    {t("agentPortal.passengerType")}
                  </Label>
                  <select
                    id={`agent-type-${index}`}
                    className={selectClass}
                    value={passenger.type}
                    onChange={event => {
                      if (command.current) return;
                      setPassengers(current =>
                        current.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                type: event.target.value as Passenger["type"],
                              }
                            : row
                        )
                      );
                    }}
                  >
                    <option value="adult">{t("agentPortal.adult")}</option>
                    <option value="child">{t("agentPortal.child")}</option>
                    <option value="infant">{t("agentPortal.infant")}</option>
                  </select>
                </div>
              </fieldset>
            ))}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="agent-external-reference">
                  {t("agentPortal.externalReference")}
                </Label>
                <Input
                  id="agent-external-reference"
                  maxLength={100}
                  value={externalReference}
                  disabled={editingDisabled}
                  onChange={event => {
                    if (command.current) return;
                    setExternalReference(event.target.value);
                  }}
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("agentPortal.checkoutHelp")}
            </p>
            <Button type="submit" disabled={createBooking.isPending}>
              {t(
                createBooking.isPending
                  ? "agentPortal.creating"
                  : createBooking.error && commandLocked
                    ? "agentPortal.retryReservation"
                    : "agentPortal.create"
              )}
            </Button>
            {createBooking.error && (
              <p role="alert" className="text-destructive">
                {t(
                  commandLocked
                    ? "agentPortal.createUncertain"
                    : "agentPortal.createError"
                )}
              </p>
            )}
          </form>
        </Card>
      )}

      <section className="space-y-4" aria-labelledby="agent-bookings-heading">
        <h2 id="agent-bookings-heading" className="text-xl font-semibold">
          {t("agentPortal.bookingsTitle")}
        </h2>
        {dashboard.isLoading && <p role="status">{t("common.loading")}</p>}
        {dashboard.error ? (
          <div role="alert">
            <p>{t("agentPortal.dashboardError")}</p>
            <Button variant="outline" onClick={() => void dashboard.refetch()}>
              {t("agentPortal.retry")}
            </Button>
          </div>
        ) : (
          dashboard.data && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Card className="p-4">
                  <p>{t("agentPortal.totalBookings")}</p>
                  <strong>{dashboard.data.stats.totalBookings}</strong>
                </Card>
                <Card className="p-4">
                  <p>{t("agentPortal.recordedAmount")}</p>
                  <strong>
                    {money(dashboard.data.stats.recordedBookingAmount)}
                  </strong>
                </Card>
                <Card className="p-4">
                  <p>{t("agentPortal.recordedCommission")}</p>
                  <strong>
                    {money(dashboard.data.stats.recordedCommissionAmount)}
                  </strong>
                </Card>
              </div>
              {dashboard.data.credit?.settlementReview && (
                <p role="status">{t("agencyCredit.settlementReview")}</p>
              )}
              {dashboard.data.credit?.limitMinor != null && (
                <p aria-label={t("agencyCredit.title")}>
                  {t("agencyCredit.balance", {
                    limit: money(dashboard.data.credit.limitMinor),
                    outstanding: money(dashboard.data.credit.outstandingMinor),
                    available: money(dashboard.data.credit.availableMinor ?? 0),
                  })}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                {t("agentPortal.statsHelp")}
              </p>
              {dashboard.data.total === 0 ? (
                <p>{t("agentPortal.noBookings")}</p>
              ) : (
                <ul className="space-y-3">
                  {dashboard.data.bookings.map(booking => (
                    <li key={booking.bookingId}>
                      <Card className="p-4 flex flex-wrap gap-3 items-center justify-between">
                        <div>
                          <p className="font-semibold">
                            <bdi>{booking.bookingReference}</bdi> ·{" "}
                            <bdi>{booking.flightNumber}</bdi>
                          </p>
                          <p>
                            {t(`manageBooking.status.${booking.status}`)} ·{" "}
                            {money(booking.totalAmount)}
                          </p>
                        </div>
                        <Button asChild variant="outline">
                          <Link
                            href={
                              booking.status === "pending" &&
                              booking.paymentStatus === "pending"
                                ? `/checkout/${booking.bookingId}`
                                : `/my-bookings?bookingId=${booking.bookingId}`
                            }
                          >
                            {t(
                              booking.status === "pending" &&
                                booking.paymentStatus === "pending"
                                ? "agentPortal.continueCheckout"
                                : "agentPortal.openBooking"
                            )}
                          </Link>
                        </Button>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-3 items-center">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(current => current - 1)}
                >
                  {t("agentPortal.previous")}
                </Button>
                <span>{t("agentPortal.page", { page })}</span>
                <Button
                  variant="outline"
                  disabled={
                    page * dashboard.data.pageSize >= dashboard.data.total
                  }
                  onClick={() => setPage(current => current + 1)}
                >
                  {t("agentPortal.next")}
                </Button>
              </div>
            </>
          )
        )}
      </section>
    </div>
  );
}

export default function AgentPortal() {
  const { t } = useTranslation();
  const agencies = trpc.agentPortal.agencies.useQuery(undefined, {
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const [agencyId, setAgencyId] = useState<number | null>(null);
  const [lockedAgency, setLockedAgency] = useState<Agency | null>(null);
  const selected =
    lockedAgency ??
    agencies.data?.find(agency => agency.id === agencyId) ??
    agencies.data?.[0];
  return (
    <main className="container max-w-5xl py-10 space-y-6" id="main-content">
      <SEO title={t("agentPortal.title")} />
      <Link href="/" className="text-sm underline underline-offset-4">
        {t("manageBooking.backHome")}
      </Link>
      <h1 className="text-3xl font-bold">{t("agentPortal.title")}</h1>
      <p className="text-muted-foreground">{t("agentPortal.description")}</p>
      {agencies.isLoading && !lockedAgency ? (
        <p role="status">{t("common.loading")}</p>
      ) : agencies.error && !lockedAgency ? (
        <div role="alert">
          <p>{t("agentPortal.agencyError")}</p>
          <Button variant="outline" onClick={() => void agencies.refetch()}>
            {t("agentPortal.retry")}
          </Button>
        </div>
      ) : !selected ? (
        <Card className="p-6">{t("agentPortal.noAgency")}</Card>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="agent-agency">{t("agentPortal.agency")}</Label>
            <select
              id="agent-agency"
              className={selectClass}
              value={selected.id}
              disabled={lockedAgency !== null}
              onChange={event => {
                if (lockedAgency) return;
                setAgencyId(Number(event.target.value));
              }}
            >
              {lockedAgency &&
                !agencies.data?.some(
                  agency => agency.id === lockedAgency.id
                ) && (
                  <option value={lockedAgency.id}>
                    {lockedAgency.agencyName} · {lockedAgency.iataNumber}
                  </option>
                )}
              {agencies.data?.map(agency => (
                <option key={agency.id} value={agency.id}>
                  {agency.agencyName} · {agency.iataNumber}
                </option>
              ))}
            </select>
          </div>
          <AgencyWorkspace
            key={selected.id}
            agency={selected}
            onCommandLockChange={setLockedAgency}
          />
        </>
      )}
    </main>
  );
}
