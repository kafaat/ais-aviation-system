import { TRPCError } from "@trpc/server";
import { eq, desc, and, SQL, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  corporateAccounts,
  corporateUsers,
  corporateBookings,
  bookings,
  flights,
  users,
  type CorporateAccount,
  type CorporateUser,
  type CorporateBooking,
} from "../../drizzle/schema";

/**
 * Corporate Travel Service
 * Business logic for corporate travel account operations
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface CreateCorporateAccountInput {
  companyName: string;
  taxId: string;
  address?: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  creditLimit?: number;
  discountPercent?: number;
}

export interface AddUserToCorporateInput {
  corporateAccountId: number;
  userId: number;
  role: "admin" | "booker" | "traveler";
}

export interface CreateCorporateBookingInput {
  corporateAccountId: number;
  bookingId: number;
  costCenter?: string;
  projectCode?: string;
  travelPurpose?: string;
  bookedByUserId: number;
}

export interface CorporateBookingFilters {
  approvalStatus?: "pending" | "approved" | "rejected";
  costCenter?: string;
  projectCode?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface CorporateAccountFilters {
  status?: "pending" | "active" | "suspended" | "closed";
}

// ============================================================================
// Corporate Account Functions
// ============================================================================

/**
 * Create a new corporate account
 * @param data - Corporate account data
 * @returns Created corporate account
 */
export async function createCorporateAccount(
  data: CreateCorporateAccountInput
): Promise<CorporateAccount> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Check if tax ID already exists
  const existing = await db
    .select()
    .from(corporateAccounts)
    .where(eq(corporateAccounts.taxId, data.taxId))
    .limit(1);

  if (existing.length > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A corporate account with this tax ID already exists",
    });
  }

  // Create the corporate account
  const result = await db.insert(corporateAccounts).values({
    companyName: data.companyName,
    taxId: data.taxId,
    address: data.address,
    contactName: data.contactName,
    contactEmail: data.contactEmail,
    contactPhone: data.contactPhone,
    creditLimit: data.creditLimit || 0,
    discountPercent: String(data.discountPercent || 0),
    status: "pending",
  });

  const insertId = (result as any).insertId || (result as any)[0]?.insertId;

  if (!insertId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create corporate account",
    });
  }

  const created = await getCorporateAccountById(insertId);
  return created!;
}

/**
 * Get a corporate account by ID
 * @param id - Corporate account ID
 * @returns Corporate account or null
 */
export async function getCorporateAccountById(
  id: number
): Promise<CorporateAccount | null> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const result = await db
    .select()
    .from(corporateAccounts)
    .where(eq(corporateAccounts.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Get all corporate accounts with optional filters
 * @param filters - Optional filters
 * @returns List of corporate accounts
 */
export async function getCorporateAccounts(
  filters?: CorporateAccountFilters
): Promise<CorporateAccount[]> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const conditions: SQL[] = [];

  if (filters?.status) {
    conditions.push(eq(corporateAccounts.status, filters.status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select()
    .from(corporateAccounts)
    .where(whereClause)
    .orderBy(desc(corporateAccounts.createdAt));

  return results;
}

/**
 * Activate a corporate account (admin only)
 * @param id - Corporate account ID
 * @param adminUserId - Admin user ID
 * @returns Updated corporate account
 */
export async function activateCorporateAccount(
  id: number,
  adminUserId: number
): Promise<CorporateAccount> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const account = await getCorporateAccountById(id);
  if (!account) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Corporate account not found",
    });
  }

  if (account.status === "active") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Corporate account is already active",
    });
  }

  await db
    .update(corporateAccounts)
    .set({
      status: "active",
      approvedBy: adminUserId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(corporateAccounts.id, id));

  return (await getCorporateAccountById(id))!;
}

/**
 * Suspend a corporate account (admin only)
 * @param id - Corporate account ID
 * @returns Updated corporate account
 */
export async function suspendCorporateAccount(
  id: number
): Promise<CorporateAccount> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const account = await getCorporateAccountById(id);
  if (!account) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Corporate account not found",
    });
  }

  await db
    .update(corporateAccounts)
    .set({
      status: "suspended",
      updatedAt: new Date(),
    })
    .where(eq(corporateAccounts.id, id));

  return (await getCorporateAccountById(id))!;
}

/**
 * Update corporate account settings
 * @param id - Corporate account ID
 * @param data - Data to update
 * @returns Updated corporate account
 */
