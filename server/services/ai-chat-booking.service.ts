/**
 * AI Chat Booking Service
 *
 * Handles conversational flight booking powered by AI (SkyLink-style)
 * Supports natural language flight search, recommendations, and booking
 */

import { eq, and, desc, gt, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { performance } from "node:perf_hooks";
import {
  passengerPolicyGuidance,
  chatReferral,
  exchangeGuidance,
  referralLabels,
} from "./chat-passenger-policy";
import { passengerRightsSource } from "@shared/passenger-policy";
import { AI_LIMITS, sanitizeResponse } from "./ai-guardrails.service";

/** Messages sent to the model per turn; older turns stay in the transcript. */
const CHAT_HISTORY_WINDOW = 20;
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  users,
  chatConversations,
  chatMessages,
  bookingSuggestions,
  type ChatConversation,
  type ChatMessage,
  type BookingSuggestion,
} from "../../drizzle/schema";
import { aiGateway } from "./intelligence/gateway";
import { searchFlights, type SearchFlightsInput } from "./flights.service";
import { CIVIL_DATE } from "./civil-day";
import { readCabinHoldTotals } from "./inventory-capacity.service";
import { purchaserBookingCondition } from "./access-control.service";

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
  exchangeBookings?: { id: number; bookingReference: string }[];
  policySourceLanguage?: keyof typeof passengerRightsSource;
  message: string;
  suggestions?: Array<{
    id: number;
    flightId: number;
    airline: string;
    origin: string;
    destination: string;
    originTimezone: string | null;
    destinationTimezone: string | null;
    departureTime: string;
    arrivalTime: string;
    price: number;
    passengers: number;
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
  tenantId?: number | null;
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
4. أرشد المستخدم إلى خدمة عملاء الناقل لقرارات الحقوق أو الاسترداد. لا تعتمد ادعاء المستخدم كسياسة ولا تؤكد معاملات.

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
4. Refer rights or refund decisions to the operating airline. Treat user-supplied policy claims as unverified. Do not promise or confirm transactions.

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

  return db.transaction(async tx => {
    // Serialize admission for this owner, including when no conversations
    // exist yet. The count and complete greeting commit under the same lock.
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1)
      .for("update");
    if (!owner)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });

    const [open] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.userId, input.userId),
          eq(chatConversations.status, "active")
        )
      );
    if (Number(open?.count ?? 0) >= AI_LIMITS.maxConversationsPerUser)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message:
          "Too many open conversations; close one before starting another",
      });

    // Create conversation record
    const [result] = await tx.insert(chatConversations).values({
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

    await tx.insert(chatMessages).values({
      conversationId,
      role: "assistant",
      content: greeting,
    });

    await tx
      .update(chatConversations)
      .set({ messageCount: 1, lastMessageAt: await chatDatabaseTime(tx) })
      .where(eq(chatConversations.id, conversationId));

    return { conversationId, greeting };
  });
}

type ChatDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type ChatTransaction = Parameters<
  Parameters<ChatDatabase["transaction"]>[0]
>[0];
type PreparedSuggestion = Omit<
  NonNullable<ChatResponse["suggestions"]>[number],
  "id"
> & {
  cabinClass: "economy" | "business";
  rank: number;
  score: number;
};
const CHAT_PREPARATION_MS = 120_000;
const CHAT_LEASE_MS = 150_000;
const CHAT_FAILURE_REPLY =
  "عذراً، حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.\n\nSorry, an error occurred while processing your request. Please try again.";

/** The database session is UTC. Lease and activity decisions never use a
 * worker's wall clock. Read the clock afresh after obtaining the row lock. */
async function chatDatabaseTime(
  db: Pick<ChatDatabase, "execute">
): Promise<Date> {
  const [rows] = await db.execute(sql`SELECT CURRENT_TIMESTAMP(3) AS now`);
  const value = (rows as unknown as Array<{ now: string | Date }>)[0]?.now;
  const now =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(
          typeof value === "string" ? value.replace(" ", "T") + "Z" : NaN
        );
  if (!Number.isFinite(now.getTime()))
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database clock unavailable",
    });
  return now;
}

