import type { MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../../../drizzle/schema";

// Independent expected retention contract. Production does not import this
// fixture; a missing guard must still fail the corresponding source case.
export const retainedPurgeSources: ReadonlyArray<{
  table: MySqlTable;
  bookingColumn: "bookingId" | "consumedBookingId";
  passengerColumn?: "passengerId";
}> = [
  { table: schema.payments, bookingColumn: "bookingId" },
  { table: schema.paymentReceipts, bookingColumn: "bookingId" },
  { table: schema.paymentHistory, bookingColumn: "bookingId" },
  { table: schema.paymentSplits, bookingColumn: "bookingId" },
  { table: schema.financialLedger, bookingColumn: "bookingId" },
  { table: schema.bookingRefundPlans, bookingColumn: "bookingId" },
  { table: schema.bookingRefundItems, bookingColumn: "bookingId" },
  { table: schema.orderServiceRefunds, bookingColumn: "bookingId" },
  { table: schema.userCredits, bookingColumn: "bookingId" },
  { table: schema.creditUsage, bookingColumn: "bookingId" },
  { table: schema.voucherUsage, bookingColumn: "bookingId" },
  { table: schema.walletTransactions, bookingColumn: "bookingId" },
  { table: schema.milesTransactions, bookingColumn: "bookingId" },
  { table: schema.bookingLoyaltyAccruals, bookingColumn: "bookingId" },
  { table: schema.loyaltyCreditLots, bookingColumn: "bookingId" },
  { table: schema.loyaltyContractLiabilityEvents, bookingColumn: "bookingId" },
  { table: schema.agencyCreditObligations, bookingColumn: "bookingId" },
  { table: schema.corporateBookings, bookingColumn: "bookingId" },
  { table: schema.agentBookings, bookingColumn: "bookingId" },
  { table: schema.bookingModifications, bookingColumn: "bookingId" },
  { table: schema.bookingCheckoutRequests, bookingColumn: "bookingId" },
  { table: schema.retailOffers, bookingColumn: "consumedBookingId" },
  {
    table: schema.bookingFareComponents,
    bookingColumn: "bookingId",
    passengerColumn: "passengerId",
  },
  {
    table: schema.bookingAncillaries,
    bookingColumn: "bookingId",
    passengerColumn: "passengerId",
  },
  { table: schema.zatcaInvoiceDrafts, bookingColumn: "bookingId" },
  {
    table: schema.ticketCoupons,
    bookingColumn: "bookingId",
    passengerColumn: "passengerId",
  },
  {
    table: schema.electronicMiscDocs,
    bookingColumn: "bookingId",
    passengerColumn: "passengerId",
  },
  { table: schema.ndcOrders, bookingColumn: "bookingId" },
  {
    table: schema.compensationClaims,
    bookingColumn: "bookingId",
    passengerColumn: "passengerId",
  },
  {
    table: schema.emergencyHotelBookings,
    bookingColumn: "bookingId",
    passengerColumn: "passengerId",
  },
];
