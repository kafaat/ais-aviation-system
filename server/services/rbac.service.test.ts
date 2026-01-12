import { describe, it, expect } from "vitest";
import {
  isAuthorized,
  hasCapability,
  isAdmin,
  isSupportOrHigher,
  hasFinancialAccess,
  getRoleDisplayName,
  getRoleCapabilities,
  getAllRoles,
  isValidRole,
  type UserRole,
} from "./rbac.service";

describe("RBAC Service", () => {
  describe("isAuthorized", () => {
    it("should authorize user with exact role match", () => {
      expect(isAuthorized("admin", ["admin"])).toBe(true);
      expect(isAuthorized("user", ["user"])).toBe(true);
    });

    it("should authorize super_admin for any role", () => {
      expect(isAuthorized("super_admin", ["user"])).toBe(true);
      expect(isAuthorized("super_admin", ["admin"])).toBe(true);
      expect(isAuthorized("super_admin", ["finance"])).toBe(true);
    });

    it("should authorize higher roles for lower role requirements", () => {
      expect(isAuthorized("admin", ["user"])).toBe(true);
      expect(isAuthorized("ops", ["support"])).toBe(true);
      expect(isAuthorized("finance", ["ops"])).toBe(true); // finance level 4 >= ops level 3
    });

    it("should not authorize lower roles for higher role requirements", () => {
      expect(isAuthorized("user", ["admin"])).toBe(false);
      expect(isAuthorized("support", ["airline_admin"])).toBe(false);
    });

    it("should authorize when no specific role required", () => {
      expect(isAuthorized("user", [])).toBe(true);
      expect(isAuthorized("admin", [])).toBe(true);
    });

    it("should authorize if user role is in required roles list", () => {
      expect(isAuthorized("support", ["support", "ops"])).toBe(true);
      expect(isAuthorized("finance", ["finance", "admin"])).toBe(true);
    });
  });

  describe("hasCapability", () => {
    it("should return true for direct capabilities", () => {
      expect(hasCapability("user", "Search flights")).toBe(true);
      expect(hasCapability("admin", "Access all system data")).toBe(true);
    });

    it("should return true for inherited capabilities", () => {
      expect(hasCapability("admin", "Search flights")).toBe(true); // inherited from user
      expect(hasCapability("support", "Make bookings")).toBe(true); // inherited from user
    });

    it("should return false for non-existent capabilities", () => {
      expect(hasCapability("user", "Delete data")).toBe(false);
      expect(hasCapability("support", "Manage user roles")).toBe(false);
    });
  });

  describe("isAdmin", () => {
    it("should return true for admin roles", () => {
      expect(isAdmin("admin")).toBe(true);
      expect(isAdmin("super_admin")).toBe(true);
      expect(isAdmin("airline_admin")).toBe(true);
    });

    it("should return false for non-admin roles", () => {
      expect(isAdmin("user")).toBe(false);
      expect(isAdmin("support")).toBe(false);
      expect(isAdmin("ops")).toBe(false);
      expect(isAdmin("finance")).toBe(false);
    });
  });

  describe("isSupportOrHigher", () => {
    it("should return true for support and higher roles", () => {
      expect(isSupportOrHigher("support")).toBe(true);
      expect(isSupportOrHigher("ops")).toBe(true);
      expect(isSupportOrHigher("finance")).toBe(true);
      expect(isSupportOrHigher("airline_admin")).toBe(true);
      expect(isSupportOrHigher("admin")).toBe(true);
      expect(isSupportOrHigher("super_admin")).toBe(true);
    });

    it("should return false for user role", () => {
      expect(isSupportOrHigher("user")).toBe(false);
    });
  });

  describe("hasFinancialAccess", () => {
    it("should return true for financial roles", () => {
      expect(hasFinancialAccess("finance")).toBe(true);
      expect(hasFinancialAccess("admin")).toBe(true);
      expect(hasFinancialAccess("super_admin")).toBe(true);
    });

    it("should return false for non-financial roles", () => {
      expect(hasFinancialAccess("user")).toBe(false);
      expect(hasFinancialAccess("support")).toBe(false);
      expect(hasFinancialAccess("ops")).toBe(false);
      expect(hasFinancialAccess("airline_admin")).toBe(false);
    });
  });

  describe("getRoleDisplayName", () => {
    it("should return display name for all roles", () => {
      expect(getRoleDisplayName("user")).toBe("User");
      expect(getRoleDisplayName("support")).toBe("Support Agent");
      expect(getRoleDisplayName("ops")).toBe("Operations Staff");
      expect(getRoleDisplayName("finance")).toBe("Finance Team");
      expect(getRoleDisplayName("airline_admin")).toBe("Airline Administrator");
      expect(getRoleDisplayName("admin")).toBe("Administrator");
      expect(getRoleDisplayName("super_admin")).toBe("Super Administrator");
    });
  });

  describe("getRoleCapabilities", () => {
    it("should return capabilities for each role", () => {
      const userCapabilities = getRoleCapabilities("user");
      expect(userCapabilities).toContain("Search flights");
      expect(userCapabilities).toContain("Make bookings");

      const adminCapabilities = getRoleCapabilities("admin");
      expect(adminCapabilities).toContain("Access all system data");
      expect(adminCapabilities).toContain("View system logs");
    });

    it("should return empty array for invalid role", () => {
      expect(getRoleCapabilities("invalid" as UserRole)).toEqual([]);
    });
  });

  describe("getAllRoles", () => {
    it("should return all defined roles", () => {
      const roles = getAllRoles();
      expect(roles).toContain("user");
      expect(roles).toContain("support");
      expect(roles).toContain("ops");
      expect(roles).toContain("finance");
      expect(roles).toContain("airline_admin");
      expect(roles).toContain("admin");
      expect(roles).toContain("super_admin");
      expect(roles.length).toBe(7);
    });
  });

  describe("isValidRole", () => {
    it("should return true for valid roles", () => {
      expect(isValidRole("user")).toBe(true);
      expect(isValidRole("admin")).toBe(true);
      expect(isValidRole("super_admin")).toBe(true);
    });

    it("should return false for invalid roles", () => {
      expect(isValidRole("invalid")).toBe(false);
      expect(isValidRole("")).toBe(false);
      expect(isValidRole("ADMIN")).toBe(false); // case sensitive
    });
  });

  describe("Role Hierarchy", () => {
    it("should maintain correct hierarchy levels", () => {
      const roles: UserRole[] = [
        "user",
        "support",
        "ops",
        "finance",
        "airline_admin",
        "admin",
        "super_admin",
      ];

      // Verify each higher role can access lower role requirements
      for (let i = 0; i < roles.length; i++) {
        for (let j = 0; j <= i; j++) {
          const result = isAuthorized(roles[i], [roles[j]]);
          expect(result).toBe(true);
        }
      }
    });
  });
});