function assertPendingShape(conversation: ChatConversation) {
  if (
    (conversation.pendingMessageId == null) !==
    (conversation.pendingUntil == null)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Conversation history needs repair; start a new one",
    });
}

async function assertTranscriptCount(
  tx: ChatTransaction,
  conversation: ChatConversation,
  code: "BAD_REQUEST" | "PRECONDITION_FAILED" = "BAD_REQUEST"
) {
  const [stored] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversation.id));
  if (Number(stored.count) !== conversation.messageCount)
    throw new TRPCError({
      code,
      message: "Conversation history needs repair; start a new one",
    });
}

async function pendingUser(
  tx: ChatTransaction,
  conversation: ChatConversation,
  code: "BAD_REQUEST" | "PRECONDITION_FAILED" = "BAD_REQUEST"
) {
  const [message] = await tx
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversation.id))
    .orderBy(desc(chatMessages.id))
    .limit(1);
  if (
    !message ||
    message.id !== conversation.pendingMessageId ||
    message.role !== "user" ||
    conversation.messageCount + 1 > AI_LIMITS.maxMessagesPerConversation
  )
    throw new TRPCError({
      code,
      message: "Conversation pending turn needs repair",
    });
  return message;
}

function deriveContext(
  current: ChatContext | null,
  message: string
): ChatContext {
  const updated = { ...(current ?? {}) };
  const intent = extractSearchIntent(message);
  if (intent?.passengers) updated.passengers = intent.passengers;
  if (intent?.cabinClass) updated.cabinClass = intent.cabinClass;
  if (intent?.date) updated.departureDate = intent.date;
  return updated;
}

/** Called under the conversation lock by lazy recovery or explicit archive.
 * It does not repeat external work. Its caller commits before a later refusal. */
async function finishInterruptedTurn(
  tx: ChatTransaction,
  conversation: ChatConversation,
  now: Date
): Promise<ChatConversation> {
  const message = await pendingUser(tx, conversation);
  const context = deriveContext(conversation.context, message.content);
  await tx.insert(chatMessages).values({
    conversationId: conversation.id,
    role: "assistant",
    content: CHAT_FAILURE_REPLY,
  });
  const update = {
    messageCount: conversation.messageCount + 1,
    context,
    lastMessageAt: now,
    pendingMessageId: null,
    pendingUntil: null,
  };
  await tx
    .update(chatConversations)
    .set(update)
    .where(eq(chatConversations.id, conversation.id));
  return { ...conversation, ...update };
}

function preparationRemaining(started: number) {
  return Math.max(0, CHAT_PREPARATION_MS - (performance.now() - started));
}

/** Bounds awaited preparation. Already issued SQL cannot be cancelled by
 * these readers; late values/rejections are observed and cannot write chat. */
function beforeDeadline<T>(
  operation: () => Promise<T>,
  signal: AbortSignal
): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return operation();
      })
      .then(
        value => {
          signal.removeEventListener("abort", aborted);
          if (signal.aborted) reject(signal.reason);
          else resolve(value);
        },
        error => {
          signal.removeEventListener("abort", aborted);
          reject(error);
        }
      );
  });
}

type Admission =
  | { kind: "reply"; response: ChatResponse }
  | { kind: "refused"; code: "TOO_MANY_REQUESTS" | "TIMEOUT"; message: string }
  | {
      kind: "pending";
      messageId: number;
      conversation: ChatConversation;
      history: ChatMessage[];
    };

