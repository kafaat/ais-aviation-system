/**
 * Role-Based Access Control (RBAC) Configuration
 * Defines roles, permissions, and access control rules
 */

/**
 * System roles with hierarchical permissions
 */
export const ROLES = {
  USER: "user",
  SUPPORT: "support",
  FINANCE: "finance",
  OPS: "ops",
  AIRLINE_ADMIN: "airline_admin",
  SUPER_ADMIN: "super_admin",
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

/**
 * Permission categories
 */
export const PERMISSIONS = {
  // Booking permissions
  BOOKING_READ_OWN: "booking:read:own",
  BOOKING_READ_ALL: "booking:read:all",
  BOOKING_CREATE: "booking:create",
  BOOKING_UPDATE_OWN: "booking:update:own",
  BOOKING_UPDATE_ALL: "booking:update:all",
  BOOKING_CANCEL_OWN: "booking:cancel:own",
  BOOKING_CANCEL_ALL: "booking:cancel:all",
  
  // Flight permissions
  FLIGHT_READ: "flight:read",
  FLIGHT_CREATE: "flight:create",
  FLIGHT_UPDATE: "flight:update",
  FLIGHT_DELETE: "flight:delete",
  FLIGHT_STATUS_UPDATE: "flight:status:update",
  
  // Payment permissions
  PAYMENT_PROCESS: "payment:process",
  PAYMENT_VIEW_OWN: "payment:view:own",
  PAYMENT_VIEW_ALL: "payment:view:all",
  REFUND_PROCESS: "refund:process",
  REFUND_APPROVE: "refund:approve",
  
  // User management
  USER_READ: "user:read",
  USER_UPDATE_OWN: "user:update:own",
  USER_UPDATE_ALL: "user:update:all",
  USER_DELETE: "user:delete",
  USER_ROLE_CHANGE: "user:role:change",
  
  // Admin permissions
  ADMIN_DASHBOARD: "admin:dashboard",
  AUDIT_LOG_READ: "audit:log:read",
  SYSTEM_CONFIG: "system:config",
  
  // Analytics
  ANALYTICS_READ: "analytics:read",
  REPORT_GENERATE: "report:generate",
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

/**
 * Role to permissions mapping
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Regular user - basic operations on own resources
  [ROLES.USER]: [
    PERMISSIONS.BOOKING_READ_OWN,
    PERMISSIONS.BOOKING_CREATE,
    PERMISSIONS.BOOKING_UPDATE_OWN,
    PERMISSIONS.BOOKING_CANCEL_OWN,
    PERMISSIONS.FLIGHT_READ,
    PERMISSIONS.PAYMENT_PROCESS,
    PERMISSIONS.PAYMENT_VIEW_OWN,
    PERMISSIONS.USER_UPDATE_OWN,
  ],
  
  // Support - view and modify customer bookings, no financial operations
  [ROLES.SUPPORT]: [
    PERMISSIONS.BOOKING_READ_OWN,
    PERMISSIONS.BOOKING_READ_ALL,
    PERMISSIONS.BOOKING_CREATE,
    PERMISSIONS.BOOKING_UPDATE_OWN,
    PERMISSIONS.BOOKING_UPDATE_ALL,
    PERMISSIONS.BOOKING_CANCEL_ALL,
    PERMISSIONS.FLIGHT_READ,
    PERMISSIONS.PAYMENT_VIEW_ALL,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE_OWN,
  ],
  
  // Finance - financial operations, reports, pricing
  [ROLES.FINANCE]: [
    PERMISSIONS.BOOKING_READ_OWN,
    PERMISSIONS.BOOKING_READ_ALL,
    PERMISSIONS.BOOKING_CREATE,
    PERMISSIONS.BOOKING_UPDATE_OWN,
    PERMISSIONS.FLIGHT_READ,
    PERMISSIONS.PAYMENT_PROCESS,
    PERMISSIONS.PAYMENT_VIEW_OWN,
    PERMISSIONS.PAYMENT_VIEW_ALL,
    PERMISSIONS.REFUND_PROCESS,
    PERMISSIONS.REFUND_APPROVE,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE_OWN,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.REPORT_GENERATE,
  ],
  
  // Operations - flight schedule management, operational changes
  [ROLES.OPS]: [
    PERMISSIONS.BOOKING_READ_OWN,
    PERMISSIONS.BOOKING_READ_ALL,
    PERMISSIONS.BOOKING_CREATE,
    PERMISSIONS.BOOKING_UPDATE_OWN,
    PERMISSIONS.BOOKING_UPDATE_ALL,
    PERMISSIONS.FLIGHT_READ,
    PERMISSIONS.FLIGHT_UPDATE,
    PERMISSIONS.FLIGHT_STATUS_UPDATE,
    PERMISSIONS.PAYMENT_VIEW_OWN,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE_OWN,
    PERMISSIONS.ANALYTICS_READ,
  ],
  
  // Airline Admin - manage flights, inventory, pricing
  [ROLES.AIRLINE_ADMIN]: [
    PERMISSIONS.BOOKING_READ_OWN,
    PERMISSIONS.BOOKING_READ_ALL,
    PERMISSIONS.BOOKING_CREATE,
    PERMISSIONS.BOOKING_UPDATE_OWN,
    PERMISSIONS.BOOKING_UPDATE_ALL,
    PERMISSIONS.BOOKING_CANCEL_ALL,
    PERMISSIONS.FLIGHT_READ,
    PERMISSIONS.FLIGHT_CREATE,
    PERMISSIONS.FLIGHT_UPDATE,
    PERMISSIONS.FLIGHT_DELETE,
    PERMISSIONS.FLIGHT_STATUS_UPDATE,
    PERMISSIONS.PAYMENT_PROCESS,
    PERMISSIONS.PAYMENT_VIEW_OWN,
    PERMISSIONS.PAYMENT_VIEW_ALL,
    PERMISSIONS.REFUND_PROCESS,
    PERMISSIONS.REFUND_APPROVE,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE_OWN,
    PERMISSIONS.USER_UPDATE_ALL,
    PERMISSIONS.ADMIN_DASHBOARD,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.REPORT_GENERATE,
    PERMISSIONS.AUDIT_LOG_READ,
  ],
  
  // Super Admin - full system access
  [ROLES.SUPER_ADMIN]: [
    PERMISSIONS.BOOKING_READ_OWN,
    PERMISSIONS.BOOKING_READ_ALL,
    PERMISSIONS.BOOKING_CREATE,
    PERMISSIONS.BOOKING_UPDATE_OWN,
    PERMISSIONS.BOOKING_UPDATE_ALL,
    PERMISSIONS.BOOKING_CANCEL_OWN,
    PERMISSIONS.BOOKING_CANCEL_ALL,
    PERMISSIONS.FLIGHT_READ,
    PERMISSIONS.FLIGHT_CREATE,
    PERMISSIONS.FLIGHT_UPDATE,
    PERMISSIONS.FLIGHT_DELETE,
    PERMISSIONS.FLIGHT_STATUS_UPDATE,
    PERMISSIONS.PAYMENT_PROCESS,
    PERMISSIONS.PAYMENT_VIEW_OWN,
    PERMISSIONS.PAYMENT_VIEW_ALL,
    PERMISSIONS.REFUND_PROCESS,
    PERMISSIONS.REFUND_APPROVE,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE_OWN,
    PERMISSIONS.USER_UPDATE_ALL,
    PERMISSIONS.USER_DELETE,
    PERMISSIONS.USER_ROLE_CHANGE,
    PERMISSIONS.ADMIN_DASHBOARD,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.REPORT_GENERATE,
    PERMISSIONS.AUDIT_LOG_READ,
    PERMISSIONS.SYSTEM_CONFIG,
  ],
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(permission);
}

/**
 * Check if user has any of the specified roles
 */
export function hasAnyRole(userRole: string, allowedRoles: Role[]): boolean {
  return allowedRoles.includes(userRole as Role);
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}
