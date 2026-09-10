import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

export type FlightStatusType =
  | "scheduled"
  | "boarding"
  | "departed"
  | "delayed"
  | "cancelled"
  | "landed";

export interface FlightStatusData {
  flightId: number;
  status: FlightStatusType;
  delayMinutes?: number;
  gate?: string;
  estimatedDeparture?: string;
  estimatedArrival?: string;
  lastUpdated: Date;
}

export interface UseFlightStatusOptions {
  flightIds: number[];
  enabled?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export interface UseFlightStatusReturn {
  statuses: Map<number, FlightStatusData>;
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;
  reconnect: () => void;
}

/** Poll the deployed API; updated timestamps come from persisted flight records. */
export function useFlightStatus(
  options: UseFlightStatusOptions
): UseFlightStatusReturn {
  const ids = [...new Set(options.flightIds)]
    .sort((a, b) => a - b)
    .slice(0, 50);
  const enabled = (options.enabled ?? true) && ids.length > 0;
  const query = trpc.flights.statusBatch.useQuery(
    { ids },
    {
      enabled,
      refetchInterval: Math.max(5000, options.reconnectInterval ?? 10000),
      refetchIntervalInBackground: false,
      retry: options.maxReconnectAttempts ?? 2,
    }
  );
  const statuses = useMemo(
    () =>
      new Map(
        (query.data ?? []).map(row => [
          row.flightId,
          {
            flightId: row.flightId,
            status:
              row.status === "completed" ? ("landed" as const) : row.status,
            lastUpdated: row.lastUpdated,
          },
        ])
      ),
    [query.data]
  );
  return {
    statuses,
    isConnected: enabled && query.isSuccess && !query.isError,
    isConnecting: enabled && query.isFetching,
    error: query.error ? new Error(query.error.message) : null,
    reconnect: () => {
      if (enabled) void query.refetch();
    },
  };
}

/**
 * Hook to get status for a single flight
 */
export function useSingleFlightStatus(
  flightId: number | undefined,
  enabled = true
) {
  const flightIds = flightId ? [flightId] : [];
  const result = useFlightStatus({
    flightIds,
    enabled: enabled && !!flightId,
  });

  return {
    status: flightId ? result.statuses.get(flightId) : undefined,
    isConnected: result.isConnected,
    isConnecting: result.isConnecting,
    error: result.error,
    reconnect: result.reconnect,
  };
}