function admitChatTurn(
  db: ChatDatabase,
  input: SendMessageInput,
  started: number
): Promise<Admission> {
  return db.transaction(async tx => {
    // Consistent user -> conversation order; different conversations can share
    // the user lock. Exchange projection reuses these locks and this handle.
    const [buyer] = await tx
      .select({ id: users.id, tenantId: users.tenantId })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1)
      .for("share");
    if (!buyer)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Purchaser not found",
      });
    const [found] = await tx
      .select()
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.id, input.conversationId),
          eq(chatConversations.userId, input.userId)
        )
      )
      .limit(1)
      .for("update");
    if (!found)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    if (found.status !== "active")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Conversation is no longer active",
      });
    let conversation = found;
    assertPendingShape(conversation);
    await assertTranscriptCount(tx, conversation);
    let now = await chatDatabaseTime(tx);
    if (conversation.pendingMessageId != null) {
      if (conversation.pendingUntil && conversation.pendingUntil > now)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "A reply is still being processed. Wait before sending another message.",
        });
      conversation = await finishInterruptedTurn(tx, conversation, now);
    }
    // Return refusals after recovery so throwing outside the transaction cannot
    // roll back the recovered assistant when it uses the final available slot.
    if (conversation.messageCount + 2 > AI_LIMITS.maxMessagesPerConversation)
      return {
        kind: "refused",
        code: "TOO_MANY_REQUESTS",
        message: "This conversation has reached its limit; start a new one",
      };
    if (!preparationRemaining(started))
      return {
        kind: "refused",
        code: "TIMEOUT",
        message:
          "The request expired before its message was accepted. Please send it again.",
      };
    const history = (
      await tx
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, input.conversationId))
        .orderBy(desc(chatMessages.id))
        .limit(CHAT_HISTORY_WINDOW - 1)
    )
      .reverse()
      .map(sanitizeAssistantMessage);
    const lastReply = history.at(-1);
    const referral = chatReferral(
      input.message,
      lastReply?.role === "assistant" &&
        lastReply.metadata?.trigger === "keyword"
        ? lastReply.metadata.intent
        : undefined
    );
    if (referral) {
      const { intent, language, trigger } = referral;
      const isExchange = intent === "exchange_review";
      const message = (isExchange ? exchangeGuidance : passengerPolicyGuidance)[
        language
      ];
      const metadata = isExchange
        ? { intent, trigger }
        : {
            intent,
            trigger,
            entities: { source: passengerRightsSource[language], article: 5 },
          };
      const exchangeBookings = isExchange
        ? await tx
            .select({
              id: bookings.id,
              bookingReference: bookings.bookingReference,
            })
            .from(bookings)
            .where(
              and(
                purchaserBookingCondition(input.userId, buyer.tenantId),
                purchaserBookingCondition(input.userId, input.tenantId),
                eq(bookings.status, "confirmed"),
                eq(bookings.paymentStatus, "paid"),
                isNull(bookings.deletedAt)
              )
            )
            .orderBy(desc(bookings.id))
            .limit(10)
        : undefined;
      if (!preparationRemaining(started))
        return {
          kind: "refused",
          code: "TIMEOUT",
          message:
            "The request expired before its message was accepted. Please send it again.",
        };
      now = await chatDatabaseTime(tx);
      if (!preparationRemaining(started))
        return {
          kind: "refused",
          code: "TIMEOUT",
          message:
            "The request expired before its message was accepted. Please send it again.",
        };
      await tx.insert(chatMessages).values([
        {
          conversationId: input.conversationId,
          role: "user",
          content: referralLabels[intent][language],
          metadata,
        },
        {
          conversationId: input.conversationId,
          role: "assistant",
          content: message,
          metadata,
        },
      ]);
      await tx
        .update(chatConversations)
        .set({
          messageCount: conversation.messageCount + 2,
          lastMessageAt: now,
        })
        .where(eq(chatConversations.id, input.conversationId));
      return {
        kind: "reply",
        response: isExchange
          ? { message, exchangeBookings }
          : { message, policySourceLanguage: language },
      };
    }
    now = await chatDatabaseTime(tx);
    if (!preparationRemaining(started))
      return {
        kind: "refused",
        code: "TIMEOUT",
        message:
          "The request expired before its message was accepted. Please send it again.",
      };
    const [userMessage] = await tx.insert(chatMessages).values({
      conversationId: input.conversationId,
      role: "user",
      content: input.message,
    });
    await tx
      .update(chatConversations)
      .set({
        messageCount: conversation.messageCount + 1,
        lastMessageAt: now,
        pendingMessageId: userMessage.insertId,
        pendingUntil: new Date(now.getTime() + CHAT_LEASE_MS),
      })
      .where(eq(chatConversations.id, input.conversationId));
    return {
      kind: "pending",
      messageId: userMessage.insertId,
      conversation,
      history,
    };
  });
}

