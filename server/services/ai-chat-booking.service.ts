/**
 * AI Chat Booking Service
 *
 * Handles conversational flight booking powered by AI (SkyLink-style)
 * Supports natural language flight search, recommendations, and booking
 */

import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  chatConversations,
  chatMessages,
  bookingSuggestions,
  type ChatConversation,
  type ChatMessage,
  type BookingSuggestion,
} from "../../drizzle/schema";
import { invokeLLM, type Message } from "../_core/llm";
import { searchFlights } from "./flights.service";

// ============================================================================
// Types
// ============================================================================

export interface ChatContext {
  originId?: number;
  destinationId?: number;
  departureDate?: string;
  returnDate?: string;
  passengers?: number;
  cabinClass?: "economy" | "business";
  preferences?: Record<string, unknown>;
}

export interface ChatResponse {
  message: string;
  suggestions?: Array<{
    id: number;
    flightId: number;
    airline: string;
    origin: string;
    destination: string;
    departureTime: string;
    arrivalTime: string;
    price: number;
    cabinClass: string;
    reason?: string;
  }>;
  contextUpdated?: boolean;
  bookingReady?: boolean;
}

export interface StartConversationInput {
  userId: number;
  initialContext?: Partial<ChatContext>;
  sessionId?: string;
}

export interface SendMessageInput {
  conversationId: number;
  userId: number;
  message: string;
}

// ============================================================================
// System Prompts
// ============================================================================

const BOOKING_SYSTEM_PROMPT = `أنت مساعد حجز طيران ذكي لنظام AIS للطيران. مهمتك:

1. مساعدة المستخدمين في البحث عن رحلات حسب تفضيلاتهم
2. شرح الأسعار وفئات المقاعد والمزايا
3. إرشادهم خلال عملية الحجز بطريقة طبيعية
4. الإجابة على أسئلة حول الرحلات والجداول والسياسات

عند استخراج معلومات الرحلة من رسالة المستخدم، أرجع JSON بالتنسيق:
{"intent": "search_flights", "origin": "اسم المدينة", "destination": "اسم المدينة", "date": "YYYY-MM-DD", "passengers": N, "class": "economy|business"}

عند تقديم اقتراحات رحلات، استخدم التنسيق:
<suggestion>
رحلة من [المغادرة] إلى [الوصول] في [التاريخ]
الناقل: [شركة الطيران]، الوقت: [وقت المغادرة]
السعر: [السعر] ريال للراكب
</suggestion>

تحدث بشكل طبيعي بلغة المستخدم (اكتشف من الرسائل).
كن مفيداً ومختصراً وأرشد نحو إتمام الحجز.

You are a smart flight booking assistant for AIS Aviation System. Your role is to:
1. Help users find flights based on their preferences
2. Explain prices, cabin classes, and benefits
3. Guide them through the booking process naturally
4. Answer questions about flights, schedules, and policies

When extracting flight info from user message, return JSON in format:
{"intent": "search_flights", "origin": "city name", "destination": "city name", "date": "YYYY-MM-DD", "passengers": N, "class": "economy|business"}

Speak naturally in the user's language (detect from messages).
Be helpful, concise, and guide towards booking completion.`;

// ============================================================================
// Conversation Management
// ============================================================================

/**
 * Start a new chat conversation for booking
 */
export async function startConversation(
  input: StartConversationInput
): Promise<{ conversationId: number; greeting: string }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Create conversation record
  const [result] = await db.insert(chatConversations).values({
    userId: input.userId,
    status: "active",
    context: input.initialContext || {},
    sessionId: input.sessionId || `session_${Date.now()}`,
    messageCount: 0,
  });

  const conversationId = result.insertId;

  // Generate greeting based on context
  let greeting =
    "مرحباً! أنا مساعد الحجز الذكي. كيف يمكنني مساعدتك اليوم؟\n\nHello! I'm your smart booking assistant. How can I help you today?";

  if (input.initialContext?.originId || input.initialContext?.destinationId) {
    greeting =
      "مرحباً! أرى أنك تبحث عن رحلة. دعني أساعدك في إيجاد أفضل الخيارات.\n\nHi! I see you're looking for a flight. Let me help you find the best options.";
  }

  // Store greeting as system message
  await db.insert(chatMessages).values({
    conversationId,
    role: "assistant",
    content: greeting,
  });

  await db
    .update(chatConversations)
    .set({ messageCount: 1, lastMessageAt: new Date() })
    .where(eq(chatConversations.id, conversationId));

  return { conversationId, greeting };
}

/**
 * Send a message in an existing conversation
 */
