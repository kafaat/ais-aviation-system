import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { APISForm, type APISFormData } from "./APISForm";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

interface Passenger {
  id: number;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date | string | null;
  passportNumber?: string | null;
  passportExpiry?: Date | string | null;
  nationality?: string | null;
}

const dateInput = (value?: Date | string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

/** One editor at a time keeps document identities and fixed form labels unique.
 * Documents belong to the passenger; clearance belongs to their current journey.
 */
export function PassengerTravelDocuments({
  bookingId,
  flightId,
  passengers,
}: {
  bookingId: number;
  flightId: number;
  passengers: Passenger[];
}) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState(passengers[0]?.id);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const passenger = passengers.find(p => p.id === selectedId) ?? passengers[0];
  const passengerId = passenger?.id ?? 0;
  const utils = trpc.useUtils();
  const documents = trpc.apis.getMyAPISStatus.useQuery(
    { passengerId },
    { enabled: passengerId > 0, retry: false, staleTime: 0 }
  );
  const journey = trpc.apis.getMyJourneyStatus.useQuery(
    { passengerId, flightId },
    { enabled: passengerId > 0, retry: false, staleTime: 0 }
  );
  const checking = saving || documents.isFetching || journey.isFetching;
  const data =
    !documents.error &&
    documents.data?.passengerId === passengerId &&
    documents.data.bookingId === bookingId
      ? documents.data
      : undefined;
  const route =
    !journey.error &&
    journey.data?.passengerId === passengerId &&
    journey.data.bookingId === bookingId &&
    journey.data.flightId === flightId
      ? journey.data
      : undefined;
  if (!passenger) return null;

  const stored = data?.data;
  const initialData: Partial<APISFormData> = stored
    ? {
        documentType: stored.documentType as APISFormData["documentType"],
        documentNumber: stored.documentNumber,
        issuingCountry: stored.issuingCountry,
        nationality: stored.nationality,
        dateOfBirth: dateInput(stored.dateOfBirth),
        gender: stored.gender as APISFormData["gender"],
        expiryDate: dateInput(stored.expiryDate),
        givenNames: stored.givenNames,
        surname: stored.surname,
        residenceCountry: stored.residenceCountry ?? "",
        residenceAddress: stored.residenceAddress ?? "",
        destinationAddress: stored.destinationAddress ?? "",
        redressNumber: stored.redressNumber ?? "",
        knownTravelerNumber: stored.knownTravelerNumber ?? "",
      }
    : {
        givenNames: passenger.firstName,
        surname: passenger.lastName,
        dateOfBirth: dateInput(passenger.dateOfBirth),
        documentNumber: passenger.passportNumber ?? "",
        expiryDate: dateInput(passenger.passportExpiry),
        nationality: /^[A-Z]{2,3}$/.test(passenger.nationality ?? "")
          ? (passenger.nationality ?? "")
          : "",
      };

  return (
    <Card className="p-4 space-y-4 print:hidden" aria-busy={checking}>
      <h2 className="text-lg font-semibold">
        {t("apis.journey.title", "Travel documents for this flight")}
      </h2>
      <label className="block space-y-1">
        <span>{t("apis.passenger", "Passenger")}</span>
        <select
          className="block w-full rounded border p-2"
          value={passengerId}
          disabled={saving}
          onChange={event => {
            setSelectedId(Number(event.target.value));
            setEditing(false);
          }}
        >
          {passengers.map(person => (
            <option key={person.id} value={person.id}>
              {person.firstName} {person.lastName}
            </option>
          ))}
        </select>
      </label>
      {checking && <p role="status">{t("common.loading", "Loading...")}</p>}
      {(documents.error || journey.error) && (
        <div role="alert" className="space-y-2">
          <p>
            {t(
              "apis.journey.readError",
              "Travel document or clearance status could not be verified."
            )}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              void documents.refetch();
              void journey.refetch();
            }}
          >
            {t("common.retry", "Retry")}
          </Button>
        </div>
      )}
      {data && route && (
        <>
          <p className="text-sm">
            {route.flightNumber} · {route.originAirport} →{" "}
            {route.destinationAirport}
          </p>
          {!checking && (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <dt>{t("apis.journey.savedStatus", "Saved document status")}</dt>
              <dd>{t(`apis.journey.documentStatus.${data.status}`)}</dd>
              <dt>
                {t("apis.journey.clearance", "Current journey clearance")}
              </dt>
              <dd>
                {t(`apis.journey.clearanceStatus.${route.clearanceStatus}`)}
              </dd>
              {data.validatedAt && (
                <>
                  <dt>{t("apis.validatedAt", "Validated")}</dt>
                  <dd>{new Date(data.validatedAt).toLocaleString()}</dd>
                </>
              )}
            </dl>
          )}
          <p className="text-sm text-muted-foreground">
            {t(
              "apis.journey.separateClearance",
              "Saving or validating document fields does not grant travel clearance or transmit them to a border authority."
            )}
          </p>
          {!checking && route.clearanceStatus === "not_cleared" && (
            <p role="status" className="text-sm">
              {t(
                "apis.journey.operatorReview",
                "Current operator clearance is required before international check-in. Contact the airline after saving your documents."
              )}
            </p>
          )}
          {(!route.originCountry || !route.destinationCountry) && (
            <p role="status" className="text-sm">
              {t(
                "apis.journey.unknownRoute",
                "Country-specific requirements are unavailable for this route. You can save document details; the airline must review the route requirements."
              )}
            </p>
          )}
          {editing ? (
            <APISForm
              key={`${bookingId}:${passengerId}:${flightId}`}
              passengerId={passengerId}
              passengerName={`${passenger.firstName} ${passenger.lastName}`}
              originCountry={route.originCountry ?? undefined}
              destinationCountry={route.destinationCountry ?? undefined}
              initialData={initialData}
              onCancel={() => setEditing(false)}
              onSuccess={() => setEditing(false)}
              onSaveStateChange={async pending => {
                if (pending) {
                  setSaving(true);
                  return;
                }
                // A lost save response may still have committed new documents.
                // Re-read every outcome before showing a current verdict again.
                await Promise.allSettled([
                  utils.apis.getMyAPISStatus.invalidate({ passengerId }),
                  utils.apis.getMyJourneyStatus.invalidate(),
                  utils.bookings.getDepartureState.invalidate({ bookingId }),
                ]);
                setSaving(false);
              }}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={checking}
              onClick={() => setEditing(true)}
            >
              {data.hasData
                ? t(
                    "apis.journey.editDocuments",
                    "Review or edit travel documents"
                  )
                : t("apis.journey.addDocuments", "Add travel documents")}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
