/**
 * Interline Service
 *
 * Manages interline ticketing and baggage agreements between airlines.
 * Delegates to the codeshare service which handles both codeshare
 * and interline agreement management.
 *
 * Local agreement and proration planning. No accepted external ticketing,
 * baggage-transfer or settlement transport is installed.
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
export { getInterlineExecutionCapability } from "./distribution-readiness.service";
