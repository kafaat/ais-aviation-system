import type { MySqlTable } from "drizzle-orm/mysql-core";
import {
  airports,
  baggageCustodyEvents,
  baggageItems,
  bookingSegments,
  bookings,
  dcsFlightOperations,
  dcsOperationEvents,
  dcsPassengerStates,
  fareClasses,
  flightFareClassInventory,
  flights,
  inventoryLocks,
  passengers,
  seatHolds,
  seatInventory,
  seatMaps,
  ticketCoupons,
  waitlist,
} from "../../../drizzle/schema";
import {
  apisData,
  operationalMessageRoutes,
  operationalMessageTransmissions,
} from "../../../drizzle/operations-schema";

export const opsReportTables: MySqlTable[] = [
  airports,
  baggageCustodyEvents,
  baggageItems,
  bookingSegments,
  bookings,
  dcsFlightOperations,
  dcsOperationEvents,
  dcsPassengerStates,
  fareClasses,
  flightFareClassInventory,
  flights,
  inventoryLocks,
  passengers,
  seatHolds,
  seatInventory,
  seatMaps,
  ticketCoupons,
  waitlist,
  apisData,
  operationalMessageRoutes,
  operationalMessageTransmissions,
];
export type FixtureValue = string | number | null;
export type FixtureInsert = (
  table: MySqlTable,
  values: Record<string, FixtureValue>
) => void | Promise<void>;

