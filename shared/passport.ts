/** Existing application format policy; this does not verify a travel document. */
export function hasValidOptionalPassport(value?: string): boolean {
  return !value || /^[A-Za-z0-9]{6,12}$/.test(value);
}
