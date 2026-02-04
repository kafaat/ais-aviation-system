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

// Define role hierarchies (higher roles inherit lower role permissions)
const ROLE_HIERARCHY: Record<UserRole, number> = {
  user: 1,
  support: 2,
  ops: 3,
  finance: 4,
  airline_admin: 5,
  admin: 6,
  super_admin: 7,
};

// Define role descriptions and capabilities
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
    capabilities: [
      "Search flights",
      "Make bookings",
      "View own bookings",
      "Modify own bookings",
      "Cancel own bookings",
      "Download tickets",
      "Check-in",
    ],
  },
  support: {
    name: "Support Agent",
    description: "Customer support representative",
    capabilities: [
      "All user capabilities",
      "View all bookings",
      "Modify bookings on behalf of customers",
      "Process refunds",
      "Access customer information",
    ],
  },
  ops: {
    name: "Operations Staff",
    description: "Operations and scheduling team",
    capabilities: [
      "All support capabilities",
      "Update flight status",
      "Delay/cancel flights",
      "Modify flight schedules",
      "View operational reports",
    ],
  },
  finance: {
    name: "Finance Team",
    description: "Financial operations team",
    capabilities: [
      "View all financial data",
      "Process refunds",
      "View payment reports",
      "Update pricing",
      "Access revenue analytics",
      "Export financial reports",
    ],
  },
  airline_admin: {
    name: "Airline Administrator",
    description: "Airline management team",
    capabilities: [
      "All ops capabilities",
      "Create/update flights",
      "Manage airline data",
      "Configure routes",
      "Set base pricing",
      "View airline analytics",
    ],
  },
  admin: {
    name: "Administrator",
    description: "System administrator",
    capabilities: [
      "All airline_admin capabilities",
      "Manage airports",
      "Manage airlines",
      "Access all system data",
      "View system logs",
      "Configure system settings",
    ],
  },
  super_admin: {
    name: "Super Administrator",
    description: "Full system access",
    capabilities: [
      "All admin capabilities",
      "Manage user roles",
      "Access audit logs",
      "Modify security settings",
      "Delete data",
      "Full system control",
    ],
  },
};

/**
 * Check if a role is authorized for required roles
 * @param userRole - The user's current role
 * @param requiredRoles - Array of roles that are allowed
 * @returns true if authorized, false otherwise
 */
export function isAuthorized(
  userRole: UserRole,
  requiredRoles: UserRole[]
): boolean {
  if (requiredRoles.length === 0) {
    return true; // No specific role required
  }

  // Check if user's role is in the required roles
  if (requiredRoles.includes(userRole)) {
    return true;
  }

  // Check if user's role is higher in hierarchy than any required role
  const userRoleLevel = ROLE_HIERARCHY[userRole];
  const requiredLevel = Math.min(
    ...requiredRoles.map(role => ROLE_HIERARCHY[role])
  );

  // Super admin can access everything
  if (userRole === "super_admin") {
    return true;
  }

  return userRoleLevel >= requiredLevel;
}

/**
 * Check if a role has a specific capability
 */
export function hasCapability(userRole: UserRole, capability: string): boolean {
  const roleDef = ROLE_DEFINITIONS[userRole];
  if (!roleDef) {
    return false;
  }

  // Check direct capabilities
  if (roleDef.capabilities.includes(capability)) {
    return true;
  }

  // Check inherited capabilities from lower roles
  const userLevel = ROLE_HIERARCHY[userRole];
  for (const [role, level] of Object.entries(ROLE_HIERARCHY)) {
    if (level < userLevel) {
      const lowerRoleDef = ROLE_DEFINITIONS[role as UserRole];
      if (lowerRoleDef.capabilities.includes(capability)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * RBAC Middleware factory for tRPC
 * Creates a middleware that checks if the user has one of the required roles
 */
export function createRBACMiddleware(requiredRoles: UserRole[]) {
  return async ({ ctx, next }: { ctx: TrpcContext; next: any }) => {
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

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  };
}

/**
 * Helper to check if user is admin (any admin role)
 */
export function isAdmin(userRole: string): boolean {
  const adminRoles: UserRole[] = ["admin", "super_admin", "airline_admin"];
  return adminRoles.includes(userRole as UserRole);
}

/**
 * Helper to check if user is support or higher
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
  const financialRoles: UserRole[] = ["finance", "admin", "super_admin"];
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
  return Object.keys(ROLE_HIERARCHY) as UserRole[];
}

/**
 * Check if role exists
 */
export function isValidRole(role: string): role is UserRole {
  return role in ROLE_HIERARCHY;
}
