// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";

const crewRole = z.enum(["captain", "first_officer", "purser", "cabin_crew"]);
const verdictKind = z.enum(["legal", "legal_with_extension", "illegal"]);
const assignmentPath = z.enum([
  "manual",
  "bulk_roster",
  "recovery_swap",
  "standby_activation",
  "preview",
]);
const sourceStatus = z.enum([
  "documented",
  "transcribed_unverified",
  "pending_official_text",
]);
const ruleCheck = z.object({
  code: z.string(),
  reference: z.string(),
  status: z.enum([
    "pass",
    "pass_with_extension",
    "fail",
    "advisory",
    "not_evaluable",
  ]),
  limit: z.union([z.null(), outputNumber]),
  actual: z.union([z.null(), outputNumber]),
  margin: z.union([z.null(), outputNumber]),
  unit: z.enum(["minutes", "count", "days"]),
  detail: z.string(),
});
const fatigue = z.object({
  score: outputNumber,
  level: z.enum(["low", "elevated", "high"]),
  factors: z.array(
    z.object({ code: z.string(), weight: outputNumber, detail: z.string() })
  ),
  woclEncroachmentMinutes: outputNumber,
  consecutiveEarlyStarts: outputNumber,
  consecutiveLateFinishes: outputNumber,
  disclaimer: z.string(),
});
const acclimatisation = z.object({
  state: z.enum(["B", "D", "X"]),
  referenceTimeZone: z.string(),
  localTimeZone: z.string(),
  timeDifferenceHours: outputNumber,
  elapsedHoursSinceReference: z.union([z.null(), outputNumber]),
  tableUsed: z.enum([
    "acclimatised",
    "unknown_acclimatisation",
    "unknown_acclimatisation_frm",
    "augmented_crew",
  ]),
  reportLocalMinutes: outputNumber,
});
const assignmentLegality = z.object({
  verdictId: outputNumber,
  verdict: verdictKind,
  ruleSet: z.object({ code: z.string(), version: z.string() }),
  overrideId: z.union([z.null(), outputNumber]),
  fatigueLevel: z.enum(["low", "elevated", "high"]),
});
const assignedCrew = z.object({
  id: outputNumber,
  flightNumber: z.string(),
  crewName: z.string(),
  role: crewRole,
  ftlWarnings: z.array(z.string()),
  legality: assignmentLegality,
});
const ruleSetSummary = z.object({
  id: outputNumber,
  airlineId: outputNumber,
  code: z.string(),
  version: z.string(),
  name: z.string(),
  jurisdiction: z.string(),
  sourceUrl: z.string(),
  sourceNotes: z.union([z.null(), z.string()]),
  valuesStatus: sourceStatus,
  approvalStatus: z.enum(["draft", "operator_confirmed", "retired"]),
  operatorConfirmed: z.boolean(),
  confirmedBy: z.union([z.null(), outputNumber]),
  confirmedAt: z.union([z.null(), z.date()]),
  confirmationNote: z.union([z.null(), z.string()]),
  active: z.boolean(),
  activatedAt: z.union([z.null(), z.date()]),
  allowsOverride: z.boolean(),
  effectiveFrom: z.date(),
  effectiveTo: z.union([z.null(), z.date()]),
  fdpRows: outputNumber,
  limitRows: outputNumber,
  pendingValues: outputNumber,
  unverifiedValues: outputNumber,
  readinessIssues: z.array(z.string()),
});
const standbyDuty = z.object({
  id: outputNumber,
  airlineId: outputNumber,
  tenantId: z.union([z.null(), outputNumber]),
  crewMemberId: outputNumber,
  kind: z.enum(["airport", "home"]),
  startsAt: z.date(),
  endsAt: z.date(),
  locationAirportId: z.union([z.null(), outputNumber]),
  status: z.enum(["planned", "activated", "released", "cancelled"]),
  activatedAssignmentId: z.union([z.null(), outputNumber]),
  activatedAt: z.union([z.null(), z.date()]),
  createdBy: outputNumber,
  createdAt: z.date(),
  updatedAt: z.date(),
  crewName: z.string(),
  employeeId: z.string(),
  role: crewRole,
});

