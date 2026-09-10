// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber, structuredValue } from "./primitives";
export const responseContracts = {
  getHistory: z.array(
    z.object({
      id: outputNumber,
      conversationId: outputNumber,
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
      metadata: z
        .object({
          toolCalls: z
            .array(
              z.object({
                name: z.string(),
                arguments: z.record(z.string(), structuredValue),
                result: structuredValue.optional(),
              })
            )
            .optional(),
          suggestions: z.array(outputNumber).optional(),
          intent: z.string().optional(),
          entities: z.record(z.string(), structuredValue).optional(),
        })
        .nullable(),
      tokensUsed: outputNumber.nullable(),
      processingTimeMs: outputNumber.nullable(),
      createdAt: z.date(),
    })
  ),
  startConversation: z.object({
    conversationId: outputNumber,
    greeting: z.string(),
  }),
  sendMessage: z.object({
    message: z.string(),
    suggestions: z
      .union([
        z.undefined(),
        z.array(
          z.object({
            id: outputNumber,
            flightId: outputNumber,
            airline: z.string(),
            origin: z.string(),
            destination: z.string(),
            departureTime: z.string(),
            arrivalTime: z.string(),
            price: outputNumber,
            cabinClass: z.string(),
            reason: z.union([z.undefined(), z.string()]).optional(),
          })
        ),
      ])
      .optional(),
    contextUpdated: z
      .union([z.undefined(), z.literal(false), z.literal(true)])
      .optional(),
    bookingReady: z
      .union([z.undefined(), z.literal(false), z.literal(true)])
      .optional(),
  }),
  getSuggestions: z.array(
    z.object({
      id: outputNumber,
      createdAt: z.date(),
      flightId: outputNumber,
      reason: z.union([z.null(), z.string()]),
      cabinClass: z.enum(["economy", "business"]),
      currency: z.string(),
      totalPrice: outputNumber,
      expiresAt: z.union([z.null(), z.date()]),
      conversationId: outputNumber,
      messageId: z.union([z.null(), outputNumber]),
      pricePerPerson: outputNumber,
      rank: outputNumber,
      score: z.union([z.null(), outputNumber]),
      selected: z.enum(["pending", "rejected", "expired", "selected"]),
      selectedAt: z.union([z.null(), z.date()]),
    })
  ),
  selectSuggestion: z.object({
    flightId: outputNumber,
    cabinClass: z.string(),
    price: outputNumber,
  }),
  myConversations: z.array(
    z.object({
      id: outputNumber,
      status: z.enum(["completed", "active", "expired", "archived"]),
      createdAt: z.date(),
      updatedAt: z.date(),
      bookingId: z.union([z.null(), outputNumber]),
      userId: outputNumber,
      sessionId: z.union([z.null(), z.string()]),
      context: z.union([
        z.null(),
        z.object({
          originId: z.union([z.undefined(), outputNumber]).optional(),
          destinationId: z.union([z.undefined(), outputNumber]).optional(),
          departureDate: z.union([z.undefined(), z.string()]).optional(),
          returnDate: z.union([z.undefined(), z.string()]).optional(),
          passengers: z.union([z.undefined(), outputNumber]).optional(),
          cabinClass: z
            .union([z.undefined(), z.literal("economy"), z.literal("business")])
            .optional(),
          preferences: z
            .union([z.undefined(), z.record(z.string(), structuredValue)])
            .optional(),
        }),
      ]),
      messageCount: outputNumber,
      lastMessageAt: z.union([z.null(), z.date()]),
    })
  ),
  getQuickReplies: z.object({ suggestions: z.array(z.string()) }),
  getConfig: z.object({
    limits: z.object({
      maxMessageLength: outputNumber,
      maxMessagesPerConversation: outputNumber,
      maxConversationsPerUser: outputNumber,
      maxTokensPerRequest: outputNumber,
      minMessageLength: outputNumber,
    }),
    features: z.object({
      suggestedMessages: z.boolean(),
      stopGeneration: z.boolean(),
      piiMasking: z.boolean(),
      contentFiltering: z.boolean(),
    }),
  }),
};
