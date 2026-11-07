/**
 * Type B gateway router: station file, queue, inbound ingest and previews.
 *
 * Admin procedures carry the caller's tenant scope (platform admins see all).
 * `ingestInbound` is the only public procedure; it requires either an admin
 * session or the TYPEB_INGEST_TOKEN service token, compared in constant time.
 */
import { timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { isAdmin } from "../services/rbac.service";
import {
  buildLdmPayload,
  buildMvtPayload,
  buildPnlPayload,
  buildBsmPayload,
  loadFlightContext,
} from "../services/typeb/builders.service";
import {
  acknowledgeTypeBMessage,
  enqueueTypeBMessage,
  gatewayStatus,
  getMessage,
  ingestInboundTypeB,
  listAddresses,
  listMessages,
  removeAddress,
  renderTypeBMessage,
  retryTypeBMessage,
  stationsFor,
  TypeBGatewayError,
  upsertAddress,
} from "../services/typeb/gateway.service";
import {
  TYPEB_MESSAGE_TYPES,
  TypeBFormatError,
  type MvtMovement,
} from "../services/typeb/model";
import { TYPEB_PRIORITIES } from "../services/typeb/envelope";
import { runTypeBGatewayTick } from "../services/typeb/triggers.service";

const id = z.number().int().positive();
const station = z.string().regex(/^[A-Za-z]{3}$/);
const address = z.string().regex(/^[A-Za-z]{3}[A-Za-z]{2}[A-Za-z0-9]{2}$/);
const messageType = z.enum(TYPEB_MESSAGE_TYPES);
const instant = z.coerce.date();

/** Map format/gateway errors to BAD_REQUEST so the admin page shows the reason. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TypeBFormatError || error instanceof TypeBGatewayError)
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    throw error;
  }
}

function tokenMatches(token: string | undefined) {
  const expected = process.env.TYPEB_INGEST_TOKEN?.trim();
  if (!expected || expected.length < 32 || !token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const delays = z
  .array(
    z.object({
      code: z.string().regex(/^[0-9A-Za-z]{2}$/),
      minutes: z.number().int().min(0),
    })
  )
  .max(4)
  .optional();

const movementInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("AD"),
    offBlocks: instant,
    airborne: instant.optional(),
    estimatedArrival: instant.optional(),
    delays,
    passengers: z.array(z.number().int().min(0)).min(1).max(4).optional(),
  }),
  z.object({
    kind: z.literal("AA"),
    touchdown: instant.optional(),
    onBlocks: instant,
  }),
  z.object({ kind: z.literal("ED"), estimatedDeparture: instant, delays }),
  z.object({ kind: z.literal("NI"), nextInformation: instant }),
]);

const ldmInput = z.object({
  registration: z.string().min(3).max(10).optional(),
  crew: z.object({
    cockpit: z.number().int().min(0).max(99),
    cabin: z.number().int().min(0).max(99),
    extra: z.number().int().min(0).max(99).optional(),
  }),
  passengers: z
    .object({
      adults: z.number().int().min(0),
      children: z.number().int().min(0),
      infants: z.number().int().min(0),
    })
    .optional(),
  paxByClass: z.array(z.number().int().min(0)).optional(),
  padByClass: z.array(z.number().int().min(0)).optional(),
  totalLoadKg: z.number().int().min(0),
  compartments: z
    .array(
      z.object({
        compartment: z.string().regex(/^[1-5]$/),
        weightKg: z.number().int().min(0),
      })
    )
    .max(5),
  baggage: z
    .object({
      pieces: z.number().int().min(0),
      weightKg: z.number().int().min(0),
    })
    .optional(),
  cargoKg: z.number().int().min(0).optional(),
  mailKg: z.number().int().min(0).optional(),
  totals: z
    .object({
      totalLoadKg: z.number().int().min(0).optional(),
      underloadKg: z.number().int().min(0).optional(),
      zeroFuelWeightKg: z.number().int().min(0).optional(),
      takeOffWeightKg: z.number().int().min(0).optional(),
      landingWeightKg: z.number().int().min(0).optional(),
    })
    .optional(),
  remarks: z.array(z.string().max(200)).max(10).optional(),
});

const dispatch = z.object({
  flightId: id,
  /** false renders the text without queueing (preview). */
  enqueue: z.boolean().default(false),
  addresses: z.array(address).max(32).optional(),
  priority: z.enum(TYPEB_PRIORITIES).optional(),
});

