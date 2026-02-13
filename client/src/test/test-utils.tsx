/**
 * Test Utilities
 *
 * This file provides helper functions and mock providers for testing
 * React components in the AIS Aviation System.
 */

import React, { ReactElement, ReactNode } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

// ============================================================================
// Mock Data
// ============================================================================

export const mockAirports = [
  {
    id: 1,
    code: "RUH",
    city: "Riyadh",
    name: "King Khalid International Airport",
  },
  {
    id: 2,
    code: "JED",
    city: "Jeddah",
    name: "King Abdulaziz International Airport",
  },
  {
    id: 3,
    code: "DMM",
    city: "Dammam",
    name: "King Fahd International Airport",
  },
];

export const mockFlight = {
  id: 1,
  flightNumber: "SV123",
  airline: {
    id: 1,
    name: "Saudi Airlines",
    code: "SV",
    logo: null,
  },
  origin: {
    id: 1,
    code: "RUH",
    city: "Riyadh",
    name: "King Khalid International Airport",
  },
  destination: {
    id: 2,
    code: "JED",
    city: "Jeddah",
    name: "King Abdulaziz International Airport",
  },
  departureTime: new Date("2026-02-10T10:00:00"),
  arrivalTime: new Date("2026-02-10T12:00:00"),
  economyPrice: 50000, // in cents
  businessPrice: 120000,
  economyAvailable: 50,
  businessAvailable: 10,
  status: "scheduled" as const,
};

export const mockFlights = [
  mockFlight,
  {
    ...mockFlight,
    id: 2,
    flightNumber: "SV456",
    departureTime: new Date("2026-02-10T14:00:00"),
    arrivalTime: new Date("2026-02-10T16:00:00"),
    economyPrice: 45000,
    businessPrice: 110000,
    economyAvailable: 30,
    businessAvailable: 5,
  },
  {
    ...mockFlight,
    id: 3,
    flightNumber: "SV789",
    departureTime: new Date("2026-02-10T18:00:00"),
    arrivalTime: new Date("2026-02-10T20:00:00"),
    economyPrice: 55000,
    businessPrice: 130000,
    economyAvailable: 0, // No economy seats
    businessAvailable: 8,
  },
];

export const mockUser = {
  id: 1,
  email: "test@example.com",
  name: "Test User",
  role: "user" as const,
  picture: null,
};

export const mockAdminUser = {
  ...mockUser,
  id: 2,
  email: "admin@example.com",
  name: "Admin User",
  role: "admin" as const,
};

export const mockUserPreferences = {
  preferredSeatType: "window" as const,
  preferredCabinClass: "economy" as const,
  mealPreference: "regular" as const,
  wheelchairAssistance: false,
  extraLegroom: false,
  passportNumber: "",
  passportExpiry: undefined,
  nationality: "",
  phoneNumber: "",
  emergencyContact: "",
  emergencyPhone: "",
  emailNotifications: true,
  smsNotifications: false,
};

