import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { stripe, FLIGHT_PRODUCTS } from "./stripe";
import { getDb } from "./db";
import { bookings } from "../drizzle/schema";
import { eq, sql, gte, count, sum, desc } from "drizzle-orm";
import { flights, airlines, airports } from "../drizzle/schema";

// Admin-only procedure
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});

export const appRouter = router({
  system: systemRouter,
  
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // Flight APIs
  flights: router({
    search: publicProcedure
      .input(z.object({
        originId: z.number(),
        destinationId: z.number(),
        departureDate: z.date(),
      }))
      .query(async ({ input }) => {
        return await db.searchFlights(input);
      }),

    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const flight = await db.getFlightById(input.id);
        if (!flight) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Flight not found' });
        }
        return flight;
      }),
  }),

  // Booking APIs
  bookings: router({
    create: protectedProcedure
      .input(z.object({
        flightId: z.number(),
        cabinClass: z.enum(["economy", "business"]),
        passengers: z.array(z.object({
          type: z.enum(["adult", "child", "infant"]),
          title: z.string().optional(),
          firstName: z.string(),
          lastName: z.string(),
          dateOfBirth: z.date().optional(),
          passportNumber: z.string().optional(),
          nationality: z.string().optional(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        // Get flight details
        const flight = await db.getFlightById(input.flightId);
        if (!flight) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Flight not found' });
        }

        // Check availability
        const availableSeats = input.cabinClass === "economy" 
          ? flight.economyAvailable 
          : flight.businessAvailable;
        
        if (availableSeats < input.passengers.length) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not enough seats available' });
        }

        // Calculate total amount
        const pricePerSeat = input.cabinClass === "economy" 
          ? flight.economyPrice 
          : flight.businessPrice;
        const totalAmount = pricePerSeat * input.passengers.length;

        // Generate booking reference and PNR
        const bookingReference = db.generateBookingReference();
        const pnr = db.generateBookingReference();

        // Create booking
        const bookingResult = await db.createBooking({
          userId: ctx.user.id,
          flightId: input.flightId,
          bookingReference,
          pnr,
          status: "pending",
          totalAmount,
          paymentStatus: "pending",
          cabinClass: input.cabinClass,
          numberOfPassengers: input.passengers.length,
          checkedIn: false,
        });

        const bookingId = Number(bookingResult[0].insertId);

        // Create passengers
        const passengerData = input.passengers.map(p => ({
          bookingId,
          type: p.type,
          title: p.title || null,
          firstName: p.firstName,
          lastName: p.lastName,
          dateOfBirth: p.dateOfBirth || null,
          passportNumber: p.passportNumber || null,
          nationality: p.nationality || null,
          seatNumber: null,
        }));

        await db.createPassengers(passengerData);

        // Update flight availability
        const newAvailability = availableSeats - input.passengers.length;
        await db.updateFlightAvailability(input.flightId, input.cabinClass, newAvailability);

        return {
          bookingId,
          bookingReference,
          pnr,
          totalAmount,
        };
      }),

    myBookings: protectedProcedure
      .query(async ({ ctx }) => {
        return await db.getBookingsByUserId(ctx.user.id);
      }),

    getByPNR: publicProcedure
      .input(z.object({ pnr: z.string().length(6) }))
      .query(async ({ input }) => {
        const booking = await db.getBookingByPNR(input.pnr);
        if (!booking) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Booking not found' });
        }

        const passengers = await db.getPassengersByBookingId(booking.id);
        const flight = await db.getFlightById(booking.flightId);

        return {
          ...booking,
          passengers,
          flight,
        };
      }),

    checkIn: protectedProcedure
      .input(z.object({ bookingId: z.number() }))
      .mutation(async ({ input }) => {
        const booking = await db.getBookingByPNR("");
        // Simplified check-in logic
        await db.updateBookingStatus(input.bookingId, "confirmed");
        
        return { success: true };
      }),
  }),

  // Stripe Payment APIs
  stripe: router({
    createCheckoutSession: protectedProcedure
      .input(z.object({
        bookingId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Database not available" });

        // Get booking details
        const booking = await database.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1);
        if (!booking[0]) throw new TRPCError({ code: 'NOT_FOUND', message: "Booking not found" });
        if (booking[0].userId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: "Unauthorized" });
        if (booking[0].paymentStatus === "paid") throw new TRPCError({ code: 'BAD_REQUEST', message: "Booking already paid" });

        const bookingData = booking[0];
        const productName = bookingData.cabinClass === "business" 
          ? FLIGHT_PRODUCTS.BUSINESS_TICKET.name 
          : FLIGHT_PRODUCTS.ECONOMY_TICKET.name;
        const productDescription = bookingData.cabinClass === "business"
          ? FLIGHT_PRODUCTS.BUSINESS_TICKET.description
          : FLIGHT_PRODUCTS.ECONOMY_TICKET.description;

        // Create Stripe checkout session
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency: 'sar',
                product_data: {
                  name: productName,
                  description: `${productDescription} - ${bookingData.numberOfPassengers} passenger(s) - Ref: ${bookingData.bookingReference}`,
                  metadata: {
                    bookingReference: bookingData.bookingReference,
                    pnr: bookingData.pnr,
                  },
                },
                unit_amount: bookingData.totalAmount,
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          success_url: `${ctx.req.headers.origin}/my-bookings?session_id={CHECKOUT_SESSION_ID}&success=true`,
          cancel_url: `${ctx.req.headers.origin}/booking/${input.bookingId}?canceled=true`,
          customer_email: ctx.user.email || undefined,
          client_reference_id: ctx.user.id.toString(),
          metadata: {
            bookingId: input.bookingId.toString(),
            userId: ctx.user.id.toString(),
            bookingReference: bookingData.bookingReference,
            customerEmail: ctx.user.email || '',
            customerName: ctx.user.name || '',
          },
          allow_promotion_codes: true,
        });

        // Update booking with session ID
        await database.update(bookings)
          .set({ stripeCheckoutSessionId: session.id })
          .where(eq(bookings.id, input.bookingId));

        return {
          sessionId: session.id,
          url: session.url,
        };
      }),

    verifySession: protectedProcedure
      .input(z.object({
        sessionId: z.string(),
      }))
      .query(async ({ input }) => {
        const session = await stripe.checkout.sessions.retrieve(input.sessionId);
        return {
          status: session.payment_status,
          customerEmail: session.customer_email,
        };
      }),
  }),

  // Payment APIs
  payments: router({
    create: protectedProcedure
      .input(z.object({
        bookingId: z.number(),
        amount: z.number(),
        method: z.enum(["card", "wallet", "bank_transfer"]),
      }))
      .mutation(async ({ input }) => {
        // Create payment record
        const paymentResult = await db.createPayment({
          bookingId: input.bookingId,
          amount: input.amount,
          currency: "SAR",
          method: input.method,
          status: "pending",
          transactionId: null,
        });

        const paymentId = Number(paymentResult[0].insertId);

        // Simulate payment processing
        // In production, integrate with actual payment gateway
        const transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        
        await db.updatePaymentStatus(paymentId, "completed", transactionId);
        await db.updateBookingStatus(input.bookingId, "confirmed");

        return {
          paymentId,
          transactionId,
          status: "completed",
        };
      }),
  }),

  // Reference Data APIs
  reference: router({
    airlines: publicProcedure
      .query(async () => {
        return await db.getAllAirlines();
      }),

    airports: publicProcedure
      .query(async () => {
        return await db.getAllAirports();
      }),
  }),

  // Analytics APIs
  analytics: router({ overview: protectedProcedure.query(async () => {
      const database = await getDb();
      if (!database) throw new Error("Database not available");

      const totalBookingsResult = await database.select({ count: count() }).from(bookings);
      const totalBookings = totalBookingsResult[0]?.count || 0;

      const revenueResult = await database
        .select({ total: sum(bookings.totalAmount) })
        .from(bookings)
        .where(eq(bookings.paymentStatus, "paid"));
      const totalRevenue = Number(revenueResult[0]?.total || 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayBookingsResult = await database
        .select({ count: count() })
        .from(bookings)
        .where(gte(bookings.createdAt, today));
      const todayBookings = todayBookingsResult[0]?.count || 0;

      const avgBookingValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;

      return {
        totalBookings,
        totalRevenue,
        todayBookings,
        avgBookingValue,
      };
    }),

    dailyBookings: protectedProcedure.query(async () => {
      const database = await getDb();
      if (!database) throw new Error("Database not available");

      const last30Days = new Date();
      last30Days.setDate(last30Days.getDate() - 30);
      const formattedDate = last30Days.toISOString().split('T')[0];

      const result = await database.execute(
        sql`
          SELECT 
            DATE(createdAt) as date,
            COUNT(*) as count,
            SUM(totalAmount) as revenue
          FROM bookings
          WHERE createdAt >= ${formattedDate}
          GROUP BY DATE(createdAt)
          ORDER BY DATE(createdAt)
        `
      );

      const rows = (result as any)[0] as any[];
      return rows.map((r: any) => ({
        date: r.date,
        bookings: Number(r.count),
        revenue: Number(r.revenue || 0) / 100,
      }));
    }),

    topDestinations: protectedProcedure.query(async () => {
      const database = await getDb();
      if (!database) throw new Error("Database not available");

      const result = await database
        .select({
          destination: airports.city,
          code: airports.code,
          count: count(),
        })
        .from(bookings)
        .innerJoin(flights, eq(bookings.flightId, flights.id))
        .innerJoin(airports, eq(flights.destinationId, airports.id))
        .groupBy(airports.id, airports.city, airports.code)
        .orderBy(desc(count()))
        .limit(10);

      return result;
    }),

    airlinePerformance: protectedProcedure.query(async () => {
      const database = await getDb();
      if (!database) throw new Error("Database not available");

      const result = await database
        .select({
          airline: airlines.name,
          bookings: count(),
          revenue: sum(bookings.totalAmount),
        })
        .from(bookings)
        .innerJoin(flights, eq(bookings.flightId, flights.id))
        .innerJoin(airlines, eq(flights.airlineId, airlines.id))
        .where(eq(bookings.paymentStatus, "paid"))
        .groupBy(airlines.id, airlines.name)
        .orderBy(desc(count()));

      return result.map(r => ({
        airline: r.airline,
        bookings: r.bookings,
        revenue: Number(r.revenue || 0) / 100,
      }));
    }),
  }),

  // Admin APIs
  admin: router({
    createFlight: adminProcedure
      .input(z.object({
        flightNumber: z.string(),
        airlineId: z.number(),
        originId: z.number(),
        destinationId: z.number(),
        departureTime: z.date(),
        arrivalTime: z.date(),
        aircraftType: z.string().optional(),
        economySeats: z.number(),
        businessSeats: z.number(),
        economyPrice: z.number(),
        businessPrice: z.number(),
      }))
      .mutation(async ({ input }) => {
        const result = await db.createFlight({
          ...input,
          aircraftType: input.aircraftType || null,
          status: "scheduled",
          economyAvailable: input.economySeats,
          businessAvailable: input.businessSeats,
        });

        return { success: true, flightId: Number(result[0].insertId) };
      }),
  }),
});

export type AppRouter = typeof appRouter;