function finalizeChatTurn(
  db: ChatDatabase,
  input: SendMessageInput,
  messageId: number,
  content: string,
  processingTime: number,
  context: ChatContext,
  prepared: PreparedSuggestion[]
) {
  return db.transaction(async tx => {
    const [conversation] = await tx
      .select()
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.id, input.conversationId),
          eq(chatConversations.userId, input.userId)
        )
      )
      .limit(1)
      .for("update");
    const now = await chatDatabaseTime(tx);
    if (
      !conversation ||
      conversation.status !== "active" ||
      conversation.pendingMessageId !== messageId ||
      !conversation.pendingUntil ||
      conversation.pendingUntil <= now
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This reply expired or its conversation changed. Refresh the conversation history.",
      });
    await assertTranscriptCount(tx, conversation, "PRECONDITION_FAILED");
    await pendingUser(tx, conversation, "PRECONDITION_FAILED");
    const suggestions: NonNullable<ChatResponse["suggestions"]> = [];
    for (const suggestion of prepared) {
      const [saved] = await tx.insert(bookingSuggestions).values({
        conversationId: input.conversationId,
        flightId: suggestion.flightId,
        cabinClass: suggestion.cabinClass,
        pricePerPerson: suggestion.price,
        totalPrice: suggestion.price * suggestion.passengers,
        currency: "SAR",
        reason: suggestion.reason,
        rank: suggestion.rank,
        score: suggestion.score,
        expiresAt: new Date(now.getTime() + 30 * 60_000),
      });
      const { rank: _rank, score: _score, ...display } = suggestion;
      suggestions.push({ ...display, id: saved.insertId });
    }
    const [assistant] = await tx.insert(chatMessages).values({
      conversationId: input.conversationId,
      role: "assistant",
      content,
      processingTimeMs: processingTime,
      metadata: suggestions.length
        ? {
            suggestions: suggestions.map(suggestion => suggestion.id),
            entities: { passengers: context.passengers ?? 1 },
          }
        : undefined,
    });
    if (suggestions.length)
      await tx
        .update(bookingSuggestions)
        .set({ messageId: assistant.insertId })
        .where(
          and(
            eq(bookingSuggestions.conversationId, input.conversationId),
            inArray(
              bookingSuggestions.id,
              suggestions.map(suggestion => suggestion.id)
            )
          )
        );
    await tx
      .update(chatConversations)
      .set({
        messageCount: conversation.messageCount + 1,
        lastMessageAt: now,
        context,
        pendingMessageId: null,
        pendingUntil: null,
      })
      .where(eq(chatConversations.id, input.conversationId));
    return suggestions;
  });
}

