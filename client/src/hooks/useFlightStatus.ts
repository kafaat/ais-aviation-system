import { useState, useEffect, useCallback, useRef } from "react";

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

/**
 * Custom hook for real-time flight status updates via WebSocket
 */
export function useFlightStatus(
  options: UseFlightStatusOptions
): UseFlightStatusReturn {
  const {
    flightIds,
    enabled = true,
    reconnectInterval = 5000,
    maxReconnectAttempts = 5,
  } = options;

  const [statuses, setStatuses] = useState<Map<number, FlightStatusData>>(
    new Map()
  );
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const subscribedFlightsRef = useRef<Set<number>>(new Set());

  // Get WebSocket URL based on current environment
  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    return `${protocol}//${host}/ws/flight-status`;
  }, []);

  // Subscribe to flight updates
  const subscribeToFlights = useCallback((ws: WebSocket, ids: number[]) => {
    if (ws.readyState === WebSocket.OPEN && ids.length > 0) {
      ws.send(
        JSON.stringify({
          type: "subscribe",
          flightIds: ids,
        })
      );
      ids.forEach(id => subscribedFlightsRef.current.add(id));
    }
  }, []);

  // Unsubscribe from flight updates
  const unsubscribeFromFlights = useCallback((ws: WebSocket, ids: number[]) => {
    if (ws.readyState === WebSocket.OPEN && ids.length > 0) {
      ws.send(
        JSON.stringify({
          type: "unsubscribe",
          flightIds: ids,
        })
      );
      ids.forEach(id => subscribedFlightsRef.current.delete(id));
    }
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "status_update" && data.payload) {
        const statusUpdate: FlightStatusData = {
          flightId: data.payload.flightId,
          status: data.payload.status,
          delayMinutes: data.payload.delayMinutes,
          gate: data.payload.gate,
          estimatedDeparture: data.payload.estimatedDeparture,
          estimatedArrival: data.payload.estimatedArrival,
          lastUpdated: new Date(data.payload.lastUpdated || Date.now()),
        };

        setStatuses(prev => {
          const newMap = new Map(prev);
          newMap.set(statusUpdate.flightId, statusUpdate);
          return newMap;
        });
      } else if (data.type === "initial_status" && data.payload) {
        // Handle initial status batch
        const updates = Array.isArray(data.payload)
          ? data.payload
          : [data.payload];
        setStatuses(prev => {
          const newMap = new Map(prev);
          updates.forEach(
            (update: {
              flightId: number;
              status: FlightStatusType;
              delayMinutes?: number;
              gate?: string;
              estimatedDeparture?: string;
              estimatedArrival?: string;
              lastUpdated?: string;
            }) => {
              newMap.set(update.flightId, {
                ...update,
                lastUpdated: new Date(update.lastUpdated || Date.now()),
              });
            }
          );
          return newMap;
        });
      } else if (data.type === "error") {
        console.error("[WebSocket] Server error:", data.message);
        setError(new Error(data.message));
      }
    } catch (err) {
      console.error("[WebSocket] Failed to parse message:", err);
    }
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!enabled || flightIds.length === 0) return;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const ws = new WebSocket(getWebSocketUrl());

      ws.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        setError(null);
        reconnectAttemptsRef.current = 0;

        // Subscribe to requested flights
        subscribeToFlights(ws, flightIds);
      };

      ws.onmessage = handleMessage;

      ws.onerror = event => {
        console.error("[WebSocket] Error:", event);
        setError(new Error("WebSocket connection error"));
      };

      ws.onclose = event => {
        setIsConnected(false);
        setIsConnecting(false);
        subscribedFlightsRef.current.clear();

        // Attempt reconnection if not a clean close
        if (
          event.code !== 1000 &&
          enabled &&
          reconnectAttemptsRef.current < maxReconnectAttempts
        ) {
          reconnectAttemptsRef.current += 1;
          const delay =
            reconnectInterval * Math.pow(2, reconnectAttemptsRef.current - 1);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      setIsConnecting(false);
      setError(err instanceof Error ? err : new Error("Connection failed"));
    }
  }, [
    enabled,
    flightIds,
    getWebSocketUrl,
    handleMessage,
    subscribeToFlights,
    reconnectInterval,
    maxReconnectAttempts,
  ]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  // Initial connection and cleanup
  useEffect(() => {
    if (enabled && flightIds.length > 0) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounted");
        wsRef.current = null;
      }
    };
  }, [enabled, connect, flightIds.length]);

  // Handle flight ID changes (subscribe/unsubscribe)
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const currentFlights = new Set(flightIds);
    const subscribedFlights = subscribedFlightsRef.current;

    // Find flights to subscribe to
    const toSubscribe = flightIds.filter(id => !subscribedFlights.has(id));

    // Find flights to unsubscribe from
    const toUnsubscribe = Array.from(subscribedFlights).filter(
      id => !currentFlights.has(id)
    );

    if (toSubscribe.length > 0) {
      subscribeToFlights(ws, toSubscribe);
    }

    if (toUnsubscribe.length > 0) {
      unsubscribeFromFlights(ws, toUnsubscribe);
    }
  }, [flightIds, subscribeToFlights, unsubscribeFromFlights]);

  return {
    statuses,
    isConnected,
    isConnecting,
    error,
    reconnect,
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
