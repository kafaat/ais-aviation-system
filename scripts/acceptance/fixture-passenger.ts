/** A unique Latin document surname for each synthetic booking and passenger. */
export function fixtureSurname(bookingOffset: number, passengerIndex: number) {
  const tag = String(bookingOffset).replace(
    /\d/g,
    digit => "ABCDEFGHIJ"[Number(digit)]
  );
  const families = [
    "Alder",
    "Birch",
    "Cedar",
    "Elm",
    "Fir",
    "Maple",
    "Oak",
    "Pine",
    "Rowan",
    "Willow",
  ];
  const family = families[passengerIndex];
  if (!family) throw new Error("Missing synthetic passenger family name");
  return `${family} ${tag}`;
}
