/**
 * Flight Compare Context
 *
 * Manages flight comparison state with localStorage persistence.
 * Allows users to add/remove flights for comparison (2-4 flights).
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import type { FlightData } from "@/components/FlightCard";

// ============================================================================
// Types
// ============================================================================

export interface CompareContextValue {
  selectedFlights: FlightData[];
  addFlight: (flight: FlightData) => boolean;
  removeFlight: (flightId: number) => void;
  clearAll: () => void;
  isSelected: (flightId: number) => boolean;
  canAdd: boolean;
  maxFlights: number;
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = "ais_compare_flights";
const MAX_FLIGHTS = 4;
const MIN_FLIGHTS = 2;

// ============================================================================
// Context
// ============================================================================

const FlightCompareContext = createContext<CompareContextValue | null>(null);

// ============================================================================
// Storage Helpers
// ============================================================================

function getStoredFlights(): FlightData[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const flights = JSON.parse(stored);
      // Validate that it's an array and convert date strings back to Date objects
      if (Array.isArray(flights)) {
        return flights.map((f: FlightData) => ({
          ...f,
          departureTime: new Date(f.departureTime),
          arrivalTime: new Date(f.arrivalTime),
        }));
      }
    }
  } catch (error) {
    console.error("[FlightCompare] Failed to load stored flights:", error);
  }
  return [];
}

function storeFlights(flights: FlightData[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flights));
  } catch (error) {
    console.error("[FlightCompare] Failed to store flights:", error);
  }
}

function clearStoredFlights() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("[FlightCompare] Failed to clear stored flights:", error);
  }
}

// ============================================================================
// Provider
// ============================================================================

interface FlightCompareProviderProps {
  children: ReactNode;
}

export function FlightCompareProvider({
  children,
}: FlightCompareProviderProps) {
  const [selectedFlights, setSelectedFlights] = useState<FlightData[]>([]);

  // Initialize from localStorage
  useEffect(() => {
    const stored = getStoredFlights();
    if (stored.length > 0) {
      setSelectedFlights(stored);
    }
  }, []);

  // Persist to localStorage when selection changes
  useEffect(() => {
    if (selectedFlights.length > 0) {
      storeFlights(selectedFlights);
    } else {
      clearStoredFlights();
    }
  }, [selectedFlights]);

  const addFlight = useCallback((flight: FlightData): boolean => {
    let added = false;
    setSelectedFlights(prev => {
      // Check if already selected
      if (prev.some(f => f.id === flight.id)) {
        return prev;
      }
      // Check if max reached
      if (prev.length >= MAX_FLIGHTS) {
        return prev;
      }
      added = true;
      return [...prev, flight];
    });
    return added;
  }, []);

  const removeFlight = useCallback((flightId: number) => {
    setSelectedFlights(prev => prev.filter(f => f.id !== flightId));
  }, []);

  const clearAll = useCallback(() => {
    setSelectedFlights([]);
  }, []);

  const isSelected = useCallback(
    (flightId: number): boolean => {
      return selectedFlights.some(f => f.id === flightId);
    },
    [selectedFlights]
  );

  const canAdd = selectedFlights.length < MAX_FLIGHTS;

  const value: CompareContextValue = {
    selectedFlights,
    addFlight,
    removeFlight,
    clearAll,
    isSelected,
    canAdd,
    maxFlights: MAX_FLIGHTS,
  };

  return (
    <FlightCompareContext.Provider value={value}>
      {children}
    </FlightCompareContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useFlightCompare(): CompareContextValue {
  const context = useContext(FlightCompareContext);

  if (!context) {
    throw new Error(
      "useFlightCompare must be used within a FlightCompareProvider"
    );
  }

  return context;
}

// ============================================================================
// Utility Exports
// ============================================================================

export { MIN_FLIGHTS, MAX_FLIGHTS };
