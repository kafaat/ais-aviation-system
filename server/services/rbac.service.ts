import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";

// Define all available roles
export type UserRole =
  | "user"
  | "admin"
  | "super_admin"
  | "airline_admin"
  | "finance"
  | "ops"
  | "support";

// These grants mirror protected/admin/airline-scoped procedures. Operations
// and finance are separate authorities; neither inherits the other.
const ROLE_GRANTS: Record<UserRole, readonly UserRole[]> = {
  user: ["user"],
  support: ["user", "support"],
  ops: ["user", "ops"],
  finance: ["user", "finance"],
  airline_admin: ["user", "ops", "finance", "airline_admin"],
  admin: [
    "user",
    "support",
    "ops",
    "finance",
    "airline_admin",
    "admin",
    "super_admin",
  ],
  super_admin: [
    "user",
    "support",
    "ops",
    "finance",
    "airline_admin",
    "admin",
    "super_admin",
  ],
};
const TENANT_SCOPED_ROLES: readonly UserRole[] = [
  "ops",
  "finance",
  "airline_admin",
];

const customerCapabilities = [
  "Search flights",
  "Make bookings",
  "View own bookings",
  "Modify own bookings",
  "Cancel own bookings",
  "Download own tickets",
  "Check-in",
];
const operationsCapabilities = [
  "Update flight status",
  "Delay/cancel flights",
  "Modify flight schedules",
  "View operational reports",
];
const financeCapabilities = [
  "Process refunds",
  "View payment reports",
  "Access revenue analytics",
  "Export financial reports",
];
const airlineCapabilities = [
  ...operationsCapabilities,
  ...financeCapabilities,
  "Create/update flights",
  "Manage airline data",
  "Configure routes",
  "Set base pricing",
  "View airline analytics",
];
const platformCapabilities = [
  ...customerCapabilities,
  ...airlineCapabilities,
  "Manage airports",
  "Manage airlines",
  "Access all system data",
  "View system logs",
  "Configure system settings",
  "Manage user roles",
  "Access audit logs",
  "Modify security settings",
];

// Capabilities describe the role gates, not an override of resource ownership
// or tenant policy. Scoped staff still need a valid matching tenant context.
export const ROLE_DEFINITIONS: Record<
  UserRole,
  {
    name: string;
    description: string;
    capabilities: string[];
  }
> = {
  user: {
    name: "User",
    description: "Regular customer",
    capabilities: [...customerCapabilities],
  },
  support: {
    name: "Support Agent",
    description:
      "Customer support account with authenticated customer access; no staff authority",
    capabilities: [...customerCapabilities],
  },
  ops: {
    name: "Operations Staff",
    description: "Operations within the assigned airline tenant",
    capabilities: [...customerCapabilities, ...operationsCapabilities],
  },
  finance: {
    name: "Finance Team",
    description: "Financial operations within the assigned airline tenant",
    capabilities: [...customerCapabilities, ...financeCapabilities],
  },
  airline_admin: {
    name: "Airline Administrator",
    description: "Operations and finance within the assigned airline tenant",
    capabilities: [...customerCapabilities, ...airlineCapabilities],
  },
  admin: {
    name: "Administrator",
    description:
      "Platform administration, subject to resource ownership policies",
    capabilities: [...platformCapabilities],
  },
  super_admin: {
    name: "Super Administrator",
    description:
      "Platform administration, subject to resource ownership policies",
    capabilities: [...platformCapabilities],
  },
};

/** Role eligibility only; callers must also enforce tenant and resource policy. */
export function isAuthorized(
  userRole: UserRole,
  requiredRoles: UserRole[]
): boolean {
  if (!isValidRole(userRole)) return false;
  return (
    requiredRoles.length === 0 ||
    requiredRoles.some(role => ROLE_GRANTS[userRole].includes(role))
  );
}

export function hasCapability(userRole: UserRole, capability: string): boolean {
  return (
    isValidRole(userRole) &&
    ROLE_DEFINITIONS[userRole].capabilities.includes(capability)
  );
}

/**
 * RBAC Middleware factory for tRPC
 * Creates a middleware that checks if the user has one of the required roles
 */
export function createRBACMiddleware(requiredRoles: UserRole[]) {
  return ({
    ctx,
    next,
  }: {
    ctx: TrpcContext;
    next: (opts: { ctx: TrpcContext }) => unknown;
  }) => {
    // Ensure user is authenticated
    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    // Check role authorization
    if (!isAuthorized(ctx.user.role as UserRole, requiredRoles)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Access denied. Required roles: ${requiredRoles.join(", ")}. Your role: ${ctx.user.role}`,
      });
    }

    const grants = ROLE_GRANTS[ctx.user.role as UserRole];
    const matchedRoles = requiredRoles.filter(role => grants.includes(role));
    if (
      !isAdmin(ctx.user.role) &&
      matchedRoles.length > 0 &&
      matchedRoles.every(role => TENANT_SCOPED_ROLES.includes(role)) &&
      (ctx.user.tenantId == null || ctx.tenantId !== ctx.user.tenantId)
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Valid tenant context required",
      });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  };
}

/**
 * Platform administrators may cross tenant boundaries. Airline admins may not.
 */
export function isAdmin(userRole: string): boolean {
  const adminRoles: UserRole[] = ["admin", "super_admin"];
  return adminRoles.includes(userRole as UserRole);
}

/**
 * Legacy staff-account classification; this does not grant staff authority.
 */
export function isSupportOrHigher(userRole: string): boolean {
  const supportRoles: UserRole[] = [
    "support",
    "ops",
    "finance",
    "airline_admin",
    "admin",
    "super_admin",
  ];
  return supportRoles.includes(userRole as UserRole);
}

/**
 * Helper to check if user has financial access
 */
export function hasFinancialAccess(userRole: string): boolean {
  const financialRoles: UserRole[] = [
    "finance",
    "airline_admin",
    "admin",
    "super_admin",
  ];
  return financialRoles.includes(userRole as UserRole);
}

/**
 * Get role display name
 */
export function getRoleDisplayName(role: UserRole): string {
  return ROLE_DEFINITIONS[role]?.name || role;
}

/**
 * Get role capabilities
 */
export function getRoleCapabilities(role: UserRole): string[] {
  return ROLE_DEFINITIONS[role]?.capabilities || [];
}

/**
 * Get all roles
 */
export function getAllRoles(): UserRole[] {
  return Object.keys(ROLE_GRANTS) as UserRole[];
}

/**
 * Check if role exists
 */
export function isValidRole(role: string): role is UserRole {
  return Object.hasOwn(ROLE_GRANTS, role);
}
