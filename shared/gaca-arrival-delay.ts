// GACA Passenger Rights Protection Regulations, article 10(6).
export const GACA_PASSENGER_RIGHTS =
  "https://gaca.gov.sa/-/media/Files/PDF/LawsAndRegulation/Consumer-Protection/Regulations/Unnamed-item.pdf";

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

/** Rate in millionths of SAR per SDR; round once to the nearest halala. */
export function gacaArrivalAward(
  scheduledArrivalUtc: string,
  actualArrivalUtc: string,
  sarPerXdrMillionths: number
) {
  const scheduledMs = Date.parse(scheduledArrivalUtc);
  // GACA circular of 21 September 2023 specifies 20 November 2023 as
  // commencement. Earlier bookings' arrival dates require historical review.
  if (scheduledMs < Date.parse("2023-11-20T00:00:00+03:00")) {
    throw new RangeError("Arrival predates the applicable policy");
  }
  const minutes = (Date.parse(actualArrivalUtc) - scheduledMs) / 60_000;
  const sdr = arrivalDelayTariffXdr(minutes);
  if (
    !Number.isSafeInteger(sarPerXdrMillionths) ||
    sarPerXdrMillionths <= 0 ||
    !Number.isSafeInteger(sdr * sarPerXdrMillionths)
  ) {
    throw new RangeError("Invalid SDR conversion rate");
  }
  const halalas = Math.round((sdr * sarPerXdrMillionths) / 10_000);
  if (halalas > 2_147_483_647)
    throw new RangeError("Award exceeds supported amount");
  return { minutes, sdr, halalas };
}
