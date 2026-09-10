// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getMembers: z.array(
    z.object({
      qualifiedAircraft: z.array(z.string()),
      id: outputNumber,
      employeeId: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      role: z.enum(["captain", "first_officer", "purser", "cabin_crew"]),
      airlineId: outputNumber,
      licenseNumber: z.union([z.null(), z.string()]),
      licenseExpiry: z.union([z.null(), z.date()]),
      medicalExpiry: z.union([z.null(), z.date()]),
      status: z.enum(["active", "inactive", "on_leave", "training"]),
      phone: z.union([z.null(), z.string()]),
      email: z.union([z.null(), z.string()]),
      createdAt: z.date(),
      updatedAt: z.date(),
    })
  ),
  getMember: z.object({
    qualifiedAircraft: z.array(z.string()),
    id: outputNumber,
    employeeId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    role: z.enum(["captain", "first_officer", "purser", "cabin_crew"]),
    airlineId: outputNumber,
    licenseNumber: z.union([z.null(), z.string()]),
    licenseExpiry: z.union([z.null(), z.date()]),
    medicalExpiry: z.union([z.null(), z.date()]),
    status: z.enum(["active", "inactive", "on_leave", "training"]),
    phone: z.union([z.null(), z.string()]),
    email: z.union([z.null(), z.string()]),
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
  assignToFlight: z.object({
    id: outputNumber,
    flightNumber: z.string(),
    crewName: z.string(),
    role: z.enum(["captain", "first_officer", "purser", "cabin_crew"]),
    ftlWarnings: z.array(z.string()),
  }),
  removeFromFlight: z.object({
    success: z.boolean(),
    assignmentId: outputNumber,
  }),
  getFlightCrew: z.object({
    flight: z.object({
      id: outputNumber,
      flightNumber: z.string(),
      departureTime: z.date(),
      arrivalTime: z.date(),
      aircraftType: z.union([z.null(), z.string()]),
      status: z.enum(["scheduled", "delayed", "cancelled", "completed"]),
    }),
    crew: z.object({
      total: outputNumber,
      cockpit: z.array(
        z.object({
          assignmentId: outputNumber,
          role: z.string(),
          assignmentStatus: z.string(),
          notes: z.union([z.null(), z.string()]),
          assignedAt: z.date(),
          crew: z.object({
            id: outputNumber,
            employeeId: z.string(),
            firstName: z.string(),
            lastName: z.string(),
            baseRole: z.string(),
            licenseNumber: z.union([z.null(), z.string()]),
            licenseExpiry: z.union([z.null(), z.date()]),
            medicalExpiry: z.union([z.null(), z.date()]),
            qualifiedAircraft: z.array(z.string()),
            status: z.string(),
            phone: z.union([z.null(), z.string()]),
            email: z.union([z.null(), z.string()]),
          }),
        })
      ),
      cabin: z.array(
        z.object({
          assignmentId: outputNumber,
          role: z.string(),
          assignmentStatus: z.string(),
          notes: z.union([z.null(), z.string()]),
          assignedAt: z.date(),
          crew: z.object({
            id: outputNumber,
            employeeId: z.string(),
            firstName: z.string(),
            lastName: z.string(),
            baseRole: z.string(),
            licenseNumber: z.union([z.null(), z.string()]),
            licenseExpiry: z.union([z.null(), z.date()]),
            medicalExpiry: z.union([z.null(), z.date()]),
            qualifiedAircraft: z.array(z.string()),
            status: z.string(),
            phone: z.union([z.null(), z.string()]),
            email: z.union([z.null(), z.string()]),
          }),
        })
      ),
      all: z.array(
        z.object({
          assignmentId: outputNumber,
          role: z.string(),
          assignmentStatus: z.string(),
          notes: z.union([z.null(), z.string()]),
          assignedAt: z.date(),
          crew: z.object({
            id: outputNumber,
            employeeId: z.string(),
            firstName: z.string(),
            lastName: z.string(),
            baseRole: z.string(),
            licenseNumber: z.union([z.null(), z.string()]),
            licenseExpiry: z.union([z.null(), z.date()]),
            medicalExpiry: z.union([z.null(), z.date()]),
            qualifiedAircraft: z.array(z.string()),
            status: z.string(),
            phone: z.union([z.null(), z.string()]),
            email: z.union([z.null(), z.string()]),
          }),
        })
      ),
    }),
  }),
  getSchedule: z.object({
    crewMember: z.object({
      id: outputNumber,
      employeeId: z.string(),
      name: z.string(),
      role: z.enum(["captain", "first_officer", "purser", "cabin_crew"]),
      status: z.enum(["active", "inactive", "on_leave", "training"]),
    }),
    dateRange: z.object({ startDate: z.string(), endDate: z.string() }),
    totalAssignments: outputNumber,
    schedule: z.array(
      z.object({
        date: z.string(),
        assignments: z.array(
          z.object({
            assignmentId: outputNumber,
            role: z.enum(["captain", "first_officer", "purser", "cabin_crew"]),
            assignmentStatus: z.enum([
              "confirmed",
              "assigned",
              "removed",
              "onboard",
            ]),
            notes: z.union([z.null(), z.string()]),
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
            aircraftType: z.union([z.null(), z.string()]),
            originId: outputNumber,
            destinationId: outputNumber,
          })
        ),
        totalDutyHours: outputNumber,
        ftlStatus: z.enum(["green", "yellow", "red"]),
      })
    ),
  }),
  checkAvailability: z.union([
    z.object({
      available: z.boolean(),
      reason: z.string(),
      crewMember: z.object({
        id: outputNumber,
        name: z.string(),
        status: z.enum(["inactive", "on_leave", "training"]),
      }),
      assignmentsOnDate: z.array(z.never()),
      dutyHoursOnDate: z.undefined().optional(),
      remainingDutyHours: z.undefined().optional(),
    }),
    z.object({
      available: z.boolean(),
      reason: z.string(),
      crewMember: z.object({
        id: outputNumber,
        name: z.string(),
        status: z.literal("active"),
      }),
      assignmentsOnDate: z.array(z.never()),
      dutyHoursOnDate: z.undefined().optional(),
      remainingDutyHours: z.undefined().optional(),
    }),
    z.object({
      available: z.boolean(),
      dutyHoursOnDate: outputNumber,
      remainingDutyHours: outputNumber,
      crewMember: z.object({
        id: outputNumber,
        name: z.string(),
        status: z.literal("active"),
      }),
      assignmentsOnDate: z.array(
        z.object({
          assignmentId: outputNumber,
          flightId: outputNumber,
          flightNumber: z.string(),
          role: z.enum(["captain", "first_officer", "purser", "cabin_crew"]),
          departureTime: z.date(),
          arrivalTime: z.date(),
        })
      ),
      reason: z.undefined().optional(),
    }),
  ]),
  checkFTL: z.object({
    crewMemberId: outputNumber,
    compliant: z.boolean(),
    totalDutyHours: outputNumber,
    maxDutyHours: outputNumber,
    proposedFlightDuration: outputNumber,
    violations: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  validateRequirements: z.object({
    flightId: outputNumber,
    meetsMinimum: z.boolean(),
    totalCrew: outputNumber,
    roleCounts: z.record(z.string(), outputNumber),
    requirements: z.object({
      captain: outputNumber,
      first_officer: outputNumber,
      purser: outputNumber,
      cabin_crew: outputNumber,
    }),
    issues: z.array(
      z.object({
        role: z.string(),
        required: outputNumber,
        assigned: outputNumber,
        severity: z.enum(["error", "warning"]),
        message: z.string(),
      })
    ),
    currentAssignments: z.array(
      z.object({
        id: outputNumber,
        role: z.enum(["captain", "first_officer", "purser", "cabin_crew"]),
        crewMemberId: outputNumber,
        name: z.string(),
      })
    ),
  }),
  findReplacement: z.object({
    flightId: outputNumber,
    flightNumber: z.string(),
    role: z.enum(["captain", "first_officer", "purser", "cabin_crew"]),
    candidates: z.array(
      z.object({
        crewMember: z.object({
          id: outputNumber,
          employeeId: z.string(),
          name: z.string(),
          role: z.string(),
          qualifiedAircraft: z.array(z.string()),
          licenseExpiry: z.union([z.null(), z.date()]),
          medicalExpiry: z.union([z.null(), z.date()]),
        }),
        available: z.boolean(),
        ftlCompliant: z.boolean(),
        dutyHoursOnDate: outputNumber,
        conflicts: z.array(z.string()),
        score: outputNumber,
      })
    ),
    availableCount: outputNumber,
    totalCandidates: outputNumber,
  }),
};
