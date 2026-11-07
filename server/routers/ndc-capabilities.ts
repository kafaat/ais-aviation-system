import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  capabilityRowInput,
  capabilityRowOutput,
  capabilitySummaryOutput,
  deleteDistributionCapability,
  distributionActionEnum,
  distributionChannelEnum,
  distributionCombinationInput,
  listDistributionCapabilities,
  resolveDistributionCapabilities,
  upsertDistributionCapability,
} from "../services/ndc-capability-matrix";

/**
 * Distribution capability matrix: admin CRUD over `distribution_capabilities`
 * and a read model that resolves every servicing action for one
 * carrier/seller/channel/schema-version combination.
 */
export const ndcCapabilitiesRouter = router({
  resolve: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/ndc/capabilities/resolve",
        tags: ["NDC"],
        summary:
          "Resolve servicing capabilities for a distribution combination",
        description:
          "Returns, for every servicing action, whether the carrier/seller/channel/schema-version combination authorizes it, with the matrix precedence and evidence. Unconfirmed or unknown combinations are not allowed.",
        protect: true,
      },
    })
    .input(distributionCombinationInput)
    .output(capabilitySummaryOutput)
    .query(({ input }) => resolveDistributionCapabilities(input)),
  list: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/ndc/admin/capabilities",
        tags: ["NDC", "Admin"],
        summary: "List distribution capability rows",
        description:
          "Seeded baseline merged with stored rows; stored rows replace the seeded row with the same combination.",
        protect: true,
      },
    })
    .input(
      z.object({
        channel: distributionChannelEnum.optional(),
        action: distributionActionEnum.optional(),
        carrierCode: z.string().trim().max(3).optional(),
        includeSeeds: z.boolean().default(true),
      })
    )
    .output(z.array(capabilityRowOutput))
    .query(({ input }) => listDistributionCapabilities(input)),
  upsert: adminProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/ndc/admin/capabilities",
        tags: ["NDC", "Admin"],
        summary: "Create or update a distribution capability row",
        description:
          "A confirmed row needs an evidence URL or note. The row replaces the seeded row with the same combination.",
        protect: true,
      },
    })
    .input(capabilityRowInput)
    .output(capabilityRowOutput)
    .mutation(({ input, ctx }) =>
      upsertDistributionCapability(input, ctx.user.id)
    ),
  remove: adminProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/ndc/admin/capabilities/{id}",
        tags: ["NDC", "Admin"],
        summary: "Delete a stored distribution capability row",
        description:
          "Removes the stored override; the seeded baseline for that combination applies again.",
        protect: true,
      },
    })
    .input(z.object({ id: z.number().int().positive() }))
    .output(z.object({ deleted: z.literal(true), id: z.number().int() }))
    .mutation(({ input }) => deleteDistributionCapability(input.id)),
});
