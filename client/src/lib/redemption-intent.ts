// Retain the identity across an unknown result in this browser tab. The server
// keeps its completed, user-scoped command receipt without an expiry.
export function prepareRedemption(
  storage: Storage,
  userId: number,
  miles: number,
  availableMiles: number
) {
  return prepareValueIntent(
    storage,
    `ais:loyalty:redeem:${userId}:${miles}`,
    miles <= availableMiles
  );
}

/** Preserve a tab's pending command identity until its owner receives a reply. */
export function prepareValueIntent(
  storage: Storage,
  slot: string,
  allowNew = true
) {
  let key = storage.getItem(slot);
  if (key === null) {
    if (!allowNew) return null;
    key = crypto.randomUUID();
    storage.setItem(slot, key);
  } else if (
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
      key
    )
  ) {
    throw new Error("Saved transaction identity is invalid");
  }
  return {
    key,
    acknowledge() {
      if (storage.getItem(slot) === key) storage.removeItem(slot);
    },
  };
}
