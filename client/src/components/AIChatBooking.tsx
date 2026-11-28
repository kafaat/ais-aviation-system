/**
 * AI Chat Booking Component
 *
 * Conversational interface for booking flights using AI
 * Supports natural language flight search and booking
 */

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { chatSendFailure, type ChatSendStatus } from "@/lib/chat-send-failure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Send,
  Bot,
  User,
  Plane,
  Calendar,
  MessageCircle,
  X,
  Minimize2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { useLocation } from "wouter";
import { ArrivalDayOffset } from "@/components/ArrivalDayOffset";
import {
  dayOffset,
  formatFlightDate,
  formatFlightTime,
} from "@/lib/flight-time";

interface Message {
  unsentDraft?: string;
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
}

interface ChatOperation {
  kind: "start" | "send" | "select";
  epoch: number;
}

interface FlightSuggestion {
  id: number;
  flightId: number;
  airline: string;
  origin: string;
  destination: string;
  /** IANA zones of the airports; absent from older server responses. */
  originTimezone?: string | null;
  destinationTimezone?: string | null;
  departureTime: string;
  arrivalTime: string;
  price: number;
  cabinClass: string;
  reason?: string;
}

interface AIChatBookingProps {
  initialContext?: {
    originId?: number;
    destinationId?: number;
    departureDate?: string;
  };
  onBookingSelect?: (flightId: number, cabinClass: string) => void;
}