export const legalityContracts = {
  listRuleSets: z.array(ruleSetSummary),
  importRuleSet: z.object({
    id: outputNumber,
    code: z.string(),
    version: z.string(),
    readinessIssues: z.array(z.string()),
  }),
  confirmRuleSet: z.object({
    id: outputNumber,
    approvalStatus: z.literal("operator_confirmed"),
  }),
  activateRuleSet: z.object({
    id: outputNumber,
    active: z.boolean(),
    deactivated: z.array(outputNumber),
  }),
  setRuleSetOverridePolicy: z.object({
    id: outputNumber,
    allowsOverride: z.boolean(),
  }),
  previewLegality: z.object({
    crewMemberId: outputNumber,
    crewName: z.string(),
    flightId: outputNumber,
    flightNumber: z.string(),
    reportAt: z.date(),
    releaseAt: z.date(),
    operatorProfile: z.object({
      compliant: z.boolean(),
      violations: z.array(z.string()),
    }),
    verdictId: outputNumber,
    ruleSetId: z.union([z.null(), outputNumber]),
    verdict: verdictKind,
    checks: z.array(ruleCheck),
    acclimatisation,
    fdpMinutes: outputNumber,
    extensionUsed: z.boolean(),
    fatigue,
    ruleSet: z.object({ code: z.string(), version: z.string() }),
    evaluatedAt: z.string(),
  }),
  listVerdicts: z.array(
    z.object({
      id: outputNumber,
      ruleSetId: z.union([z.null(), outputNumber]),
      crewMemberId: outputNumber,
      crewName: z.string(),
      employeeId: z.string(),
      flightId: z.union([z.null(), outputNumber]),
      flightNumber: z.union([z.null(), z.string()]),
      pairingId: z.union([z.null(), outputNumber]),
      standbyId: z.union([z.null(), outputNumber]),
      path: assignmentPath,
      verdict: verdictKind,
      blocked: z.boolean(),
      overrideId: z.union([z.null(), outputNumber]),
      checks: z.array(
        ruleCheck.partial({
          reference: true,
          limit: true,
          actual: true,
          margin: true,
          unit: true,
        })
      ),
      fatigue: fatigue.partial(),
      summary: z.record(z.string(), z.unknown()),
      actorId: z.union([z.null(), outputNumber]),
      createdAt: z.date(),
    })
  ),
  createOverride: z.object({ id: outputNumber }),
  listOverrides: z.array(
    z.object({
      id: outputNumber,
      airlineId: outputNumber,
      tenantId: z.union([z.null(), outputNumber]),
      crewMemberId: outputNumber,
      flightId: outputNumber,
      ruleCodes: z.array(z.string()),
      reason: z.string(),
      approvedBy: outputNumber,
      expiresAt: z.date(),
      status: z.enum(["active", "consumed", "revoked"]),
      consumedByAssignmentId: z.union([z.null(), outputNumber]),
      createdBy: outputNumber,
      createdAt: z.date(),
      updatedAt: z.date(),
    })
  ),
  assignRoster: z.object({
    total: outputNumber,
    assigned: outputNumber,
    blocked: outputNumber,
    lines: z.array(
      z.object({
        flightId: outputNumber,
        crewMemberId: outputNumber,
        role: crewRole,
        status: z.enum(["assigned", "blocked"]),
        assignmentId: z.union([z.null(), outputNumber]),
        verdict: z.union([z.null(), verdictKind]),
        verdictId: z.union([z.null(), outputNumber]),
        error: z.union([z.null(), z.string()]),
      })
    ),
  }),
  createPairing: z.object({
    id: outputNumber,
    code: z.string(),
    legs: outputNumber,
  }),
  listPairings: z.array(
    z.object({
      id: outputNumber,
      airlineId: outputNumber,
      tenantId: z.union([z.null(), outputNumber]),
      code: z.string(),
      homeBaseAirportId: z.union([z.null(), outputNumber]),
      startsAt: z.date(),
      endsAt: z.date(),
      legs: z.array(z.object({ flightId: outputNumber })),
      status: z.enum(["draft", "published"]),
      publishedAt: z.union([z.null(), z.date()]),
      createdBy: outputNumber,
      createdAt: z.date(),
      updatedAt: z.date(),
    })
  ),
  createStandby: z.object({ id: outputNumber }),
  listStandby: z.array(standbyDuty),
  activateStandby: assignedCrew.extend({ standbyId: outputNumber }),
};

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
  assignToFlight: assignedCrew,
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
        legality: z.object({
          verdict: verdictKind,
          failedRules: z.array(z.string()),
          fatigueLevel: z.union([
            z.null(),
            z.enum(["low", "elevated", "high"]),
          ]),
          fdpMarginMinutes: z.union([z.null(), outputNumber]),
        }),
        dutyHoursOnDate: outputNumber,
        conflicts: z.array(z.string()),
        score: outputNumber,
      })
    ),
    availableCount: outputNumber,
    totalCandidates: outputNumber,
  }),
  ...legalityContracts,
};
