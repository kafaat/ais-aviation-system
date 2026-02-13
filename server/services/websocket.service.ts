// Note: ws module is optional - WebSocket functionality will be disabled if not installed
let WebSocketServer: any;
let _WebSocket: any;

try {
  const ws = require("ws");
  WebSocketServer = ws.WebSocketServer;
  _WebSocket = ws.WebSocket;
} catch {
  console.info(
    "[WebSocket] ws module not installed - WebSocket server disabled"
  );
}

import type { Server } from "http";
import { getDb } from "../db";
import { flights } from "../../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

/**
 * Flight Status Types for WebSocket communication
 */
export type FlightStatusType =
  | "scheduled"
  | "boarding"
  | "departed"
  | "delayed"
  | "cancelled"
  | "landed";

export interface FlightStatusMessage {
  type: "status_update" | "initial_status" | "error" | "subscribed";
  payload?: FlightStatusPayload | FlightStatusPayload[];
  message?: string;
}

export interface FlightStatusPayload {
  flightId: number;
  status: FlightStatusType;
  delayMinutes?: number;
  gate?: string;
  estimatedDeparture?: string;
  estimatedArrival?: string;
  lastUpdated: string;
}

interface ClientSubscription {
  ws: any; // WebSocket type when ws module is available
  flightIds: Set<number>;
}

/**
 * WebSocket Service for real-time flight status updates
 */
class WebSocketService {
  private wss: any = null; // WebSocketServer when ws module is available
  private clients: Map<any, ClientSubscription> = new Map(); // Map of WebSocket to ClientSubscription
  private flightStatuses: Map<number, FlightStatusPayload> = new Map();
  private simulationInterval: ReturnType<typeof setInterval> | null = null;
  private isInitialized = false;