export async function updateCorporateAccount(
  id: number,
  data: Partial<CreateCorporateAccountInput>
): Promise<CorporateAccount> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const account = await getCorporateAccountById(id);
  if (!account) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Corporate account not found",
    });
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.companyName) updateData.companyName = data.companyName;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.contactName) updateData.contactName = data.contactName;
  if (data.contactEmail) updateData.contactEmail = data.contactEmail;
  if (data.contactPhone !== undefined)
    updateData.contactPhone = data.contactPhone;
  if (data.creditLimit !== undefined) updateData.creditLimit = data.creditLimit;
  if (data.discountPercent !== undefined)
    updateData.discountPercent = String(data.discountPercent);

  await db
    .update(corporateAccounts)
    .set(updateData)
    .where(eq(corporateAccounts.id, id));

  return (await getCorporateAccountById(id))!;
}

// ============================================================================
// Corporate User Functions
// ============================================================================

/**
 * Add a user to a corporate account
 * @param data - User and account data
 * @returns Created corporate user record
 */
export async function addUserToCorporate(
  data: AddUserToCorporateInput
): Promise<CorporateUser> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Check if corporate account exists and is active
  const account = await getCorporateAccountById(data.corporateAccountId);
  if (!account) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Corporate account not found",
    });
  }

  if (account.status !== "active") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Corporate account is not active",
    });
  }

  // Check if user exists
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, data.userId))
    .limit(1);

  if (user.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "User not found",
    });
  }

  // Check if user is already in a corporate account
  const existingMembership = await db
    .select()
    .from(corporateUsers)
    .where(
      and(
        eq(corporateUsers.userId, data.userId),
        eq(corporateUsers.isActive, true)
      )
    )
    .limit(1);

  if (existingMembership.length > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "User is already a member of a corporate account",
    });
  }

  // Add user to corporate account
  const result = await db.insert(corporateUsers).values({
    corporateAccountId: data.corporateAccountId,
    userId: data.userId,
    role: data.role,
    isActive: true,
  });

  const insertId = (result as any).insertId || (result as any)[0]?.insertId;

  const created = await db
    .select()
    .from(corporateUsers)
    .where(eq(corporateUsers.id, insertId))
    .limit(1);

  return created[0];
}

/**
 * Get corporate users for an account
 * @param corporateAccountId - Corporate account ID
 * @returns List of corporate users with user details
 */
export async function getCorporateUsers(corporateAccountId: number): Promise<
  Array<
    CorporateUser & {
      user: { id: number; name: string | null; email: string | null };
    }
  >
> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const results = await db
    .select({
      id: corporateUsers.id,
      corporateAccountId: corporateUsers.corporateAccountId,
      userId: corporateUsers.userId,
      role: corporateUsers.role,
      isActive: corporateUsers.isActive,
      createdAt: corporateUsers.createdAt,
      updatedAt: corporateUsers.updatedAt,
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
    })
    .from(corporateUsers)
    .innerJoin(users, eq(corporateUsers.userId, users.id))
    .where(
      and(
        eq(corporateUsers.corporateAccountId, corporateAccountId),
        eq(corporateUsers.isActive, true)
      )
    )
    .orderBy(desc(corporateUsers.createdAt));

  return results as any;
}

/**
 * Get a user's corporate account
 * @param userId - User ID
 * @returns Corporate account or null
 */
export async function getUserCorporateAccount(
  userId: number
): Promise<(CorporateAccount & { role: string }) | null> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const result = await db
    .select({
      id: corporateAccounts.id,
      companyName: corporateAccounts.companyName,
      taxId: corporateAccounts.taxId,
      address: corporateAccounts.address,
      contactName: corporateAccounts.contactName,
      contactEmail: corporateAccounts.contactEmail,
      contactPhone: corporateAccounts.contactPhone,
      creditLimit: corporateAccounts.creditLimit,
      balance: corporateAccounts.balance,
      discountPercent: corporateAccounts.discountPercent,
      status: corporateAccounts.status,
      approvedBy: corporateAccounts.approvedBy,
      approvedAt: corporateAccounts.approvedAt,
      createdAt: corporateAccounts.createdAt,
      updatedAt: corporateAccounts.updatedAt,
      role: corporateUsers.role,
    })
    .from(corporateUsers)
    .innerJoin(
      corporateAccounts,
      eq(corporateUsers.corporateAccountId, corporateAccounts.id)
    )
    .where(
      and(eq(corporateUsers.userId, userId), eq(corporateUsers.isActive, true))
    )
    .limit(1);

  return result.length > 0 ? (result[0] as any) : null;
}

/**
 * Remove a user from a corporate account
 * @param corporateUserId - Corporate user record ID
 * @returns Updated corporate user record
 */
