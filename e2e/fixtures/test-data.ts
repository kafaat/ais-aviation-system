/**
 * Test Data and Fixtures for E2E Tests
 * Centralized test data to maintain consistency across tests
 */

// Test user credentials
export const testUsers = {
  regular: {
    email: "test.user@example.com",
    password: "TestPassword123!",
    firstName: "Test",
    lastName: "User",
    phone: "+966501234567",
  },
  admin: {
    email: "admin@ais-aviation.com",
    password: "AdminPassword123!",
    firstName: "Admin",
    lastName: "User",
    phone: "+966509876543",
  },
  newUser: {
    email: `new.user.${Date.now()}@example.com`,
    password: "NewUserPass123!",
    firstName: "New",
    lastName: "User",
    phone: "+966505551234",
  },
};

// Test passenger data
export const testPassengers = {
  adult1: {
    firstName: "Ahmad",
    firstNameAr: "أحمد",
    lastName: "Mohammad",
    lastNameAr: "محمد",
    passportNumber: "A12345678",
    dateOfBirth: "1990-01-15",
    nationality: "SA",
    gender: "male",
    email: "ahmad.mohammad@example.com",
    phone: "+966501111111",
  },
  adult2: {
    firstName: "Fatima",
    firstNameAr: "فاطمة",
    lastName: "Ali",
    lastNameAr: "علي",
    passportNumber: "B87654321",
    dateOfBirth: "1992-05-20",
    nationality: "SA",
    gender: "female",
    email: "fatima.ali@example.com",
    phone: "+966502222222",
  },
  child: {
    firstName: "Omar",
    firstNameAr: "عمر",
    lastName: "Mohammad",
    lastNameAr: "محمد",
    passportNumber: "C11223344",
    dateOfBirth: "2018-03-10",
    nationality: "SA",
    gender: "male",
  },
  infant: {
    firstName: "Sara",
    firstNameAr: "سارة",
    lastName: "Mohammad",
    lastNameAr: "محمد",
    passportNumber: "D44332211",
    dateOfBirth: "2023-08-15",
    nationality: "SA",
    gender: "female",
  },
};

// Test flight routes
export const testRoutes = {
  domestic: {
    origin: "الرياض", // Riyadh
    originCode: "RUH",
    destination: "جدة", // Jeddah
    destinationCode: "JED",
  },
  international: {
    origin: "الرياض",
    originCode: "RUH",
    destination: "دبي",
    destinationCode: "DXB",
  },
  longHaul: {
    origin: "جدة",
    originCode: "JED",
    destination: "لندن",
    destinationCode: "LHR",
  },
};

// Test payment data (Stripe test cards)
export const testPaymentCards = {
  valid: {
    number: "4242424242424242",
    expiry: "12/28",
    cvc: "123",
    name: "Test User",
    zip: "12345",
  },
  declined: {
    number: "4000000000000002",
    expiry: "12/28",
    cvc: "123",
    name: "Test User",
    zip: "12345",
  },
  insufficientFunds: {
    number: "4000000000009995",
    expiry: "12/28",
    cvc: "123",
    name: "Test User",
    zip: "12345",
  },
  requires3DS: {
    number: "4000002500003155",
    expiry: "12/28",
    cvc: "123",
    name: "Test User",
    zip: "12345",
  },
};

// Profile preferences
export const testPreferences = {
  travel: {
    preferredSeatType: "window",
    preferredCabinClass: "economy",
    mealPreference: "halal",
    wheelchairAssistance: false,
    extraLegroom: true,
  },
  notifications: {
    emailNotifications: true,
    smsNotifications: false,
  },
  personal: {
    passportNumber: "A12345678",
    nationality: "Saudi Arabia",
    emergencyContact: "Mohammad Ali",
    emergencyPhone: "+966509999999",
  },
};

// Admin test data
export const testFlightData = {
  newFlight: {
    flightNumber: "SV999",
    airline: "الخطوط السعودية",
    economySeats: "150",
    businessSeats: "30",
    economyPrice: "500.00",
    businessPrice: "1500.00",
  },
};

// Helper functions
export function getNextWeekDate(daysFromNow: number = 7): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date;
}

export function formatDateForInput(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function formatDateTimeForInput(date: Date): string {
  return date.toISOString().slice(0, 16);
}

// Booking reference pattern
export const BOOKING_REF_PATTERN = /^[A-Z0-9]{6}$/;

// API response patterns
export const API_PATTERNS = {
  requestId: /^[a-zA-Z0-9_-]{16}$/,
  bookingRef: BOOKING_REF_PATTERN,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
};