export default function AIChatBooking({
  initialContext,
  onBookingSelect,
}: AIChatBookingProps) {
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestions, setSuggestions] = useState<FlightSuggestion[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loadingOperation, setLoadingOperation] = useState<
    ChatOperation["kind"] | null
  >(null);
  const [sendStatus, setSendStatus] = useState<ChatSendStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const isLoading = loadingOperation !== null;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const conversationIdRef = useRef<number | null>(null);
  const conversationEpochRef = useRef(0);
  const localMessageIdRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const transcriptRevisionRef = useRef(0);
  const operationRef = useRef<ChatOperation | null>(null);
  const historyRequestRef = useRef<object | null>(null);

  const utils = trpc.useUtils();
  const startConversation = trpc.aiChat.startConversation.useMutation();
  const sendMessage = trpc.aiChat.sendMessage.useMutation();
  const selectSuggestion = trpc.aiChat.selectSuggestion.useMutation();

  const locale = i18n.language === "ar" ? ar : enUS;

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && !isMinimized) {
      inputRef.current?.focus();
    }
  }, [isOpen, isMinimized]);

  useEffect(() => {
    return () => {
      conversationEpochRef.current += 1;
      conversationIdRef.current = null;
      operationRef.current = null;
      historyRequestRef.current = null;
    };
  }, []);

  const isCurrentOperation = (operation: ChatOperation) =>
    operationRef.current === operation &&
    conversationEpochRef.current === operation.epoch;

  const finishOperation = (operation: ChatOperation) => {
    if (isCurrentOperation(operation)) {
      operationRef.current = null;
      setLoadingOperation(null);
    }
  };

  const invalidateHistoryRead = () => {
    historyRequestRef.current = null;
    setIsRefreshing(false);
    setHistoryError(false);
  };

  const handleRefreshHistory = async () => {
    const id = conversationIdRef.current;
    if (id === null) return;
    const epoch = conversationEpochRef.current;
    const revision = transcriptRevisionRef.current;
    const request = {};
    historyRequestRef.current = request;
    setIsRefreshing(true);
    setHistoryError(false);
    const isCurrent = () =>
      historyRequestRef.current === request &&
      conversationEpochRef.current === epoch &&
      conversationIdRef.current === id &&
      transcriptRevisionRef.current === revision;
    try {
      // Do not attach a fresh local token to an older in-flight cached read.
      const history = await utils.client.aiChat.getHistory.query({
        conversationId: id,
      });
      if (!isCurrent()) return;
      transcriptRevisionRef.current += 1;
      setMessages(previous => [
        ...history.map(row => ({
          id: row.id,
          role: row.role,
          content: row.content,
          createdAt: row.createdAt,
        })),
        ...previous.filter(row => row.unsentDraft !== undefined),
      ]);
      setSuggestions([]);
    } catch {
      if (isCurrent()) setHistoryError(true);
    } finally {
      if (historyRequestRef.current === request) {
        historyRequestRef.current = null;
        setIsRefreshing(false);
      }
    }
  };

  const handleClose = () => {
    // Closing changes only this widget. Any accepted server request may finish.
    conversationEpochRef.current += 1;
    conversationIdRef.current = null;
    operationRef.current = null;
    draftRevisionRef.current += 1;
    transcriptRevisionRef.current += 1;
    invalidateHistoryRead();
    setLoadingOperation(null);
    setIsOpen(false);
    setIsMinimized(false);
  };

  // Start a new conversation
  const handleStartConversation = async () => {
    if (operationRef.current) return;
    const operation: ChatOperation = {
      kind: "start",
      epoch: ++conversationEpochRef.current,
    };
    operationRef.current = operation;
    setLoadingOperation("start");
    try {
      const result = await startConversation.mutateAsync({
        initialContext,
      });
      if (!isCurrentOperation(operation)) return;
      conversationIdRef.current = result.conversationId;
      transcriptRevisionRef.current += 1;
      draftRevisionRef.current += 1;
      setMessages([
        {
          id: --localMessageIdRef.current,
          role: "assistant",
          content: result.greeting,
          createdAt: new Date(),
        },
      ]);
      setSuggestions([]);
      setInputValue("");
      setSendStatus(null);
      setIsOpen(true);
    } catch (_error) {
      if (isCurrentOperation(operation)) toast.error(t("chat.errorStarting"));
    } finally {
      finishOperation(operation);
    }
  };

  // Send a message
  const handleSendMessage = async () => {
    const id = conversationIdRef.current;
    if (!inputValue.trim() || id === null || operationRef.current) return;

    const operation: ChatOperation = {
      kind: "send",
      epoch: conversationEpochRef.current,
    };
    operationRef.current = operation;
    const draftText = inputValue;
    const draftRevision = ++draftRevisionRef.current;
    transcriptRevisionRef.current += 1;
    invalidateHistoryRead();

    const userMessage: Message = {
      id: --localMessageIdRef.current,
      role: "user",
      content: inputValue,
      createdAt: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    setLoadingOperation("send");
    setSendStatus(null);

    try {
      const response = await sendMessage.mutateAsync({
        conversationId: id,
        message: draftText,
      });
      if (!isCurrentOperation(operation)) return;

      const assistantMessage: Message = {
        id: --localMessageIdRef.current,
        role: "assistant",
        content: response.message,
        createdAt: new Date(),
      };

      transcriptRevisionRef.current += 1;
      setMessages(prev => [...prev, assistantMessage]);

      if (response.suggestions) {
        setSuggestions(response.suggestions);
      }
    } catch (error) {
      if (!isCurrentOperation(operation)) return;
      const failure = chatSendFailure(error);
      if (failure.unaccepted) {
        const restore = draftRevisionRef.current === draftRevision;
        if (restore) {
          draftRevisionRef.current += 1;
          setInputValue(draftText);
        }
        setMessages(previous =>
          previous.flatMap(row =>
            row.id !== userMessage.id
              ? [row]
              : restore
                ? []
                : [{ ...row, unsentDraft: draftText }]
          )
        );
      }
      setSendStatus(failure.status);
      if (failure.reconcile) void handleRefreshHistory();
    } finally {
      finishOperation(operation);
    }
  };

  const handleRestoreDraft = (message: Message) => {
    if (
      message.unsentDraft === undefined ||
      inputValue.length > 0 ||
      operationRef.current
    )
      return;
    draftRevisionRef.current += 1;
    setInputValue(message.unsentDraft);
    setMessages(previous => previous.filter(row => row.id !== message.id));
    inputRef.current?.focus();
  };

  // Handle suggestion selection
  const handleSelectSuggestion = async (suggestion: FlightSuggestion) => {
    if (operationRef.current) return;
    const operation: ChatOperation = {
      kind: "select",
      epoch: conversationEpochRef.current,
    };
    operationRef.current = operation;
    setLoadingOperation("select");
    try {
      const result = await selectSuggestion.mutateAsync({
        suggestionId: suggestion.id,
      });
      if (!isCurrentOperation(operation)) return;

      if (onBookingSelect) {
        onBookingSelect(result.flightId, result.cabinClass);
      } else {
        // Navigate to booking page
        navigate(`/booking/${result.flightId}?class=${result.cabinClass}`);
      }

      toast.success(t("chat.bookingSelected"));
    } catch (_error) {
      if (isCurrentOperation(operation)) toast.error(t("chat.errorSelecting"));
    } finally {
      finishOperation(operation);
    }
  };

  // Handle keyboard submit
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Format price
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat(i18n.language === "ar" ? "ar-SA" : "en-SA", {
      style: "currency",
      currency: "SAR",
      minimumFractionDigits: 0,
    }).format(price / 100);
  };

  // Render message content
  const renderMessage = (message: Message) => {
    const isUser = message.role === "user";

    return (
      <div
        key={message.id}
        className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
      >
        <div
          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          }`}
        >
          {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
        </div>
        <div
          className={`max-w-[80%] rounded-lg px-4 py-2 ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          }`}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          {message.unsentDraft !== undefined && (
            <div className="mt-2 text-xs">
              <p>{t("aiChat.notSent")}</p>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-inherit underline"
                disabled={isLoading || inputValue.length > 0}
                onClick={() => handleRestoreDraft(message)}
              >
                {t("aiChat.restoreDraft")}
              </Button>
            </div>
          )}
          <span className="text-xs opacity-70 mt-1 block">
            {format(message.createdAt, "HH:mm", { locale })}
          </span>
        </div>
      </div>
    );
  };

  // Render flight suggestion card
  const renderSuggestion = (suggestion: FlightSuggestion) => (
    <Card
      key={suggestion.id}
      role="button"
      tabIndex={isLoading ? -1 : 0}
      aria-disabled={isLoading}
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => handleSelectSuggestion(suggestion)}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void handleSelectSuggestion(suggestion);
        }
      }}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <Badge variant="secondary">{suggestion.airline}</Badge>
          <Badge
            variant={
              suggestion.cabinClass === "business" ? "default" : "outline"
            }
          >
            {suggestion.cabinClass === "business"
              ? t("cabin.business")
              : t("cabin.economy")}
          </Badge>
        </div>

        <div className="flex items-center gap-4 mb-3">
          <div className="text-center">
            <p className="text-lg font-bold">
              {formatFlightTime(
                suggestion.departureTime,
                suggestion.originTimezone
              )}
            </p>
            <p className="text-xs text-muted-foreground">{suggestion.origin}</p>
          </div>

          <div className="flex-1 flex items-center gap-2">
            <div className="flex-1 h-px bg-border" />
            <Plane className="w-4 h-4 text-muted-foreground" />
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="text-center">
            <p className="text-lg font-bold">
              {formatFlightTime(
                suggestion.arrivalTime,
                suggestion.destinationTimezone
              )}
              <ArrivalDayOffset
                offset={dayOffset(
                  suggestion.departureTime,
                  suggestion.originTimezone,
                  suggestion.arrivalTime,
                  suggestion.destinationTimezone
                )}
              />
            </p>
            <p className="text-xs text-muted-foreground">
              {suggestion.destination}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="w-4 h-4" />
            <span>
              {formatFlightDate(
                suggestion.departureTime,
                suggestion.originTimezone,
                i18n.language,
                { day: "2-digit", month: "short" }
              )}
            </span>
          </div>
          <p className="text-lg font-bold text-primary">
            {formatPrice(suggestion.price)}
          </p>
        </div>

        {suggestion.reason && (
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <span className="text-yellow-500">★</span>
            {suggestion.reason}
          </p>
        )}
      </CardContent>
    </Card>
  );

  // Chat button (when closed)
  if (!isOpen) {
    return (
      <Button
        onClick={handleStartConversation}
        aria-label={t("aiChat.startConversation")}
        disabled={isLoading}
        className="fixed bottom-6 right-6 rounded-full w-14 h-14 shadow-lg z-50"
        size="icon"
      >
        {isLoading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-current border-t-transparent" />
        ) : (
          <MessageCircle className="w-6 h-6" />
        )}
      </Button>
    );
  }

  // Minimized chat
  if (isMinimized) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={t("aiChat.reopenChat")}
        className="fixed bottom-6 right-6 bg-card rounded-lg shadow-lg z-50 cursor-pointer"
        onClick={() => setIsMinimized(false)}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsMinimized(false);
          }
        }}
      >
        <div className="flex items-center gap-3 p-4">
          <Bot className="w-6 h-6 text-primary" />
          <span className="font-medium">{t("chat.title")}</span>
          <Badge variant="secondary">{messages.length}</Badge>
        </div>
      </div>
    );
  }

  // Full chat interface
  return (
    <div className="fixed bottom-6 right-6 w-96 max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-6rem)] bg-card rounded-lg shadow-xl z-50 flex flex-col overflow-hidden border">
      {/* Header */}
      <CardHeader className="py-3 px-4 border-b flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">{t("chat.title")}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t("aiChat.minimizeChat")}
              onClick={() => setIsMinimized(true)}
            >
              <Minimize2 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t("aiChat.closeChat")}
              onClick={handleClose}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Messages */}
      <ScrollArea
        className="flex-1 p-4"
        role="log"
        aria-label={t("aiChat.conversationLog")}
      >
        <div className="space-y-4">
          {messages.map(renderMessage)}

          {loadingOperation === "send" && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
              <div className="space-y-2">
                <p role="status" className="text-xs text-muted-foreground">
                  {t("aiChat.waiting")}
                </p>
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="border-t p-4 space-y-3 max-h-64 overflow-y-auto">
          <p className="text-sm font-medium text-muted-foreground">
            {t("chat.suggestions")}
          </p>
          {suggestions.map(renderSuggestion)}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t flex-shrink-0">
        {sendStatus && (
          <p role="status" className="mb-2 text-sm">
            {t(`aiChat.${sendStatus}`)}
          </p>
        )}
        {historyError && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {t("aiChat.refreshFailed")}
          </p>
        )}
        {loadingOperation === "select" && (
          <p role="status" className="mb-2 text-sm">
            {t("aiChat.selectingFlight")}
          </p>
        )}
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={e => {
              draftRevisionRef.current += 1;
              setInputValue(e.target.value);
            }}
            onKeyPress={handleKeyPress}
            placeholder={t("chat.placeholder")}
            aria-label={t("aiChat.messageLabel")}
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            onClick={handleSendMessage}
            aria-label={t("aiChat.sendMessage")}
            disabled={!inputValue.trim() || isLoading}
            size="icon"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <Button
          type="button"
          variant="link"
          className="mt-2 h-auto p-0 text-xs"
          disabled={isLoading || isRefreshing}
          onClick={() => void handleRefreshHistory()}
        >
          {isRefreshing
            ? t("aiChat.refreshingHistory")
            : t("aiChat.refreshHistory")}
        </Button>
      </div>
    </div>
  );
}