/** Synthetic relational evidence shared by SQLite SQL and native MySQL tests. */
export async function seedOpsReportRows(insert: FixtureInsert) {
  await insert(airports, {
    id: 1,
    code: "RUH",
    city: "Riyadh",
    timezone: "Asia/Riyadh",
  });
  await insert(airports, {
    id: 2,
    code: "JED",
    city: "Jeddah",
    timezone: "Asia/Riyadh",
  });
  await insert(airports, {
    id: 3,
    code: "ADE",
    city: "Aden",
    timezone: "Asia/Aden",
  });
  const flight = {
    airlineId: 1,
    originId: 1,
    destinationId: 2,
    aircraftType: "A320",
    economySeats: 5,
    businessSeats: 2,
    economyAvailable: 2,
    businessAvailable: 1,
    status: "scheduled",
  };
  await insert(flights, {
    ...flight,
    id: 1,
    tenantId: 101,
    flightNumber: "AIS101",
    departureTime: "2030-01-02 10:00:00",
    arrivalTime: "2030-01-02 12:00:00",
  });
  await insert(flights, {
    ...flight,
    id: 2,
    tenantId: 101,
    flightNumber: "AIS102",
    destinationId: 3,
    status: "completed",
    departureTime: "2030-01-03 00:00:00",
    arrivalTime: "2030-01-03 02:00:00",
    stationOffBlocksAt: "2030-01-03 00:20:00",
  });
  await insert(flights, {
    ...flight,
    id: 3,
    tenantId: 202,
    airlineId: 2,
    flightNumber: "FOREIGN303",
    departureTime: "2030-01-02 10:00:00",
    arrivalTime: "2030-01-02 12:00:00",
  });
  const booking = {
    tenantId: 101,
    userId: 701,
    flightId: 1,
    status: "confirmed",
    paymentStatus: "paid",
    seatsReserved: 1,
    cabinClass: "economy",
    numberOfPassengers: 1,
    checkedIn: 0,
    createdAt: "2029-12-20 12:00:00",
    totalAmount: 10000,
  };
  await insert(bookings, {
    ...booking,
    id: 10,
    bookingReference: "BOOK10",
    pnr: "PNR010",
    numberOfPassengers: 2,
    checkedIn: 1,
  });
  await insert(bookings, {
    ...booking,
    id: 11,
    bookingReference: "BOOK11",
    pnr: "PNR011",
    status: "completed",
    seatsReserved: 0,
  });
  await insert(bookings, {
    ...booking,
    id: 12,
    bookingReference: "BOOK12",
    pnr: "PNR012",
    tenantId: 202,
    flightId: 3,
  });
  await insert(bookings, {
    ...booking,
    id: 13,
    bookingReference: "BAD013",
    pnr: "BADP13",
    tenantId: 202,
  });
  await insert(bookings, {
    ...booking,
    id: 14,
    bookingReference: "BOOK14",
    pnr: "PNR014",
    status: "cancelled",
    seatsReserved: 0,
  });
  await insert(bookings, {
    ...booking,
    id: 15,
    bookingReference: "BAD015",
    pnr: "BADP15",
  });
  await insert(bookings, {
    ...booking,
    id: 16,
    bookingReference: "BOOK16",
    pnr: "PNR016",
    status: "pending",
    paymentStatus: "pending",
    seatsReserved: 0,
    inventoryLockId: 50,
    numberOfPassengers: 3,
  });
  await insert(bookings, {
    ...booking,
    id: 17,
    bookingReference: "BOOK17",
    pnr: "PNR017",
    status: "pending",
    paymentStatus: "pending",
    seatsReserved: 0,
    inventoryLockId: 51,
  });
  const person = {
    tenantId: 101,
    firstName: "Test",
    lastName: "Person",
    type: "adult",
  };
  await insert(passengers, {
    ...person,
    id: 100,
    bookingId: 10,
    firstName: "Alpha",
    ticketNumber: "1000000000100",
  });
  await insert(passengers, {
    ...person,
    id: 101,
    bookingId: 10,
    firstName: "Bravo",
    type: "child",
    ticketNumber: "1000000000101",
    passportNumber: "LEGACY101",
    dateOfBirth: "2020-02-03 00:00:00",
  });
  await insert(passengers, {
    ...person,
    id: 110,
    bookingId: 11,
    firstName: "Moved",
    ticketNumber: "1000000000110",
  });
  await insert(passengers, {
    ...person,
    id: 120,
    bookingId: 12,
    tenantId: 202,
    firstName: "OtherTenant",
    ticketNumber: "2000000000120",
  });
  await insert(passengers, {
    ...person,
    id: 130,
    bookingId: 13,
    tenantId: 202,
    firstName: "WrongBookingTenant",
    ticketNumber: "2000000000130",
  });
  await insert(passengers, {
    ...person,
    id: 140,
    bookingId: 14,
    firstName: "Offloaded",
    ticketNumber: "1000000000140",
  });
  await insert(passengers, {
    ...person,
    id: 150,
    bookingId: 15,
    tenantId: 202,
    firstName: "WrongPassengerTenant",
    ticketNumber: "2000000000150",
  });
  await insert(passengers, {
    ...person,
    id: 160,
    bookingId: 16,
    firstName: "Held",
  });
  await insert(passengers, {
    ...person,
    id: 170,
    bookingId: 17,
    firstName: "ExpiredHold",
  });
  await insert(bookingSegments, {
    id: 101,
    bookingId: 10,
    segmentOrder: 1,
    flightId: 1,
    departureDate: "2030-01-02 10:00:00",
    status: "confirmed",
    seatsReserved: 1,
  });
  await insert(bookingSegments, {
    id: 201,
    bookingId: 11,
    segmentOrder: 1,
    flightId: 1,
    departureDate: "2030-01-02 10:00:00",
    status: "cancelled",
    seatsReserved: 0,
  });
  await insert(bookingSegments, {
    id: 202,
    bookingId: 11,
    segmentOrder: 2,
    flightId: 2,
    departureDate: "2030-01-03 00:00:00",
    status: "completed",
    seatsReserved: 0,
  });
  const coupon = {
    couponNumber: 1,
    createdAt: "2029-12-20 12:05:00",
    updatedAt: "2029-12-20 12:05:00",
  };
  for (const row of [
    {
      id: 1,
      bookingId: 10,
      passengerId: 100,
      flightId: 1,
      ticketNumber: "1000000000100",
      status: "O",
    },
    {
      id: 2,
      bookingId: 10,
      passengerId: 101,
      flightId: 1,
      ticketNumber: "1000000000101",
      status: "C",
    },
    {
      id: 3,
      bookingId: 11,
      passengerId: 110,
      flightId: 1,
      ticketNumber: "1000000001110",
      status: "E",
    },
    {
      id: 4,
      bookingId: 11,
      passengerId: 110,
      flightId: 2,
      ticketNumber: "1000000000110",
      status: "F",
    },
    {
      id: 5,
      bookingId: 12,
      passengerId: 120,
      flightId: 3,
      ticketNumber: "2000000000120",
      status: "O",
    },
    {
      id: 6,
      bookingId: 14,
      passengerId: 140,
      flightId: 1,
      ticketNumber: "1000000000140",
      status: "O",
    },
    {
      id: 7,
      bookingId: 13,
      passengerId: 130,
      flightId: 1,
      ticketNumber: "2000000000130",
      status: "O",
    },
    {
      id: 8,
      bookingId: 15,
      passengerId: 150,
      flightId: 1,
      ticketNumber: "2000000000150",
      status: "O",
    },
    {
      id: 9,
      bookingId: 10,
      passengerId: 120,
      flightId: 1,
      ticketNumber: "2000000009999",
      status: "O",
    },
  ])
    await insert(ticketCoupons, { ...coupon, ...row });
  await insert(seatMaps, {
    id: 1,
    airlineId: 1,
    aircraftType: "A320",
    active: 1,
    totalSeats: 7,
    economySeats: 5,
    businessSeats: 2,
  });
  await insert(seatInventory, {
    id: 1,
    flightId: 1,
    seatMapId: 1,
    bookingId: 10,
    passengerId: 101,
    cabinClass: "economy",
    seatNumber: "12A",
    status: "checked_in",
    checkedInAt: "2030-01-02 08:00:00",
    checkInNonce: "synthetic-nonce",
    boardingSequence: 1,
  });
  await insert(dcsFlightOperations, {
    id: 1,
    flightId: 1,
    tenantId: 101,
    checkInState: "open",
  });
  await insert(dcsFlightOperations, {
    id: 2,
    flightId: 2,
    tenantId: 101,
    checkInState: "closed",
  });
  // A per-passenger state resolves the legacy booking-wide checkedIn flag.
  // Another passenger's check-in alone cannot establish this no-show candidate.
  await insert(dcsPassengerStates, {
    id: 4,
    bookingId: 10,
    passengerId: 100,
    flightId: 1,
    state: "not_checked_in",
    boardingDenied: 0,
  });
  await insert(dcsPassengerStates, {
    id: 1,
    bookingId: 10,
    passengerId: 101,
    flightId: 1,
    state: "checked_in",
    boardingDenied: 0,
  });
  await insert(dcsPassengerStates, {
    id: 2,
    bookingId: 11,
    passengerId: 110,
    flightId: 2,
    state: "boarded",
    boardingDenied: 0,
  });
  await insert(dcsPassengerStates, {
    id: 3,
    bookingId: 14,
    passengerId: 140,
    flightId: 1,
    state: "offloaded",
    boardingDenied: 0,
  });
  const bag = {
    bookingId: 10,
    passengerId: 100,
    flightId: 1,
    segmentId: 101,
    status: "checked_in",
  };
  await insert(baggageItems, {
    ...bag,
    id: 101,
    tagNumber: "BAGLOCAL001",
    weight: "10.50",
  });
  await insert(baggageItems, {
    ...bag,
    id: 102,
    tagNumber: "BAGRETURNED",
    weight: "4.25",
    returnEventId: 999,
  });
  await insert(baggageItems, {
    id: 103,
    bookingId: 11,
    passengerId: 110,
    flightId: 2,
    segmentId: 202,
    status: "checked_in",
    tagNumber: "BAGMOVED002",
    weight: "20.00",
  });
  await insert(baggageItems, {
    id: 104,
    bookingId: 10,
    passengerId: 101,
    tagNumber: "BAGLEGACY03",
    status: "checked_in",
    weight: "5.00",
  });
  await insert(apisData, {
    id: 1,
    passenger_id: 100,
    booking_id: 10,
    document_type: "passport",
    document_number: "SAFE100",
    issuing_country: "SAU",
    nationality: "SAU",
    date_of_birth: "1990-03-04",
    gender: "M",
    expiry_date: "2035-01-01",
    given_names: "ALPHA",
    surname: "PERSON",
    status: "validated",
    validated_at: "2029-12-20 12:10:00",
  });
  await insert(apisData, {
    id: 2,
    passenger_id: 101,
    booking_id: 12,
    document_type: "passport",
    document_number: "DO-NOT-LEAK",
    nationality: "OTH",
    date_of_birth: "1985-01-01",
    expiry_date: "2035-01-01",
    given_names: "FOREIGN",
    surname: "RECORD",
    status: "validated",
  });
  const hold = {
    flightId: 1,
    cabinClass: "economy",
    numberOfSeats: 3,
    status: "active",
    expiresAt: "2037-01-01 00:00:00",
  };
  await insert(inventoryLocks, { ...hold, id: 50, fareClassId: 1 });
  await insert(inventoryLocks, {
    ...hold,
    id: 51,
    expiresAt: "2000-01-01 00:00:00",
  });
  await insert(inventoryLocks, { ...hold, id: 52, status: "converted" });
  await insert(inventoryLocks, {
    ...hold,
    id: 53,
    cabinClass: "business",
    numberOfSeats: 1,
    fareClassId: 2,
  });
  await insert(inventoryLocks, {
    ...hold,
    id: 54,
    flightId: 3,
    numberOfSeats: 20,
  });
  await insert(inventoryLocks, { ...hold, id: 55, numberOfSeats: 2 });
  await insert(seatHolds, {
    id: 60,
    inventoryLockId: 50,
    flightId: 1,
    cabinClass: "economy",
    seats: 3,
    status: "active",
    expiresAt: "2037-01-01 00:00:00",
  });
  await insert(seatHolds, {
    id: 61,
    flightId: 1,
    cabinClass: "business",
    seats: 1,
    status: "active",
    expiresAt: "2037-01-01 00:00:00",
  });
  await insert(seatHolds, {
    id: 62,
    flightId: 1,
    cabinClass: "economy",
    seats: 99,
    status: "active",
    expiresAt: "2000-01-01 00:00:00",
  });
  await insert(fareClasses, {
    id: 1,
    airlineId: 1,
    code: "Y",
    cabinClass: "economy",
    active: 1,
  });
  await insert(fareClasses, {
    id: 2,
    airlineId: 1,
    code: "J",
    cabinClass: "business",
    active: 1,
  });
  await insert(fareClasses, {
    id: 3,
    airlineId: 2,
    code: "ZZ",
    cabinClass: "economy",
    active: 1,
  });
  await insert(flightFareClassInventory, {
    id: 1,
    flightId: 1,
    fareClassId: 1,
    capacity: 4,
    availableSeats: 2,
  });
  await insert(flightFareClassInventory, {
    id: 2,
    flightId: 1,
    fareClassId: 2,
    capacity: 2,
    availableSeats: 1,
  });
  await insert(flightFareClassInventory, {
    id: 3,
    flightId: 1,
    fareClassId: 3,
    capacity: 99,
    availableSeats: 99,
  });
  await insert(waitlist, {
    id: 1,
    flightId: 1,
    cabinClass: "economy",
    seats: 2,
    status: "waiting",
  });
  await insert(waitlist, {
    id: 2,
    flightId: 1,
    cabinClass: "economy",
    seats: 1,
    status: "offered",
  });
  await insert(operationalMessageRoutes, {
    id: 1,
    tenant_id: 101,
    station_code: "RUH",
    message_type: "PNL",
    origin_address: "RUHAISX",
    destination_address: "JEDAISX",
    transport_profile: "test-operator",
    enabled: 0,
  });
  await insert(operationalMessageTransmissions, {
    id: 1,
    tenant_id: 101,
    flight_id: 1,
    message_type: "PNL",
    direction: "outbound",
    status: "draft",
    message_digest: "a".repeat(64),
    created_at: "2030-01-01 12:00:00",
    attempt_count: 0,
  });
  await insert(operationalMessageTransmissions, {
    id: 2,
    tenant_id: 101,
    flight_id: 1,
    message_type: "PNL",
    direction: "outbound",
    status: "acknowledged",
    message_digest: "b".repeat(64),
    created_at: "2030-01-01 13:00:00",
    sent_at: "2030-01-01 13:01:00",
    acknowledged_at: "2030-01-01 13:02:00",
    acknowledgment_code: "ACK",
    attempt_count: 1,
  });
  await insert(operationalMessageTransmissions, {
    id: 3,
    tenant_id: 202,
    flight_id: 1,
    message_type: "PNL",
    direction: "outbound",
    status: "sent",
    message_digest: "c".repeat(64),
    created_at: "2030-01-01 13:00:00",
    attempt_count: 1,
  });
}
