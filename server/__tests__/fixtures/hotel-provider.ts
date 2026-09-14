import { vi } from "vitest";
import type { HotelProvider } from "../../integrations/hotelbeds";
import type {
  HotelRequest,
  HotelReceipt,
} from "../../../shared/hotel-fulfillment";

export const hotelFixtureRequest: HotelRequest = {
  quoteId: "11111111-1111-4111-8111-111111111111",
  mappingEvidence: "fixture mapping, not provider acceptance",
  quotedBy: 9,
  approvedBy: 9,
  approvedAt: "2026-01-01T00:00:00.000Z",
  holder: { name: "Synthetic", surname: "Fixture" },
  maxCancellationCost: 0,
  quote: {
    provider: "hotelbeds",
    mode: "sandbox",
    account: "fixture-account",
    hotelCode: 123,
    roomCode: "SGL.ST",
    boardCode: "RO",
    checkIn: "2035-01-01",
    checkOut: "2035-01-02",
    currency: "SAR",
    totalCost: 12000,
    rateKey: "synthetic-rate-key",
    terms: "Fixture terms; not a supplier offer",
    cancellationPolicies: [{ from: "2034-12-31T00:00:00Z", amount: 12000 }],
    expiresAt: "2035-01-01T00:00:00.000Z",
  },
};
export const hotelFixtureReceipt: HotelReceipt = {
  reference: "123-456",
  clientReference: "HLOCALFIXTURE",
  status: "CONFIRMED",
  currency: "SAR",
  totalCost: 12000,
  cancellationCost: null,
  cancellationReference: null,
};
export const providerBookingBody = () => ({
  booking: {
    reference: "123-456",
    clientReference: "HLOCALFIXTURE",
    status: "CONFIRMED",
    currency: "SAR",
    totalNet: 120,
    hotel: {
      code: 123,
      checkIn: "2035-01-01",
      checkOut: "2035-01-02",
      rooms: [{ code: "SGL.ST", rates: [{ boardCode: "RO", rooms: 1 }] }],
    },
  },
});
export const hotelFixtureProvider = (): HotelProvider => ({
  mode: "sandbox",
  account: "fixture-account",
  quote: vi.fn(async () => structuredClone(hotelFixtureRequest.quote)),
  book: vi.fn(async () => structuredClone(hotelFixtureReceipt)),
  lookup: vi.fn(async () => structuredClone(hotelFixtureReceipt)),
  cancel: vi.fn<HotelProvider["cancel"]>(async (_r, _c, _ref, simulate) => ({
    ...hotelFixtureReceipt,
    status: simulate ? "CONFIRMED" : "CANCELLED",
    cancellationCost: 0,
    cancellationReference: simulate ? null : "CANCEL-FIXTURE",
  })),
});
