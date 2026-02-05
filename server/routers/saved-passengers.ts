import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getUserPassengers,
  getPassenger,
  getDefaultPassenger,
  addPassenger,
  updatePassenger,
  deletePassenger,
  setDefaultPassenger,
} from "../services/saved-passengers.service";

// Input validation schema for passenger data
const passengerDataSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  dateOfBirth: z.date().optional(),
  nationality: z.string().max(100).optional(),
  passportNumber: z.string().max(50).optional(),
  passportExpiry: z.date().optional(),
  email: z.string().email().max(320).optional().or(z.literal("")),
  phone: z.string().max(20).optional(),
  isDefault: z.boolean().optional(),
});

export const savedPassengersRouter = router({
  /**
   * Get all saved passengers for the current user
   */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    return await getUserPassengers(ctx.user.id);
  }),

  /**
   * Get a single saved passenger by ID
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      return await getPassenger(input.id, ctx.user.id);
    }),

  /**
   * Get the default passenger for the current user
   */
  getDefault: protectedProcedure.query(async ({ ctx }) => {
    return await getDefaultPassenger(ctx.user.id);
  }),

  /**
   * Add a new saved passenger
   */
  add: protectedProcedure
    .input(passengerDataSchema)
    .mutation(async ({ ctx, input }) => {
      return await addPassenger(ctx.user.id, {
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        nationality: input.nationality || null,
        passportNumber: input.passportNumber || null,
        passportExpiry: input.passportExpiry,
        email: input.email || null,
        phone: input.phone || null,
        isDefault: input.isDefault ?? false,
      });
    }),

  /**
   * Update an existing saved passenger
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        data: passengerDataSchema.partial(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await updatePassenger(input.id, ctx.user.id, input.data);
    }),

  /**
   * Delete a saved passenger
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deletePassenger(input.id, ctx.user.id);
      return { success: true };
    }),

  /**
   * Set a passenger as the default
   */
  setDefault: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return await setDefaultPassenger(input.id, ctx.user.id);
    }),
});