export async function sendMessage(
  input: SendMessageInput
): Promise<ChatResponse> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get conversation
  const [conversation] = await db
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.id, input.conversationId),
        eq(chatConversations.userId, input.userId)
      )
    );

  if (!conversation) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Conversation not found",
    });
  }

  if (conversation.status !== "active") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Conversation is no longer active",
    });
  }

  // Store user message
  await db.insert(chatMessages).values({
    conversationId: input.conversationId,
    role: "user",
    content: input.message,
  });

  // Get conversation history
  const history = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, input.conversationId))
    .orderBy(chatMessages.createdAt);

  // Build LLM messages
  const llmMessages: Message[] = [
    { role: "system", content: BOOKING_SYSTEM_PROMPT },
    ...history.map(m => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
  ];

  // Call LLM
  const startTime = Date.now();
  const llmResponse = await invokeLLM({
    messages: llmMessages,
    maxTokens: 1024,
  });
  const processingTime = Date.now() - startTime;

  // Extract response content from LLM result
  let responseContent = "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.";
  if (llmResponse.choices && llmResponse.choices.length > 0) {
    const choice = llmResponse.choices[0];
    if (typeof choice.message.content === "string") {
      responseContent = choice.message.content;
    } else if (Array.isArray(choice.message.content)) {
      const textContent = choice.message.content.find(c => c.type === "text");
      if (textContent && "text" in textContent) {
        responseContent = textContent.text;
      }
    }
  }

  // Parse intent and search if needed
  const { updatedContext, suggestions } = await processResponse(
    db,
    input.conversationId,
    conversation.context as ChatContext,
    input.message,
    responseContent
  );

  // Store assistant message
  await db.insert(chatMessages).values({
    conversationId: input.conversationId,
    role: "assistant",
    content: responseContent,
    processingTimeMs: processingTime,
    metadata:
      suggestions.length > 0
        ? { suggestions: suggestions.map(s => s.id) }
        : undefined,
  });

  // Update conversation
  await db
    .update(chatConversations)
    .set({
      messageCount: conversation.messageCount + 2,
      lastMessageAt: new Date(),
      context: updatedContext,
    })
    .where(eq(chatConversations.id, input.conversationId));

  return {
    message: responseContent,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
    contextUpdated:
      JSON.stringify(updatedContext) !== JSON.stringify(conversation.context),
    bookingReady: isBookingReady(updatedContext),
  };
}

/**
 * Get conversation history
 */
export async function getConversationHistory(
  conversationId: number,
  userId: number
): Promise<ChatMessage[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Verify ownership
  const [conversation] = await db
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.id, conversationId),
        eq(chatConversations.userId, userId)
      )
    );

  if (!conversation) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Conversation not found",
    });
  }

  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(chatMessages.createdAt);
}

/**
 * Get suggestions for a conversation
 */
export async function getConversationSuggestions(
  conversationId: number,
  userId: number
): Promise<BookingSuggestion[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Verify ownership
  const [conversation] = await db
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.id, conversationId),
        eq(chatConversations.userId, userId)
      )
    );

  if (!conversation) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Conversation not found",
    });
  }

  return db
    .select()
    .from(bookingSuggestions)
    .where(eq(bookingSuggestions.conversationId, conversationId))
    .orderBy(desc(bookingSuggestions.createdAt));
}

/**
 * Select a suggestion to proceed with booking
 */
