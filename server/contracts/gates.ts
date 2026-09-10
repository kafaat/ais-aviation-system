// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber, structuredValue } from "./primitives";
export const responseContracts = {
  getFlightGate: z.union([
    z.null(),
    z.object({
      id: outputNumber,
      flightId: outputNumber,
      gateId: outputNumber,
      gateNumber: z.string(),
      terminal: z.union([z.null(), z.string()]),
      gateType: z.enum(["international", "domestic", "both"]),
      boardingStartTime: z.union([z.null(), z.date()]),
      boardingEndTime: z.union([z.null(), z.date()]),
      status: z.enum([
        "cancelled",
        "assigned",
        "boarding",
        "departed",
        "changed",
      ]),
      assignedAt: z.date(),
      previousGateId: z.union([z.null(), outputNumber]),
      changeReason: z.union([z.null(), z.string()]),
    }),
  ]),
  getAirportGates: z.array(
    z.object({
      amenities: structuredValue,
      id: outputNumber,
      airportId: outputNumber,
      gateNumber: z.string(),
      terminal: z.union([z.null(), z.string()]),
      type: z.enum(["international", "domestic", "both"]),
      status: z.enum(["available", "occupied", "maintenance"]),
      capacity: z.union([z.null(), z.string()]),
      createdAt: z.date(),
      updatedAt: z.date(),
    })
  ),
  getAvailableGates: z.array(
    z.object({
      amenities: structuredValue,
      id: outputNumber,
      airportId: outputNumber,
      gateNumber: z.string(),
      terminal: z.union([z.null(), z.string()]),
      type: z.enum(["international", "domestic", "both"]),
      status: z.enum(["available", "occupied", "maintenance"]),
      capacity: z.union([z.null(), z.string()]),
      createdAt: z.date(),
      updatedAt: z.date(),
    })
  ),
  assignGate: z.object({
    id: outputNumber,
    flightId: outputNumber,
    gateId: outputNumber,
    gateNumber: z.string(),
    terminal: z.union([z.null(), z.string()]),
  }),
  updateGateAssignment: z.object({
    id: outputNumber,
    flightId: outputNumber,
    newGateId: outputNumber,
    oldGateId: outputNumber,
    newGateNumber: z.string(),
    newTerminal: z.union([z.null(), z.string()]),
  }),
  releaseGate: z.union([
    z.object({ success: z.boolean(), message: z.string() }),
    z.object({ success: z.boolean(), message: z.undefined().optional() }),
  ]),
  getGateSchedule: z.object({
    airport: z.object({
      id: outputNumber,
      code: z.string(),
      name: z.string(),
      city: z.string(),
      country: z.string(),
      timezone: z.union([z.null(), z.string()]),
      createdAt: z.date(),
    }),
    date: z.date(),
    gates: z.array(
      z.object({
        amenities: structuredValue,
        assignments: z.array(
          z.object({
            id: outputNumber,
            gateId: outputNumber,
            flightId: outputNumber,
            flightNumber: z.string(),
            departureTime: z.date(),
            arrivalTime: z.date(),
            flightStatus: z.enum([
              "scheduled",
              "delayed",
              "cancelled",
              "completed",
            ]),
            boardingStartTime: z.union([z.null(), z.date()]),
            boardingEndTime: z.union([z.null(), z.date()]),
            assignmentStatus: z.enum([
              "cancelled",
              "assigned",
              "boarding",
              "departed",
              "changed",
            ]),
            assignedAt: z.date(),
          })
        ),
        id: outputNumber,
        airportId: outputNumber,
        gateNumber: z.string(),
        terminal: z.union([z.null(), z.string()]),
        type: z.enum(["international", "domestic", "both"]),
        status: z.enum(["available", "occupied", "maintenance"]),
        capacity: z.union([z.null(), z.string()]),
        createdAt: z.date(),
        updatedAt: z.date(),
      })
    ),
  }),
  createGate: z.object({ id: outputNumber, gateNumber: z.string() }),
  updateGateStatus: z.object({ success: z.boolean() }),
  deleteGate: z.object({ success: z.boolean() }),
  getStats: z.object({
    totalGates: outputNumber,
    availableGates: outputNumber,
    occupiedGates: outputNumber,
    maintenanceGates: outputNumber,
    todayAssignments: outputNumber,
    todayGateChanges: outputNumber,
  }),
  notifyGateChange: z.object({ notificationsSent: outputNumber }),
};