export async function removeUserFromCorporate(
  corporateUserId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  await db
    .update(corporateUsers)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(eq(corporateUsers.id, corporateUserId));
}

/**
 * Update a corporate user's role
 * @param corporateUserId - Corporate user record ID
 * @param role - New role
 * @returns Updated corporate user record
 */
export async function updateCorporateUserRole(
  corporateUserId: number,
  role: "admin" | "booker" | "traveler"
): Promise<CorporateUser> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  await db
    .update(corporateUsers)
    .set({
      role,
      updatedAt: new Date(),
    })
    .where(eq(corporateUsers.id, corporateUserId));

  const updated = await db
    .select()
    .from(corporateUsers)
    .where(eq(corporateUsers.id, corporateUserId))
    .limit(1);

  return updated[0];
}

// ============================================================================
// Corporate Booking Functions
// ============================================================================

/**
 * Create a corporate booking
 * @param data - Corporate booking data
 * @returns Created corporate booking
 */
export async function createCorporateBooking(
  data: CreateCorporateBookingInput
): Promise<CorporateBooking> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Verify corporate account is active
  const account = await getCorporateAccountById(data.corporateAccountId);
  if (!account) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Corporate account not found",
    });
  }

  if (account.status !== "active") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Corporate account is not active",
    });
  }

  // Verify booking exists
  const booking = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, data.bookingId))
    .limit(1);

  if (booking.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found",
    });
  }

  // Create corporate booking record
  const result = await db.insert(corporateBookings).values({
    corporateAccountId: data.corporateAccountId,
    bookingId: data.bookingId,
    costCenter: data.costCenter,
    projectCode: data.projectCode,
    travelPurpose: data.travelPurpose,
    bookedByUserId: data.bookedByUserId,
    approvalStatus: "pending",
  });

  const insertId = (result as any).insertId || (result as any)[0]?.insertId;

  const created = await db
    .select()
    .from(corporateBookings)
    .where(eq(corporateBookings.id, insertId))
    .limit(1);

  return created[0];
}

/**
 * Approve a corporate booking
 * @param bookingId - Corporate booking ID
 * @param approverId - User ID of the approver
 * @returns Updated corporate booking
 */
export async function approveCorporateBooking(
  bookingId: number,
  approverId: number
): Promise<CorporateBooking> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const corporateBooking = await db
    .select()
    .from(corporateBookings)
    .where(eq(corporateBookings.id, bookingId))
    .limit(1);

  if (corporateBooking.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Corporate booking not found",
    });
  }

  if (corporateBooking[0].approvalStatus !== "pending") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot approve a ${corporateBooking[0].approvalStatus} booking`,
    });
  }

  // Verify approver has permission (is admin of the corporate account)
  const approverMembership = await db
    .select()
    .from(corporateUsers)
    .where(
      and(
        eq(
          corporateUsers.corporateAccountId,
          corporateBooking[0].corporateAccountId
        ),
        eq(corporateUsers.userId, approverId),
        eq(corporateUsers.role, "admin"),
        eq(corporateUsers.isActive, true)
      )
    )
    .limit(1);

  if (approverMembership.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to approve bookings",
    });
  }

  await db
    .update(corporateBookings)
    .set({
      approvalStatus: "approved",
      approvedBy: approverId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(corporateBookings.id, bookingId));

  const updated = await db
    .select()
    .from(corporateBookings)
    .where(eq(corporateBookings.id, bookingId))
    .limit(1);

  return updated[0];
}

/**
 * Reject a corporate booking
 * @param bookingId - Corporate booking ID
 * @param approverId - User ID of the approver
 * @param reason - Rejection reason
 * @returns Updated corporate booking
 */
export async function rejectCorporateBooking(
  bookingId: number,
  approverId: number,
  reason: string
): Promise<CorporateBooking> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const corporateBooking = await db
    .select()
    .from(corporateBookings)
    .where(eq(corporateBookings.id, bookingId))
    .limit(1);

  if (corporateBooking.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Corporate booking not found",
    });
  }

  if (corporateBooking[0].approvalStatus !== "pending") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot reject a ${corporateBooking[0].approvalStatus} booking`,
    });
  }

  // Verify approver has permission
  const approverMembership = await db
    .select()
    .from(corporateUsers)
    .where(
      and(
        eq(
          corporateUsers.corporateAccountId,
          corporateBooking[0].corporateAccountId
        ),
        eq(corporateUsers.userId, approverId),
        eq(corporateUsers.role, "admin"),
        eq(corporateUsers.isActive, true)
      )
    )
    .limit(1);

  if (approverMembership.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to reject bookings",
    });
  }

  await db
    .update(corporateBookings)
    .set({
      approvalStatus: "rejected",
      approvedBy: approverId,
      approvedAt: new Date(),
      rejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(corporateBookings.id, bookingId));

  const updated = await db
    .select()
    .from(corporateBookings)
    .where(eq(corporateBookings.id, bookingId))
    .limit(1);

  return updated[0];
}

