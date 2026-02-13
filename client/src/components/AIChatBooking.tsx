/**
 * AI Chat Booking Component
 *
 * Conversational interface for booking flights using AI
 * Supports natural language flight search and booking
 */

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
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

interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
}

interface FlightSuggestion {
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
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestions, setSuggestions] = useState<FlightSuggestion[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Start a new conversation
  const handleStartConversation = async () => {
    try {
      setIsLoading(true);
      const result = await startConversation.mutateAsync({
        initialContext,
      });
      setConversationId(result.conversationId);
      setMessages([
        {
          id: 1,
          role: "assistant",
          content: result.greeting,
          createdAt: new Date(),
        },
      ]);
      setIsOpen(true);
    } catch (_error) {
      toast.error(t("chat.errorStarting"));
    } finally {
      setIsLoading(false);
    }
  };

  // Send a message
  const handleSendMessage = async () => {
    if (!inputValue.trim() || !conversationId || isLoading) return;

    const userMessage: Message = {
      id: messages.length + 1,
      role: "user",
      content: inputValue,
      createdAt: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      const response = await sendMessage.mutateAsync({
        conversationId,
        message: inputValue,
      });

      const assistantMessage: Message = {
        id: messages.length + 2,
        role: "assistant",
        content: response.message,
        createdAt: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);

      if (response.suggestions) {
        setSuggestions(response.suggestions);
      }
    } catch (_error) {
      toast.error(t("chat.errorSending"));
    } finally {
      setIsLoading(false);
    }
  };

  // Handle suggestion selection
  const handleSelectSuggestion = async (suggestion: FlightSuggestion) => {
    try {
      setIsLoading(true);
      const result = await selectSuggestion.mutateAsync({
        suggestionId: suggestion.id,
      });

      if (onBookingSelect) {
        onBookingSelect(result.flightId, result.cabinClass);
      } else {
        // Navigate to booking page
        navigate(`/booking/${result.flightId}?class=${result.cabinClass}`);
      }

      toast.success(t("chat.bookingSelected"));
    } catch (_error) {
      toast.error(t("chat.errorSelecting"));
    } finally {
      setIsLoading(false);
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
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => handleSelectSuggestion(suggestion)}
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
              {format(new Date(suggestion.departureTime), "HH:mm")}
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
              {format(new Date(suggestion.arrivalTime), "HH:mm")}
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
              {format(new Date(suggestion.departureTime), "dd MMM", { locale })}
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
        className="fixed bottom-6 right-6 bg-card rounded-lg shadow-lg z-50 cursor-pointer"
        onClick={() => setIsMinimized(false)}
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
              onClick={() => setIsMinimized(true)}
            >
              <Minimize2 className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map(renderMessage)}

          {isLoading && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
              <div className="space-y-2">
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
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={t("chat.placeholder")}
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            size="icon"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
