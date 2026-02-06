/**
 * AI Chat Booking Router
 *
 * tRPC endpoints for AI-powered conversational booking (SkyLink-style)
 * Includes guardrails: PII masking, content filtering, message validation
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import {
  startConversation,
  sendMessage,
  getConversationHistory,
  getConversationSuggestions,
  selectSuggestion,
  getUserConversations,
} from "../services/ai-chat-booking.service";
import {
  validateMessage,
  sanitizeResponse,
  getSuggestedMessages,
  AI_LIMITS,
} from "../services/ai-guardrails.service";

export const aiChatRouter = router({
  /**
   * Start a new booking conversation
   */
  startConversation: protectedProcedure
    .input(
      z
        .object({
          initialContext: z
            .object({
              originId: z.number().optional(),
              destinationId: z.number().optional(),
              departureDate: z.string().optional(),
              returnDate: z.string().optional(),
              passengers: z.number().min(1).max(9).optional(),
              cabinClass: z.enum(["economy", "business"]).optional(),
            })
            .optional(),
          sessionId: z.string().optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      return startConversation({
        userId: ctx.user.id,
        initialContext: input?.initialContext,
        sessionId: input?.sessionId,
      });
    }),

  /**
   * Send a message in an existing conversation
   * Applies guardrails: validation, PII masking, content filtering
   */
  sendMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.number(),
        message: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Apply guardrails: validate and sanitize message
      const validation = validateMessage(input.message);
      if (!validation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: validation.error || "Invalid message",
        });
      }

      // Send sanitized message (PII masked)
      const result = await sendMessage({
        conversationId: input.conversationId,
        userId: ctx.user.id,
        message: validation.sanitized,
      });

      // Sanitize AI response before returning
      return {
        ...result,
        message: sanitizeResponse(result.message),
      };
    }),

  /**
   * Get conversation history
   */
  getHistory: protectedProcedure
    .input(
      z.object({
        conversationId: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      return getConversationHistory(input.conversationId, ctx.user.id);
    }),

  /**
   * Get AI suggestions for a conversation
   */
  getSuggestions: protectedProcedure
    .input(
      z.object({
        conversationId: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      return getConversationSuggestions(input.conversationId, ctx.user.id);
    }),

  /**
   * Select a suggestion to proceed with booking
   */
  selectSuggestion: protectedProcedure
    .input(
      z.object({
        suggestionId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return selectSuggestion(input.suggestionId, ctx.user.id);
    }),

  /**
   * Get user's active conversations
   */
  myConversations: protectedProcedure.query(async ({ ctx }) => {
    return getUserConversations(ctx.user.id);
  }),

  /**
   * Get suggested quick-reply messages based on conversation context
   */
  getQuickReplies: protectedProcedure
    .input(
      z
        .object({
          context: z
            .object({
              originId: z.number().optional(),
              destinationId: z.number().optional(),
              departureDate: z.string().optional(),
              passengers: z.number().optional(),
            })
            .optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      return {
        suggestions: getSuggestedMessages(input?.context),
      };
    }),

  /**
   * Get AI chat configuration (limits, features)
   */
  getConfig: protectedProcedure.query(() => {
    return {
      limits: AI_LIMITS,
      features: {
        suggestedMessages: true,
        stopGeneration: true,
        piiMasking: true,
        contentFiltering: true,
      },
    };
  }),
});
