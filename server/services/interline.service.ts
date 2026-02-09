/**
 * Interline Service
 *
 * Manages interline ticketing and baggage agreements between airlines.
 * Delegates to the codeshare service which handles both codeshare
 * and interline agreement management.
 *
 * IATA Resolution 780/788 compliance
 */

export {
  createInterlineAgreement,
  updateInterlineAgreement,
  getInterlineAgreement,
  listInterlineAgreements,
  activateInterlineAgreement,
  terminateInterlineAgreement,
  checkInterlineEligibility,
  calculateProrateShare,
  getPartnerAirlines,
} from "./codeshare.service";

export type { UpdateInterlineAgreementInput } from "./codeshare.service";