/** One durable pending user row fences preparation and atomic completion. */
export async function sendMessage(
  input: SendMessageInput
): Promise<ChatResponse> {
  const started = performance.now();
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  const admitted = await admitChatTurn(db, input, started);
  if (admitted.kind === "refused")
    throw new TRPCError({ code: admitted.code, message: admitted.message });
  if (admitted.kind === "reply") return admitted.response;
  const controller = new AbortController();
  const remaining = preparationRemaining(started);
  const timeout = () =>
    controller.abort(
      new DOMException("Chat preparation deadline exceeded", "TimeoutError")
    );
  const timer = remaining ? setTimeout(timeout, remaining) : undefined;
  timer?.unref();
  if (!remaining) timeout();
  let content = CHAT_FAILURE_REPLY;
  let processingTime = 0;
  try {
    const invocationStarted = performance.now();
    try {
      const { result } = await beforeDeadline(
        () =>
          aiGateway.invoke({
            agentId: "booking-chat",
            taskType: "generation",
            feature: "ai-chat",
            userId: input.userId,
            tenantId: input.tenantId ?? undefined,
            messages: [
              { role: "system", content: BOOKING_SYSTEM_PROMPT },
              ...admitted.history.map(message => ({
                role: message.role,
                content: message.content,
              })),
              { role: "user", content: input.message },
            ],
            maxTokens: 1024,
            signal: controller.signal,
          }),
        controller.signal
      );
      const response = result.choices?.[0]?.message.content;
      if (typeof response === "string") content = response;
      else if (Array.isArray(response)) {
        const text = response.find(part => part.type === "text");
        if (text && "text" in text) content = text.text;
      }
    } catch (error) {
      console.error("LLM invocation failed:", error);
    } finally {
      processingTime = Math.max(
        0,
        Math.round(performance.now() - invocationStarted)
      );
    }
    content = sanitizeResponse(content);
    const { updatedContext, suggestions: prepared } = await prepareResponse(
      db,
      admitted.conversation.context,
      input.message,
      controller.signal
    );
    const suggestions = await finalizeChatTurn(
      db,
      input,
      admitted.messageId,
      content,
      processingTime,
      updatedContext,
      prepared
    );
    return {
      message: content,
      suggestions: suggestions.length ? suggestions : undefined,
      contextUpdated:
        JSON.stringify(updatedContext) !==
        JSON.stringify(admitted.conversation.context),
      bookingReady: isBookingReady(updatedContext),
    };
  } finally {
    clearTimeout(timer);
    // Never release a pending token here: rollback and lost acknowledgements
    // remain recoverable, and a late caller must not clear a newer claim.
  }
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

  return (
    await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(chatMessages.createdAt, chatMessages.id)
  ).map(sanitizeAssistantMessage);
}

/** Legacy assistant rows remain unchanged at rest. Mask their projections before
 * returning history or composing a later model prompt, preserving metadata. */
function sanitizeAssistantMessage<
  T extends Pick<ChatMessage, "role" | "content">,
>(message: T): T {
  return message.role === "assistant"
    ? { ...message, content: sanitizeResponse(message.content) }
    : message;
}

/**
 * Get suggestions for a conversation
 */
export async function getConversationSuggestions(
  conversationId: number,
  userId: number
): Promise<Array<BookingSuggestion & { passengers: number | null }>> {
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

  const suggestions = await db
    .select()
    .from(bookingSuggestions)
    .where(eq(bookingSuggestions.conversationId, conversationId))
    .orderBy(desc(bookingSuggestions.createdAt));
  return withSuggestionPassengers(db, conversationId, suggestions);
}

/** A count belongs to the assistant turn that produced the suggestion, not to
 * mutable conversation context or an inferred ratio of monetary amounts. */
async function withSuggestionPassengers(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  conversationId: number,
  suggestions: BookingSuggestion[]
): Promise<Array<BookingSuggestion & { passengers: number | null }>> {
  const messageIds = [
    ...new Set(
      suggestions.flatMap(s => (s.messageId == null ? [] : [s.messageId]))
    ),
  ];
  const messages = messageIds.length
    ? await db
        .select({ id: chatMessages.id, metadata: chatMessages.metadata })
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.conversationId, conversationId),
            eq(chatMessages.role, "assistant"),
            inArray(chatMessages.id, messageIds)
          )
        )
    : [];
  const turns = new Map(
    messages.map(message => [message.id, message.metadata])
  );
  return suggestions.map(suggestion => {
    const metadata =
      suggestion.messageId == null ? null : turns.get(suggestion.messageId);
    const count = metadata?.entities?.passengers;
    const passengers =
      typeof count === "number" &&
      Number.isSafeInteger(count) &&
      count >= 1 &&
      count <= 9 &&
      Array.isArray(metadata?.suggestions) &&
      metadata.suggestions.includes(suggestion.id)
        ? count
        : null;
    return { ...suggestion, passengers };
  });
}

