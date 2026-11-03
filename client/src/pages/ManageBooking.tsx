import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEO } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import {
  formatFlightDate,
  formatFlightTime,
  isValidTimeZone,
} from "@/lib/flight-time";

export default function ManageBooking() {
  const { t, i18n } = useTranslation();
  const [bookingReference, setBookingReference] = useState("");
  const [surname, setSurname] = useState("");
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const lookup = trpc.manageBooking.lookup.useMutation({
    retry: false,
    gcTime: 0,
    onSuccess: () => setSurname(""),
  });

  useEffect(() => {
    if (lookup.data) resultHeading.current?.focus();
  }, [lookup.data]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    lookup.mutate({ bookingReference, surname });
  }

  return (
    <main className="container max-w-3xl py-10 space-y-6" id="main-content">
      <SEO title={t("manageBooking.title")} />
      <Link href="/" className="text-sm underline underline-offset-4">
        {t("manageBooking.backHome")}
      </Link>
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{t("manageBooking.title")}</h1>
        <p className="text-muted-foreground">
          {t("manageBooking.description")}
        </p>
      </header>

      <Card className="p-6">
        <form
          method="post"
          onSubmit={submit}
          className="space-y-4"
          aria-busy={lookup.isPending}
        >
          <div className="space-y-2">
            <Label htmlFor="manage-booking-reference">
              {t("manageBooking.reference")}
            </Label>
            <Input
              id="manage-booking-reference"
              name="bookingReference"
              value={bookingReference}
              onChange={event => {
                lookup.reset();
                setBookingReference(event.target.value);
              }}
              required
              maxLength={64}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={lookup.isPending}
              aria-describedby="manage-reference-help"
              dir="ltr"
            />
            <p
              id="manage-reference-help"
              className="text-sm text-muted-foreground"
            >
              {t("manageBooking.referenceHelp")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manage-booking-surname">
              {t("manageBooking.surname")}
            </Label>
            <Input
              id="manage-booking-surname"
              name="surname"
              value={surname}
              onChange={event => {
                lookup.reset();
                setSurname(event.target.value);
              }}
              required
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
              disabled={lookup.isPending}
              aria-describedby="manage-surname-help"
            />
            <p
              id="manage-surname-help"
              className="text-sm text-muted-foreground"
            >
              {t("manageBooking.surnameHelp")}
            </p>
          </div>
          <Button type="submit" disabled={lookup.isPending}>
            {t(
              lookup.isPending
                ? "manageBooking.searching"
                : "manageBooking.find"
            )}
          </Button>
          {lookup.error && (
            <p role="alert" className="text-sm text-destructive">
              {t(
                lookup.error.data?.code === "TOO_MANY_REQUESTS"
                  ? "manageBooking.tooManyAttempts"
                  : "manageBooking.failure"
              )}
            </p>
          )}
        </form>
      </Card>

      {lookup.data && (
        <section
          className="space-y-4"
          aria-labelledby="manage-itinerary-heading"
        >
          <h2
            id="manage-itinerary-heading"
            ref={resultHeading}
            tabIndex={-1}
            className="text-xl font-semibold"
          >
            {t("manageBooking.itinerary")} ·{" "}
            <bdi>{lookup.data.bookingReference}</bdi>
          </h2>
          <p role="status">
            {t("manageBooking.bookingStatus")}:{" "}
            {t(`manageBooking.status.${lookup.data.status}`)}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("manageBooking.localTimes")}
          </p>
          <ol className="space-y-4">
            {lookup.data.itinerary.map((segment, index) => (
              <li key={`${index}-${segment.flightNumber}`}>
                <Card className="p-5 space-y-3">
                  <h3 className="font-semibold">
                    <bdi>{segment.flightNumber}</bdi>
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(["origin", "destination"] as const).map(side => {
                      const airport = segment[side];
                      const instant =
                        side === "origin"
                          ? segment.departureTime
                          : segment.arrivalTime;
                      // Missing airport zones are shown as UTC, never silently
                      // as the visitor's computer time zone.
                      const zone = isValidTimeZone(airport.timezone)
                        ? airport.timezone
                        : "UTC";
                      return (
                        <div key={side}>
                          <p className="text-sm text-muted-foreground">
                            {t(
                              side === "origin"
                                ? "manageBooking.departure"
                                : "manageBooking.arrival"
                            )}
                          </p>
                          <p>
                            <bdi>{airport.code}</bdi> · {airport.city}
                          </p>
                          <time dateTime={instant}>
                            {formatFlightDate(instant, zone, i18n.language)} ·{" "}
                            {formatFlightTime(instant, zone, i18n.language)}
                          </time>
                          <p className="text-xs text-muted-foreground">
                            <bdi>{zone}</bdi>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-sm">
                    {t("manageBooking.segmentStatus")}:{" "}
                    {t(`manageBooking.status.${segment.segmentStatus}`)}
                    {" · "}
                    {t("manageBooking.flightStatus")}:{" "}
                    {t(`manageBooking.status.${segment.flightStatus}`)}
                  </p>
                </Card>
              </li>
            ))}
          </ol>
          <Button
            variant="outline"
            onClick={() => {
              lookup.reset();
              setBookingReference("");
              setSurname("");
            }}
          >
            {t("manageBooking.clear")}
          </Button>
        </section>
      )}

      <Card className="p-6 space-y-3">
        <h2 className="font-semibold">{t("manageBooking.accountTitle")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("manageBooking.accountHelp")}
        </p>
        <Button asChild variant="outline">
          <Link href="/my-bookings">{t("manageBooking.accountAction")}</Link>
        </Button>
      </Card>
    </main>
  );
}