  /**
   * Initialize WebSocket server
   */
  initialize(server: Server): void {
    if (this.isInitialized) {
      console.warn("[WebSocket] Already initialized");
      return;
    }

    this.wss = new WebSocketServer({
      server,
      path: "/ws/flight-status",
    });

    this.wss.on("connection", (ws: any) => {
      console.info("[WebSocket] Client connected");

      // Initialize client subscription
      this.clients.set(ws, {
        ws,
        flightIds: new Set(),
      });

      // Handle incoming messages
      ws.on("message", async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleClientMessage(ws, message);
        } catch (error) {
          console.error("[WebSocket] Error parsing message:", error);
          this.sendToClient(ws, {
            type: "error",
            message: "Invalid message format",
          });
        }
      });

      // Handle client disconnect
      ws.on("close", () => {
        console.info("[WebSocket] Client disconnected");
        this.clients.delete(ws);
      });

      // Handle errors
      ws.on("error", (error: Error) => {
        console.error("[WebSocket] Client error:", error);
        this.clients.delete(ws);
      });
    });

    // Start flight status simulation for demo purposes
    this.startFlightStatusSimulation();

    this.isInitialized = true;
    console.info("[WebSocket] Server initialized on /ws/flight-status");
  }

  /**
   * Handle incoming client messages
   */
  private async handleClientMessage(
    ws: any,
    message: { type: string; flightIds?: number[] }
  ): Promise<void> {
    const client = this.clients.get(ws);
    if (!client) return;

    switch (message.type) {
      case "subscribe":
        if (message.flightIds && Array.isArray(message.flightIds)) {
          message.flightIds.forEach(id => client.flightIds.add(id));

          // Send initial status for subscribed flights
          const initialStatuses = await this.getFlightStatuses(
            message.flightIds
          );
          this.sendToClient(ws, {
            type: "initial_status",
            payload: initialStatuses,
          });

          this.sendToClient(ws, {
            type: "subscribed",
            message: `Subscribed to ${message.flightIds.length} flight(s)`,
          });
        }
        break;

      case "unsubscribe":
        if (message.flightIds && Array.isArray(message.flightIds)) {
          message.flightIds.forEach(id => client.flightIds.delete(id));
        }
        break;

      default:
        this.sendToClient(ws, {
          type: "error",
          message: `Unknown message type: ${message.type}`,
        });
    }
  }

  /**
   * Get current flight statuses from database or cache
   */
  private async getFlightStatuses(
    flightIds: number[]
  ): Promise<FlightStatusPayload[]> {
    const statuses: FlightStatusPayload[] = [];

    // First check cache
    for (const id of flightIds) {
      const cached = this.flightStatuses.get(id);
      if (cached) {
        statuses.push(cached);
      }
    }

    // Get remaining from database
    const uncachedIds = flightIds.filter(id => !this.flightStatuses.has(id));

    if (uncachedIds.length > 0) {
      try {
        const db = await getDb();
        if (db) {
          const dbFlights = await db
            .select({
              id: flights.id,
              status: flights.status,
              departureTime: flights.departureTime,
              arrivalTime: flights.arrivalTime,
            })
            .from(flights)
            .where(inArray(flights.id, uncachedIds));

          for (const flight of dbFlights) {
            const statusPayload: FlightStatusPayload = {
              flightId: flight.id,
              status: (flight.status as FlightStatusType) || "scheduled",
              lastUpdated: new Date().toISOString(),
              estimatedDeparture: flight.departureTime?.toISOString(),
              estimatedArrival: flight.arrivalTime?.toISOString(),
            };

            this.flightStatuses.set(flight.id, statusPayload);
            statuses.push(statusPayload);
          }
        }
      } catch (error) {
        console.error("[WebSocket] Error fetching flight statuses:", error);
      }
    }

    return statuses;
  }

  /**
   * Send message to a specific client
   */
  private sendToClient(ws: any, message: FlightStatusMessage): void {
    if (ws.readyState === 1) {
      // WebSocket.OPEN = 1
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast status update to all subscribed clients
   */
  broadcastStatusUpdate(flightId: number, status: FlightStatusPayload): void {
    // Update cache
    this.flightStatuses.set(flightId, status);

    // Broadcast to subscribed clients
    for (const [_ws, client] of this.clients) {
      if (client.flightIds.has(flightId)) {
        this.sendToClient(client.ws, {
          type: "status_update",
          payload: status,
        });
      }
    }
  }

  /**
   * Update flight status programmatically (for external updates)
   */
  async updateFlightStatus(
    flightId: number,
    status: FlightStatusType,
    options?: {
      delayMinutes?: number;
      gate?: string;
      estimatedDeparture?: string;
      estimatedArrival?: string;
    }
  ): Promise<void> {
    const statusPayload: FlightStatusPayload = {
      flightId,
      status,
      delayMinutes: options?.delayMinutes,
      gate: options?.gate,
      estimatedDeparture: options?.estimatedDeparture,
      estimatedArrival: options?.estimatedArrival,
      lastUpdated: new Date().toISOString(),
    };

    this.broadcastStatusUpdate(flightId, statusPayload);

    // Update database (only for database-compatible statuses)
    try {
      const db = await getDb();
      if (db) {
        // Map WebSocket status to database status enum
        const dbStatus = (
          ["scheduled", "delayed", "cancelled", "completed"].includes(status)
            ? status
            : status === "departed" || status === "boarding"
              ? "scheduled"
              : status === "landed"
                ? "completed"
                : "scheduled"
        ) as "scheduled" | "delayed" | "cancelled" | "completed";

        await db
          .update(flights)
          .set({ status: dbStatus, updatedAt: new Date() })
          .where(eq(flights.id, flightId));
      }
    } catch (error) {
      console.error("[WebSocket] Error updating flight status in DB:", error);
    }
  }

  /**
   * Start flight status simulation for demo/testing purposes
   * This simulates random status changes for active flights
   */
  private startFlightStatusSimulation(): void {
    // Simulate status changes every 30 seconds
    this.simulationInterval = setInterval(() => {
      // Only simulate if there are subscribed clients
      if (this.clients.size === 0) return;

      // Get all subscribed flight IDs
      const allFlightIds = new Set<number>();
      for (const client of this.clients.values()) {
        client.flightIds.forEach(id => allFlightIds.add(id));
      }

      if (allFlightIds.size === 0) return;

      // Randomly select a flight to update (10% chance per interval)
      const flightIdsArray = Array.from(allFlightIds);
      for (const flightId of flightIdsArray) {
        if (Math.random() < 0.1) {
          // 10% chance
          const currentStatus = this.flightStatuses.get(flightId);
          const newStatus = this.getNextSimulatedStatus(currentStatus?.status);

          if (newStatus && newStatus !== currentStatus?.status) {
            const statusPayload: FlightStatusPayload = {
              flightId,
              status: newStatus,
              delayMinutes:
                newStatus === "delayed"
                  ? Math.floor(Math.random() * 60) + 15
                  : undefined,
              gate:
                newStatus === "boarding"
                  ? `${String.fromCharCode(65 + Math.floor(Math.random() * 6))}${Math.floor(Math.random() * 20) + 1}`
                  : currentStatus?.gate,
              lastUpdated: new Date().toISOString(),
            };

            console.info(
              `[WebSocket] Simulating status change for flight ${flightId}: ${currentStatus?.status || "unknown"} -> ${newStatus}`
            );

            this.broadcastStatusUpdate(flightId, statusPayload);
          }
        }
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Get next simulated status based on current status
   */
  private getNextSimulatedStatus(
    currentStatus?: FlightStatusType
  ): FlightStatusType | null {
    const statusProgression: Record<FlightStatusType, FlightStatusType[]> = {
      scheduled: ["boarding", "delayed"],
      boarding: ["departed"],
      departed: ["landed"],
      delayed: ["boarding", "cancelled"],
      cancelled: [],
      landed: [],
    };

    const possibleNext = statusProgression[currentStatus || "scheduled"];
    if (possibleNext.length === 0) return null;

    return possibleNext[Math.floor(Math.random() * possibleNext.length)];
  }

  /**
   * Stop the simulation
   */
  stopSimulation(): void {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
  }

  /**
   * Get current client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Graceful shutdown
   */
  shutdown(): void {
    this.stopSimulation();

    // Close all client connections
    for (const client of this.clients.values()) {
      client.ws.close(1000, "Server shutting down");
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this.isInitialized = false;
    console.info("[WebSocket] Server shut down");
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();

// Export for use in other services
export { WebSocketService };