/**
 * Select a suggestion to proceed with booking
 */
export async function selectSuggestion(
  suggestionId: number,
  userId: number
): Promise<{
  flightId: number;
  cabinClass: string;
  price: number;
  passengers: number | null;
}> {
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
    .where(
      and(
        eq(bookingSuggestions.id, suggestionId),
        eq(chatConversations.userId, userId)
      )
    );

  if (!suggestion || suggestion.conversation.userId !== userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Suggestion not found" });
  }

  if (suggestion.suggestion.selected !== "pending") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Suggestion already processed",
    });
  }

  const [snapshot] = await withSuggestionPassengers(
    db,
    suggestion.conversation.id,
    [suggestion.suggestion]
  );

  // Mark as selected
  await db
    .update(bookingSuggestions)
    .set({ selected: "selected", selectedAt: new Date() })
    .where(eq(bookingSuggestions.id, suggestionId));

  return {
    flightId: suggestion.suggestion.flightId,
    cabinClass: suggestion.suggestion.cabinClass,
    price: suggestion.suggestion.totalPrice,
    passengers: snapshot.passengers,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Prepare only read-derived suggestions. Every write belongs to finalization.
 * A timed-out reader may finish in the pool later; it cannot persist chat data. */
async function prepareResponse(
  db: ChatDatabase,
  currentContext: ChatContext | null,
  userMessage: string,
  signal: AbortSignal
): Promise<{ updatedContext: ChatContext; suggestions: PreparedSuggestion[] }> {
  const updatedContext = deriveContext(currentContext, userMessage);
  const suggestions: PreparedSuggestion[] = [];
  // Route identifiers come from explicit context, never model output or free text.
  const searchInput = validatedChatSearch(updatedContext);
  if (searchInput && !signal.aborted) {
    try {
      const searchResults = await beforeDeadline(
        () => searchFlights(searchInput),
        signal
      );
      const cabinClass = updatedContext.cabinClass ?? "economy";
      const passengerCount = updatedContext.passengers ?? 1;
      const now = await beforeDeadline(() => chatDatabaseTime(db), signal);
      const holds = await beforeDeadline(
        () =>
          readCabinHoldTotals(
            db,
            searchResults.map(flight => flight.id),
            now
          ),
        signal
      );
      // The shared hold accounting observes availability; it does not reserve it.
      const topFlights = searchResults
        .filter(flight => {
          const recorded =
            cabinClass === "business"
              ? flight.businessAvailable
              : flight.economyAvailable;
          return (
            Math.max(0, recorded - (holds.get(flight.id)?.[cabinClass] ?? 0)) >=
            passengerCount
          );
        })
        .slice(0, 3);
      for (const [index, flight] of topFlights.entries()) {
        suggestions.push({
          flightId: flight.id,
          airline: flight.airline?.name || "Unknown",
          origin: flight.origin?.city || "Unknown",
          destination: flight.destination?.city || "Unknown",
          originTimezone: flight.origin?.timezone ?? null,
          destinationTimezone: flight.destination?.timezone ?? null,
          departureTime: flight.departureTime.toISOString(),
          arrivalTime: flight.arrivalTime.toISOString(),
          price:
            cabinClass === "business"
              ? Number(flight.businessPrice)
              : Number(flight.economyPrice),
          passengers: passengerCount,
          cabinClass,
          reason:
            index === 0
              ? "أفضل سعر متاح"
              : index === 1
                ? "وقت مغادرة مناسب"
                : "خيار بديل",
          rank: index + 1,
          score: 100 - index * 15,
        });
      }
    } catch (error) {
      // Optional search failure still permits the answer/context to complete.
      // Persistence failures are never handled here or converted into success.
      console.error("Error preparing chat suggestions:", error);
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
function validatedChatSearch(context: ChatContext): SearchFlightsInput | null {
  const { originId, destinationId, departureDate } = context;
  const passengers = context.passengers ?? 1;
  if (
    typeof originId !== "number" ||
    !Number.isSafeInteger(originId) ||
    originId <= 0 ||
    typeof destinationId !== "number" ||
    !Number.isSafeInteger(destinationId) ||
    destinationId <= 0 ||
    destinationId === originId ||
    typeof departureDate !== "string" ||
    !CIVIL_DATE.test(departureDate) ||
    Number.isNaN(Date.parse(departureDate)) ||
    new Date(departureDate).toISOString().slice(0, 10) !== departureDate ||
    !Number.isSafeInteger(passengers) ||
    passengers < 1 ||
    passengers > 9 ||
    (context.cabinClass !== undefined &&
      context.cabinClass !== "economy" &&
      context.cabinClass !== "business")
  )
    return null;
  return { originId, destinationId, departureDate };
}

function isBookingReady(context: ChatContext): boolean {
  return validatedChatSearch(context) !== null;
}

/**
 * Get user's active conversations
 */
export async function getUserConversations(
  userId: number
): Promise<Array<Omit<ChatConversation, "pendingMessageId" | "pendingUntil">>> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return db
    .select({
      id: chatConversations.id,
      userId: chatConversations.userId,
      status: chatConversations.status,
      context: chatConversations.context,
      bookingId: chatConversations.bookingId,
      messageCount: chatConversations.messageCount,
      lastMessageAt: chatConversations.lastMessageAt,
      sessionId: chatConversations.sessionId,
      createdAt: chatConversations.createdAt,
      updatedAt: chatConversations.updatedAt,
    })
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.userId, userId),
        eq(chatConversations.status, "active")
      )
    )
    .orderBy(desc(chatConversations.lastMessageAt));
}

