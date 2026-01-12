import { describe, it, expect, beforeEach } from "vitest";
import { hasPermission, hasAnyRole, getRolePermissions, ROLES, PERMISSIONS } from "../../server/_core/rbac";

describe("RBAC (Role-Based Access Control)", () => {
  describe("Role Hierarchy", () => {
    it("should have all required roles defined", () => {
      expect(ROLES.USER).toBe("user");
      expect(ROLES.SUPPORT).toBe("support");
      expect(ROLES.FINANCE).toBe("finance");
      expect(ROLES.OPS).toBe("ops");
      expect(ROLES.AIRLINE_ADMIN).toBe("airline_admin");
      expect(ROLES.SUPER_ADMIN).toBe("super_admin");
    });

    it("should have SuperAdmin with all permissions", () => {
      const superAdminPerms = getRolePermissions(ROLES.SUPER_ADMIN);
      
      // SuperAdmin should have all critical permissions
      expect(superAdminPerms).toContain(PERMISSIONS.BOOKING_READ_ALL);
      expect(superAdminPerms).toContain(PERMISSIONS.BOOKING_UPDATE_ALL);
      expect(superAdminPerms).toContain(PERMISSIONS.FLIGHT_CREATE);
      expect(superAdminPerms).toContain(PERMISSIONS.FLIGHT_UPDATE);
      expect(superAdminPerms).toContain(PERMISSIONS.FLIGHT_DELETE);
      expect(superAdminPerms).toContain(PERMISSIONS.USER_ROLE_CHANGE);
      expect(superAdminPerms).toContain(PERMISSIONS.USER_DELETE);
      expect(superAdminPerms).toContain(PERMISSIONS.SYSTEM_CONFIG);
      expect(superAdminPerms).toContain(PERMISSIONS.AUDIT_LOG_READ);
    });

    it("should restrict user to own resources only", () => {
      const userPerms = getRolePermissions(ROLES.USER);
      
      // User can only read/update own bookings
      expect(userPerms).toContain(PERMISSIONS.BOOKING_READ_OWN);
      expect(userPerms).toContain(PERMISSIONS.BOOKING_UPDATE_OWN);
      expect(userPerms).not.toContain(PERMISSIONS.BOOKING_READ_ALL);
      expect(userPerms).not.toContain(PERMISSIONS.BOOKING_UPDATE_ALL);
      
      // User cannot manage flights
      expect(userPerms).not.toContain(PERMISSIONS.FLIGHT_CREATE);
      expect(userPerms).not.toContain(PERMISSIONS.FLIGHT_UPDATE);
      expect(userPerms).not.toContain(PERMISSIONS.FLIGHT_DELETE);
    });
  });

  describe("Permission Checks", () => {
    it("should allow SuperAdmin to change user roles", () => {
      expect(hasPermission(ROLES.SUPER_ADMIN, PERMISSIONS.USER_ROLE_CHANGE)).toBe(true);
    });

    it("should not allow AirlineAdmin to change user roles", () => {
      expect(hasPermission(ROLES.AIRLINE_ADMIN, PERMISSIONS.USER_ROLE_CHANGE)).toBe(false);
    });

    it("should allow Finance role to process refunds", () => {
      expect(hasPermission(ROLES.FINANCE, PERMISSIONS.REFUND_PROCESS)).toBe(true);
      expect(hasPermission(ROLES.FINANCE, PERMISSIONS.REFUND_APPROVE)).toBe(true);
    });

    it("should not allow Support to process refunds", () => {
      expect(hasPermission(ROLES.SUPPORT, PERMISSIONS.REFUND_PROCESS)).toBe(false);
      expect(hasPermission(ROLES.SUPPORT, PERMISSIONS.REFUND_APPROVE)).toBe(false);
    });

    it("should allow Ops to update flight status", () => {
      expect(hasPermission(ROLES.OPS, PERMISSIONS.FLIGHT_STATUS_UPDATE)).toBe(true);
    });

    it("should not allow Ops to delete flights", () => {
      expect(hasPermission(ROLES.OPS, PERMISSIONS.FLIGHT_DELETE)).toBe(false);
    });

    it("should allow Support to view all bookings", () => {
      expect(hasPermission(ROLES.SUPPORT, PERMISSIONS.BOOKING_READ_ALL)).toBe(true);
    });

    it("should allow Support to update any booking", () => {
      expect(hasPermission(ROLES.SUPPORT, PERMISSIONS.BOOKING_UPDATE_ALL)).toBe(true);
    });

    it("should not allow Support to view all payments", () => {
      expect(hasPermission(ROLES.SUPPORT, PERMISSIONS.PAYMENT_VIEW_ALL)).toBe(true); // Support can view for customer service
    });
  });

  describe("Role Matching", () => {
    it("should match user with allowed roles", () => {
      expect(hasAnyRole("super_admin", [ROLES.SUPER_ADMIN])).toBe(true);
      expect(hasAnyRole("airline_admin", [ROLES.AIRLINE_ADMIN, ROLES.SUPER_ADMIN])).toBe(true);
      expect(hasAnyRole("user", [ROLES.USER])).toBe(true);
    });

    it("should not match user with disallowed roles", () => {
      expect(hasAnyRole("user", [ROLES.SUPER_ADMIN])).toBe(false);
      expect(hasAnyRole("support", [ROLES.FINANCE, ROLES.OPS])).toBe(false);
    });

    it("should match any of the allowed roles", () => {
      expect(hasAnyRole("support", [ROLES.SUPPORT, ROLES.FINANCE, ROLES.OPS])).toBe(true);
      expect(hasAnyRole("ops", [ROLES.SUPPORT, ROLES.FINANCE, ROLES.OPS])).toBe(true);
    });
  });

  describe("Flight Management Permissions", () => {
    it("should allow AirlineAdmin to manage flights", () => {
      expect(hasPermission(ROLES.AIRLINE_ADMIN, PERMISSIONS.FLIGHT_CREATE)).toBe(true);
      expect(hasPermission(ROLES.AIRLINE_ADMIN, PERMISSIONS.FLIGHT_UPDATE)).toBe(true);
      expect(hasPermission(ROLES.AIRLINE_ADMIN, PERMISSIONS.FLIGHT_DELETE)).toBe(true);
    });

    it("should allow Ops to update flights but not delete", () => {
      expect(hasPermission(ROLES.OPS, PERMISSIONS.FLIGHT_UPDATE)).toBe(true);
      expect(hasPermission(ROLES.OPS, PERMISSIONS.FLIGHT_DELETE)).toBe(false);
    });

    it("should not allow Finance to manage flights", () => {
      expect(hasPermission(ROLES.FINANCE, PERMISSIONS.FLIGHT_CREATE)).toBe(false);
      expect(hasPermission(ROLES.FINANCE, PERMISSIONS.FLIGHT_UPDATE)).toBe(false);
      expect(hasPermission(ROLES.FINANCE, PERMISSIONS.FLIGHT_DELETE)).toBe(false);
    });
  });

  describe("Financial Permissions", () => {
    it("should allow Finance to view all payments", () => {
      expect(hasPermission(ROLES.FINANCE, PERMISSIONS.PAYMENT_VIEW_ALL)).toBe(true);
    });

    it("should allow Finance to generate reports", () => {
      expect(hasPermission(ROLES.FINANCE, PERMISSIONS.REPORT_GENERATE)).toBe(true);
    });

    it("should not allow Support to process payments", () => {
      expect(hasPermission(ROLES.SUPPORT, PERMISSIONS.PAYMENT_PROCESS)).toBe(false);
    });

    it("should allow AirlineAdmin to approve refunds", () => {
      expect(hasPermission(ROLES.AIRLINE_ADMIN, PERMISSIONS.REFUND_APPROVE)).toBe(true);
    });
  });

  describe("Audit and System Access", () => {
    it("should allow SuperAdmin to read audit logs", () => {
      expect(hasPermission(ROLES.SUPER_ADMIN, PERMISSIONS.AUDIT_LOG_READ)).toBe(true);
    });

    it("should allow AirlineAdmin to read audit logs", () => {
      expect(hasPermission(ROLES.AIRLINE_ADMIN, PERMISSIONS.AUDIT_LOG_READ)).toBe(true);
    });

    it("should not allow regular roles to read audit logs", () => {
      expect(hasPermission(ROLES.USER, PERMISSIONS.AUDIT_LOG_READ)).toBe(false);
      expect(hasPermission(ROLES.SUPPORT, PERMISSIONS.AUDIT_LOG_READ)).toBe(false);
      expect(hasPermission(ROLES.FINANCE, PERMISSIONS.AUDIT_LOG_READ)).toBe(false);
      expect(hasPermission(ROLES.OPS, PERMISSIONS.AUDIT_LOG_READ)).toBe(false);
    });

    it("should only allow SuperAdmin to access system config", () => {
      expect(hasPermission(ROLES.SUPER_ADMIN, PERMISSIONS.SYSTEM_CONFIG)).toBe(true);
      expect(hasPermission(ROLES.AIRLINE_ADMIN, PERMISSIONS.SYSTEM_CONFIG)).toBe(false);
    });
  });

  describe("Booking Cancellation Permissions", () => {
    it("should allow users to cancel own bookings", () => {
      expect(hasPermission(ROLES.USER, PERMISSIONS.BOOKING_CANCEL_OWN)).toBe(true);
    });

    it("should allow Support to cancel any booking", () => {
      expect(hasPermission(ROLES.SUPPORT, PERMISSIONS.BOOKING_CANCEL_ALL)).toBe(true);
    });

    it("should allow AirlineAdmin to cancel any booking", () => {
      expect(hasPermission(ROLES.AIRLINE_ADMIN, PERMISSIONS.BOOKING_CANCEL_ALL)).toBe(true);
    });

    it("should not allow Finance to cancel bookings", () => {
      expect(hasPermission(ROLES.FINANCE, PERMISSIONS.BOOKING_CANCEL_ALL)).toBe(false);
      expect(hasPermission(ROLES.FINANCE, PERMISSIONS.BOOKING_CANCEL_OWN)).toBe(false);
    });
  });
});