export const mockBooking = {
  id: 1,
  bookingReference: "AIS12345",
  userId: 1,
  flightId: 1,
  status: "confirmed" as const,
  paymentStatus: "paid" as const,
  totalAmount: "500.00",
  currency: "SAR",
  cabinClass: "economy" as const,
  passengerCount: 1,
  passengers: [
    {
      id: 1,
      type: "adult" as const,
      title: "Mr",
      firstName: "John",
      lastName: "Doe",
      passportNumber: "A12345678",
      nationality: "SA",
    },
  ],
  flight: mockFlight,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ============================================================================
// Mock i18n
// ============================================================================

export const mockT = (key: string, options?: Record<string, unknown>) => {
  // Return the key or a formatted string for interpolation
  if (options && typeof options === "object") {
    let result = key;
    for (const [k, v] of Object.entries(options)) {
      result = result.replace(`{{${k}}}`, String(v));
    }
    return result;
  }
  return key;
};

export const mockI18n = {
  language: "en",
  changeLanguage: vi.fn(),
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: mockT,
    i18n: mockI18n,
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

// ============================================================================
// Mock tRPC
// ============================================================================

type MockQueryResult<T> = {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
};

type MockMutationResult = {
  mutate: ReturnType<typeof vi.fn>;
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
};

export const createMockTrpc = () => {
  const mockQuery = <T,>(data: T): MockQueryResult<T> => ({
    data,
    isLoading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue({ data }),
  });

  const mockLoadingQuery = <T,>(): MockQueryResult<T> => ({
    data: undefined,
    isLoading: true,
    error: null,
    refetch: vi.fn(),
  });

  const mockMutation = (): MockMutationResult => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    isSuccess: false,
    error: null,
  });

  return {
    mockQuery,
    mockLoadingQuery,
    mockMutation,
    flights: {
      search: { useQuery: vi.fn(() => mockQuery(mockFlights)) },
      getById: { useQuery: vi.fn(() => mockQuery(mockFlight)) },
    },
    reference: {
      airports: { useQuery: vi.fn(() => mockQuery(mockAirports)) },
    },
    auth: {
      me: { useQuery: vi.fn(() => mockQuery(mockUser)) },
      logoutCookie: { useMutation: vi.fn(() => mockMutation()) },
    },
    bookings: {
      create: { useMutation: vi.fn(() => mockMutation()) },
      getMyBookings: { useQuery: vi.fn(() => mockQuery([mockBooking])) },
    },
    payments: {
      create: { useMutation: vi.fn(() => mockMutation()) },
    },
    favorites: {
      getAll: { useQuery: vi.fn(() => mockQuery([])) },
      add: { useMutation: vi.fn(() => mockMutation()) },
      remove: { useMutation: vi.fn(() => mockMutation()) },
    },
    userPreferences: {
      getMyPreferences: {
        useQuery: vi.fn(() => mockQuery(mockUserPreferences)),
      },
      updateMyPreferences: { useMutation: vi.fn(() => mockMutation()) },
    },
    useUtils: vi.fn(() => ({
      auth: { me: { setData: vi.fn(), invalidate: vi.fn() } },
      userPreferences: { getMyPreferences: { invalidate: vi.fn() } },
    })),
  };
};

// ============================================================================
// Mock Auth Hook
// ============================================================================

export const createMockAuthHook = (
  user: typeof mockUser | null = mockUser
) => ({
  user,
  loading: false,
  error: null,
  isAuthenticated: !!user,
  logout: vi.fn(),
  refresh: vi.fn(),
});

// ============================================================================
// Mock Accessibility Context
// ============================================================================

export const mockAccessibility = {
  reducedMotion: false,
  highContrast: false,
  fontSize: "medium" as const,
  setReducedMotion: vi.fn(),
  setHighContrast: vi.fn(),
  setFontSize: vi.fn(),
};

// ============================================================================
// Test Providers
// ============================================================================

interface AllProvidersProps {
  children: ReactNode;
}

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

export const AllProviders = ({ children }: AllProvidersProps) => {
  const queryClient = createTestQueryClient();

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// ============================================================================
// Custom Render Function
// ============================================================================

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">
) => render(ui, { wrapper: AllProviders, ...options });

// Re-export everything from testing-library
export * from "@testing-library/react";
export { customRender as render };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Wait for a condition to be true
 */
export const waitForCondition = async (
  condition: () => boolean,
  timeout = 5000
): Promise<void> => {
  const startTime = Date.now();
  while (!condition() && Date.now() - startTime < timeout) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!condition()) {
    throw new Error("Condition not met within timeout");
  }
};

/**
 * Format price in SAR (for assertions)
 */
export const formatPrice = (priceInCents: number): string => {
  return (priceInCents / 100).toLocaleString("en-US");
};

/**
 * Create a mock event for testing
 */
export const createMockEvent = (overrides: Partial<Event> = {}) => ({
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  target: { value: "" },
  ...overrides,
});
