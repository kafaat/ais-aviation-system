/**
 * AI Chat Booking Router
 *
 * tRPC endpoints for AI-powered conversational booking (SkyLink-style)
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  startConversation,
  sendMessage,
  getConversationHistory,
  getConversationSuggestions,
  selectSuggestion,
  getUserConversations,
} from "../services/ai-chat-booking.service";

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
   */
  sendMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.number(),
        message: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return sendMessage({
        conversationId: input.conversationId,
        userId: ctx.user.id,
        message: input.message,
      });
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
});