export const typebRouter = router({
  status: adminProcedure.query(({ ctx }) => gatewayStatus(ctx.tenantId)),

  // Station file -------------------------------------------------------------
  listAddresses: adminProcedure.query(({ ctx }) => listAddresses(ctx.tenantId)),
  upsertAddress: adminProcedure
    .input(
      z.object({
        id: id.optional(),
        address,
        stationCode: station.nullable().optional(),
        handlerName: z.string().min(1).max(120),
        messageTypes: z.array(messageType).min(1),
        enabled: z.boolean().optional(),
        notes: z.string().max(500).nullable().optional(),
      })
    )
    .mutation(({ input, ctx }) =>
      guarded(() => upsertAddress(input, ctx.tenantId))
    ),
  removeAddress: adminProcedure
    .input(z.object({ id }))
    .mutation(({ input, ctx }) => removeAddress(input.id, ctx.tenantId)),

  // Queue --------------------------------------------------------------------
  listMessages: adminProcedure
    .input(
      z
        .object({
          direction: z.enum(["outbound", "inbound"]).optional(),
          status: z
            .enum(["queued", "sent", "acked", "failed", "received"])
            .optional(),
          messageType: z.string().max(8).optional(),
          flightId: id.optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .optional()
    )
    .query(({ input, ctx }) => listMessages(input ?? {}, ctx.tenantId)),
  getMessage: adminProcedure
    .input(z.object({ id }))
    .query(({ input, ctx }) => getMessage(input.id, ctx.tenantId)),
  retryMessage: adminProcedure
    .input(z.object({ id }))
    .mutation(({ input, ctx }) =>
      guarded(() => retryTypeBMessage(input.id, ctx.tenantId))
    ),
  acknowledgeMessage: adminProcedure
    .input(
      z.union([
        z.object({ id }),
        z.object({ transportReference: z.string().min(1).max(255) }),
      ])
    )
    .mutation(({ input, ctx }) =>
      guarded(() => acknowledgeTypeBMessage(input, ctx.tenantId))
    ),
  /** Run one scheduler tick now (drain, poll inbound, triggers). */
  runTick: adminProcedure.mutation(() => guarded(() => runTypeBGatewayTick())),

  // Generation ---------------------------------------------------------------
  generatePnl: adminProcedure.input(dispatch).mutation(({ input, ctx }) =>
    guarded(async () => {
      const flight = await loadFlightContext(input.flightId, ctx.tenantId);
      const request = {
        payload: await buildPnlPayload(flight),
        tenantId: flight.tenantId,
        flightId: flight.id,
        addresses: input.addresses,
        stations: stationsFor("PNL", flight.origin, flight.destination),
        priority: input.priority,
        dedupKey: input.enqueue ? `PNL:${flight.id}` : undefined,
      };
      if (!input.enqueue) {
        const preview = await renderTypeBMessage(request);
        return {
          queued: false as const,
          parts: preview.serialized.parts,
          addresses: preview.addresses,
        };
      }
      const result = await enqueueTypeBMessage(request);
      return { queued: true as const, ...result };
    })
  ),
  generateMvt: adminProcedure
    .input(
      dispatch.extend({
        movement: movementInput,
        registration: z.string().min(3).max(10).optional(),
        remarks: z.array(z.string().max(200)).max(5).optional(),
      })
    )
    .mutation(({ input, ctx }) =>
      guarded(async () => {
        const flight = await loadFlightContext(input.flightId, ctx.tenantId);
        const m = input.movement;
        const movement: MvtMovement =
          m.kind === "AD"
            ? {
                kind: "AD",
                offBlocks: m.offBlocks,
                airborne: m.airborne,
                estimatedArrival: m.estimatedArrival,
                destination: flight.destination,
                delays: m.delays,
                passengers: m.passengers
                  ? m.passengers.length === 1
                    ? { total: m.passengers[0] }
                    : { byClass: m.passengers }
                  : undefined,
              }
            : m;
        const request = {
          payload: buildMvtPayload(flight, movement, {
            registration: input.registration,
            remarks: input.remarks,
          }),
          tenantId: flight.tenantId,
          flightId: flight.id,
          addresses: input.addresses,
          stations: stationsFor("MVT", flight.origin, flight.destination),
          priority: input.priority,
        };
        if (!input.enqueue) {
          const preview = await renderTypeBMessage(request);
          return {
            queued: false as const,
            parts: preview.serialized.parts,
            addresses: preview.addresses,
          };
        }
        return {
          queued: true as const,
          ...(await enqueueTypeBMessage(request)),
        };
      })
    ),
  generateLdm: adminProcedure
    .input(dispatch.extend({ figures: ldmInput }))
    .mutation(({ input, ctx }) =>
      guarded(async () => {
        const flight = await loadFlightContext(input.flightId, ctx.tenantId);
        const request = {
          payload: await buildLdmPayload(flight, input.figures),
          tenantId: flight.tenantId,
          flightId: flight.id,
          addresses: input.addresses,
          stations: stationsFor("LDM", flight.origin, flight.destination),
          priority: input.priority,
        };
        if (!input.enqueue) {
          const preview = await renderTypeBMessage(request);
          return {
            queued: false as const,
            parts: preview.serialized.parts,
            addresses: preview.addresses,
          };
        }
        return {
          queued: true as const,
          ...(await enqueueTypeBMessage(request)),
        };
      })
    ),
  generateBsm: adminProcedure
    .input(
      dispatch.extend({
        baggageId: id,
        action: z.enum(["CHG", "DEL"]).optional(),
      })
    )
    .mutation(({ input, ctx }) =>
      guarded(async () => {
        const built = await buildBsmPayload(input.baggageId, input.flightId, {
          action: input.action,
        });
        if ("skipped" in built)
          return { queued: false as const, skipped: built.skipped };
        if (ctx.tenantId !== null && built.tenantId !== ctx.tenantId)
          throw new TRPCError({ code: "NOT_FOUND", message: "Bag not found" });
        const flight = await loadFlightContext(built.flightId, built.tenantId);
        const request = {
          payload: built.payload,
          tenantId: built.tenantId,
          flightId: built.flightId,
          addresses: input.addresses,
          stations: stationsFor("BSM", flight.origin, flight.destination),
          priority: input.priority,
        };
        if (!input.enqueue) {
          const preview = await renderTypeBMessage(request);
          return {
            queued: false as const,
            parts: preview.serialized.parts,
            addresses: preview.addresses,
          };
        }
        return {
          queued: true as const,
          ...(await enqueueTypeBMessage(request)),
        };
      })
    ),

  // Inbound ------------------------------------------------------------------
  ingestInbound: publicProcedure
    .input(
      z.object({
        raw: z.string().min(1).max(16000),
        transportReference: z.string().max(255).optional(),
        /** Service token for machine callers; admins may omit it. */
        token: z.string().max(512).optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const admin = ctx.user ? isAdmin(ctx.user.role) : false;
      if (!admin && !tokenMatches(input.token))
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Type B ingest requires an admin session or service token",
        });
      return guarded(() =>
        ingestInboundTypeB({
          raw: input.raw,
          transportReference: input.transportReference ?? null,
          transportId: admin ? "admin-paste" : "service-token",
          tenantId: admin ? ctx.tenantId : null,
        })
      );
    }),
});