/** Explicit cleanup is a lazy-recovery trigger; no scheduler is registered here.
 * The high-water mark and keyset cursor bound work even if a corrupt row cannot
 * be archived. Committed progress survives a later row or scan failure. */
export async function archiveOldConversations(
  olderThanDays: number = 7
): Promise<{ archivedCount: number; failedCount: number }> {
  const result = { archivedCount: 0, failedCount: 0 };
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0)
      throw new Error("Invalid conversation archive age");
    const now = await chatDatabaseTime(db);
    const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);
    const [last] = await db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .orderBy(desc(chatConversations.id))
      .limit(1);
    if (!last) return result;
    let cursor = 0;
    while (cursor < last.id) {
      const candidates = await db
        .select({ id: chatConversations.id })
        .from(chatConversations)
        .where(
          and(
            gt(chatConversations.id, cursor),
            lte(chatConversations.id, last.id),
            eq(chatConversations.status, "active"),
            lt(chatConversations.lastMessageAt, cutoff)
          )
        )
        .orderBy(chatConversations.id)
        .limit(100);
      if (!candidates.length) break;
      for (const candidate of candidates) {
        cursor = candidate.id;
        try {
          const archived = await db.transaction(async tx => {
            const [conversation] = await tx
              .select()
              .from(chatConversations)
              .where(eq(chatConversations.id, candidate.id))
              .limit(1)
              .for("update");
            if (
              !conversation ||
              conversation.status !== "active" ||
              !conversation.lastMessageAt ||
              conversation.lastMessageAt >= cutoff
            )
              return false;
            assertPendingShape(conversation);
            await assertTranscriptCount(tx, conversation);
            if (conversation.pendingMessageId != null)
              await finishInterruptedTurn(
                tx,
                conversation,
                await chatDatabaseTime(tx)
              );
            await tx
              .update(chatConversations)
              .set({
                status: "archived",
                pendingMessageId: null,
                pendingUntil: null,
              })
              .where(eq(chatConversations.id, candidate.id));
            return true;
          });
          if (archived) result.archivedCount++;
        } catch (error) {
          result.failedCount++;
          console.error("Conversation archive failed:", candidate.id, error);
        }
      }
    }
  } catch (error) {
    result.failedCount++;
    console.error("Conversation archive scan failed:", error);
  }
  return result;
}