export async function selectSuggestion(
  suggestionId: number,
  userId: number
): Promise<{ flightId: number; cabinClass: string; price: number }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get suggestion with conversation
  const [suggestion] = await db
    .select({
      suggestion: bookingSuggestions,
      conversation: chatConversations,
    })
    .from(bookingSuggestions)
    .innerJoin(
      chatConversations,
      eq(bookingSuggestions.conversationId, chatConversations.id)
    )
    .where(eq(bookingSuggestions.id, suggestionId));

  if (!suggestion || suggestion.conversation.userId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Suggestion not found" });
  }

  if (suggestion.suggestion.selected !== "pending") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Suggestion already processed",
    });
  }

  // Mark as selected
  await db
    .update(bookingSuggestions)
    .set({ selected: "selected", selectedAt: new Date() })
    .where(eq(bookingSuggestions.id, suggestionId));

  return {
    flightId: suggestion.suggestion.flightId,
    cabinClass: suggestion.suggestion.cabinClass,
    price: suggestion.suggestion.totalPrice,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Process LLM response and search for flights if needed
 */
async function processResponse(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  conversationId: number,
  currentContext: ChatContext,
  userMessage: string,
  _aiResponse: string
): Promise<{
  updatedContext: ChatContext;
  suggestions: Array<{
    id: number;
    flightId: number;
    airline: string;
    origin: string;
    destination: string;
    departureTime: string;
    arrivalTime: string;
    price: number;
    cabinClass: string;
    reason?: string;
  }>;
}> {
  const updatedContext = { ...currentContext };
  const suggestions: Array<{
    id: number;
    flightId: number;
    airline: string;
    origin: string;
    destination: string;
    departureTime: string;
    arrivalTime: string;
    price: number;
    cabinClass: string;
    reason?: string;
  }> = [];

  // Try to extract search intent from user message
  const searchIntent = extractSearchIntent(userMessage);

  if (searchIntent) {
    // Update context with extracted info
    if (searchIntent.passengers)
      updatedContext.passengers = searchIntent.passengers;
    if (searchIntent.cabinClass)
      updatedContext.cabinClass = searchIntent.cabinClass;
    if (searchIntent.date) updatedContext.departureDate = searchIntent.date;

    // If we have origin and destination, search for flights
    if (searchIntent.originId && searchIntent.destinationId) {
      updatedContext.originId = searchIntent.originId;
      updatedContext.destinationId = searchIntent.destinationId;

      try {
        const searchResults = await searchFlights({
          originId: searchIntent.originId,
          destinationId: searchIntent.destinationId,
          departureDate: searchIntent.date
            ? new Date(searchIntent.date)
            : new Date(),
        });

        // Get top 3 flights
        const topFlights = searchResults.slice(0, 3);

        for (let i = 0; i < topFlights.length; i++) {
          const flight = topFlights[i];
          const cabinClass = updatedContext.cabinClass || "economy";
          const price =
            cabinClass === "business"
              ? Number(flight.businessPrice)
              : Number(flight.economyPrice);

          // Use nested data from flight object (origin, destination, airline are included)
          const originCity = flight.origin?.city || "Unknown";
          const destCity = flight.destination?.city || "Unknown";
          const airlineName = flight.airline?.name || "Unknown";

          // Store suggestion
          const [suggestionResult] = await db
            .insert(bookingSuggestions)
            .values({
              conversationId,
              flightId: flight.id,
              cabinClass,
              pricePerPerson: price,
              totalPrice: price * (updatedContext.passengers || 1),
              currency: "SAR",
              reason:
                i === 0
                  ? "أفضل سعر متاح"
                  : i === 1
                    ? "وقت مغادرة مناسب"
                    : "خيار بديل",
              rank: i + 1,
              score: 100 - i * 15,
              expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
            });

          suggestions.push({
            id: suggestionResult.insertId,
            flightId: flight.id,
            airline: airlineName,
            origin: originCity,
            destination: destCity,
            departureTime: flight.departureTime.toISOString(),
            arrivalTime: flight.arrivalTime.toISOString(),
            price,
            cabinClass,
            reason:
              i === 0
                ? "أفضل سعر متاح"
                : i === 1
                  ? "وقت مغادرة مناسب"
                  : "خيار بديل",
          });
        }
      } catch (error) {
        console.error("Error searching flights:", error);
      }
    }
  }

  return { updatedContext, suggestions };
}

/**
 * Extract search intent from user message
 */
function extractSearchIntent(message: string): {
  originId?: number;
  destinationId?: number;
  date?: string;
  passengers?: number;
  cabinClass?: "economy" | "business";
} | null {
  const intent: {
    originId?: number;
    destinationId?: number;
    date?: string;
    passengers?: number;
    cabinClass?: "economy" | "business";
  } = {};

  // Extract passengers count
  const passengersMatch = message.match(
    /(\d+)\s*(راكب|مسافر|passenger|person|adult)/i
  );
  if (passengersMatch) {
    intent.passengers = parseInt(passengersMatch[1]);
  }

  // Extract cabin class
  if (message.match(/بزنس|business|درجة رجال الأعمال/i)) {
    intent.cabinClass = "business";
  } else if (message.match(/اقتصادي|economy|سياحية/i)) {
    intent.cabinClass = "economy";
  }

  // Extract date patterns
  const dateMatch = message.match(
    /(\d{4}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}[-/]\d{1,2}[-/]\d{4})/
  );
  if (dateMatch) {
    intent.date = dateMatch[0].replace(/\//g, "-");
  }

  // Check if any useful info was extracted
  if (Object.keys(intent).length > 0) {
    return intent;
  }

  return null;
}

/**
 * Check if context has enough info to proceed with booking
 */
function isBookingReady(context: ChatContext): boolean {
  return !!(
    context.originId &&
    context.destinationId &&
    context.departureDate &&
    (context.passengers || 1) > 0
  );
}

/**
 * Get user's active conversations
 */
export async function getUserConversations(
  userId: number
): Promise<ChatConversation[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return db
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.userId, userId),
        eq(chatConversations.status, "active")
      )
    )
    .orderBy(desc(chatConversations.lastMessageAt));
}

/**
 * Archive old conversations (for cleanup job)
 */
export async function archiveOldConversations(
  olderThanDays: number = 7
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  // Count conversations to archive first
  const toArchive = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.status, "active"),
        eq(chatConversations.lastMessageAt, cutoffDate)
      )
    );

  if (toArchive.length === 0) return 0;

  await db
    .update(chatConversations)
    .set({ status: "archived" })
    .where(
      and(
        eq(chatConversations.status, "active"),
        eq(chatConversations.lastMessageAt, cutoffDate)
      )
    );

  return toArchive.length;
}
