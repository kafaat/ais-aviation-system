// GACA Passenger Rights Protection Regulations, article 10(6).
export const GACA_PASSENGER_RIGHTS =
  "https://gaca.gov.sa/-/media/Files/PDF/LawsAndRegulation/Consumer-Protection/Regulations/Passenger_Rights_Protection_Regulations_AR.pdf";

// A tariff lookup only: scope, exceptions and verified arrival evidence are
// reviewed on the claim. XDR is independent of the settlement currency.
export function arrivalDelayTariffXdr(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new RangeError("Arrival delay must be finite and nonnegative");
  }
  if (minutes > 360) return 150;
  if (minutes >= 180) return 50;
  return 0;
}