/**
 * Get corporate bookings with filters
 * @param corporateAccountId - Corporate account ID
 * @param filters - Optional filters
 * @returns List of corporate bookings with booking details
 */
export async function getCorporateBookings(
  corporateAccountId: number,
  filters?: CorporateBookingFilters
): Promise<
  Array<
    CorporateBooking & {
      booking: {
        id: number;
        bookingReference: string;
        status: string;
        totalAmount: number;
        flightId: number;
        createdAt: Date;
      };
      flight: {
        flightNumber: string;
        departureTime: Date;
        originId: number;
        destinationId: number;
      };
    }
  >
> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const conditions: SQL[] = [
    eq(corporateBookings.corporateAccountId, corporateAccountId),
  ];

  if (filters?.approvalStatus) {
    conditions.push(
      eq(corporateBookings.approvalStatus, filters.approvalStatus)
    );
  }

  if (filters?.costCenter) {
    conditions.push(eq(corporateBookings.costCenter, filters.costCenter));
  }

  if (filters?.projectCode) {
    conditions.push(eq(corporateBookings.projectCode, filters.projectCode));
  }

  const whereClause = and(...conditions);

  const results = await db
    .select({
      id: corporateBookings.id,
      corporateAccountId: corporateBookings.corporateAccountId,
      bookingId: corporateBookings.bookingId,
      costCenter: corporateBookings.costCenter,
      projectCode: corporateBookings.projectCode,
      travelPurpose: corporateBookings.travelPurpose,
      approvalStatus: corporateBookings.approvalStatus,
      approvedBy: corporateBookings.approvedBy,
      approvedAt: corporateBookings.approvedAt,
      rejectionReason: corporateBookings.rejectionReason,
      bookedByUserId: corporateBookings.bookedByUserId,
      createdAt: corporateBookings.createdAt,
      updatedAt: corporateBookings.updatedAt,
      booking: {
        id: bookings.id,
        bookingReference: bookings.bookingReference,
        status: bookings.status,
        totalAmount: bookings.totalAmount,
        flightId: bookings.flightId,
        createdAt: bookings.createdAt,
      },
      flight: {
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        originId: flights.originId,
        destinationId: flights.destinationId,
      },
    })
    .from(corporateBookings)
    .innerJoin(bookings, eq(corporateBookings.bookingId, bookings.id))
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(whereClause)
    .orderBy(desc(corporateBookings.createdAt));

  return results as any;
}

/**
 * Get corporate account statistics
 * @param corporateAccountId - Corporate account ID
 * @returns Statistics about corporate bookings
 */
export async function getCorporateStats(corporateAccountId: number): Promise<{
  totalBookings: number;
  pendingApprovals: number;
  approvedBookings: number;
  rejectedBookings: number;
  totalSpent: number;
  userCount: number;
  creditRemaining: number;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Get account details
  const account = await getCorporateAccountById(corporateAccountId);
  if (!account) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Corporate account not found",
    });
  }

  // Get all corporate bookings
  const allBookings = await db
    .select({
      approvalStatus: corporateBookings.approvalStatus,
      totalAmount: bookings.totalAmount,
    })
    .from(corporateBookings)
    .innerJoin(bookings, eq(corporateBookings.bookingId, bookings.id))
    .where(eq(corporateBookings.corporateAccountId, corporateAccountId));

  // Get user count
  const userCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(corporateUsers)
    .where(
      and(
        eq(corporateUsers.corporateAccountId, corporateAccountId),
        eq(corporateUsers.isActive, true)
      )
    );

  const stats = {
    totalBookings: allBookings.length,
    pendingApprovals: allBookings.filter(b => b.approvalStatus === "pending")
      .length,
    approvedBookings: allBookings.filter(b => b.approvalStatus === "approved")
      .length,
    rejectedBookings: allBookings.filter(b => b.approvalStatus === "rejected")
      .length,
    totalSpent: allBookings
      .filter(b => b.approvalStatus === "approved")
      .reduce((sum, b) => sum + b.totalAmount, 0),
    userCount: Number(userCountResult[0]?.count || 0),
    creditRemaining: Math.max(0, account.creditLimit - account.balance),
  };

  return stats;
}
