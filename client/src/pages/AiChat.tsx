import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import {
  Send,
  Square,
  Bot,
  User,
  MessageCircle,
  Plane,
  Plus,
  ArrowLeft,
  Sparkles,
  Clock,
  Loader2,
} from "lucide-react";

interface ChatMessageDisplay {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
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

export default function AiChat() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageDisplay[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<FlightSuggestion[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startConversation = trpc.aiChat.startConversation.useMutation();
  const sendMessageMut = trpc.aiChat.sendMessage.useMutation();
  const quickReplies = trpc.aiChat.getQuickReplies.useQuery(undefined, {
    enabled: !!user,
  });

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  const handleStartConversation = async () => {
    try {
      const result = await startConversation.mutateAsync({});
      setConversationId(result.conversationId);
      setMessages([
        {
          id: Date.now(),
          role: "assistant",
          content: result.greeting,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch {
      console.error("Failed to start conversation");
    }
  };

  const handleSendMessage = async (message?: string) => {
    const msgText = message || inputValue.trim();
    if (!msgText || !conversationId || isGenerating) return;

    setInputValue("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // Add user message immediately
    const userMsg: ChatMessageDisplay = {
      id: Date.now(),
      role: "user",
      content: msgText,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsGenerating(true);
    setSuggestions([]);

    // Create abort controller for stop generation
    abortControllerRef.current = new AbortController();

    try {
      const result = await sendMessageMut.mutateAsync({
        conversationId,
        message: msgText,
      });

      // Check if generation was stopped
      if (abortControllerRef.current?.signal.aborted) return;

      const aiMsg: ChatMessageDisplay = {
        id: Date.now() + 1,
        role: "assistant",
        content: result.message,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, aiMsg]);

      if (result.suggestions) {
        setSuggestions(result.suggestions);
      }
    } catch (err: any) {
      if (!abortControllerRef.current?.signal.aborted) {
        const errorMsg: ChatMessageDisplay = {
          id: Date.now() + 1,
          role: "assistant",
          content:
            err.message ||
            "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.\nSorry, an error occurred. Please try again.",
          createdAt: new Date().toISOString(),
        };
        setMessages(prev => [...prev, errorMsg]);
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    setSuggestions([]);
    setInputValue("");
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
        <Card className="p-8 text-center max-w-md">
          <Bot className="w-12 h-12 mx-auto mb-4 text-primary" />
          <h2 className="text-xl font-semibold mb-2">
            {t("aiChat.loginRequired")}
          </h2>
          <p className="text-muted-foreground mb-4">
            {t("aiChat.loginDescription")}
          </p>
          <Button onClick={() => navigate("/")}>{t("common.login")}</Button>
        </Card>
      </div>
    );
  }

  // Welcome screen - no active conversation
  if (!conversationId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
        <div className="max-w-3xl mx-auto px-4 py-8">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Bot className="w-7 h-7 text-primary" />
                {t("aiChat.title")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t("aiChat.subtitle")}
              </p>
            </div>
          </div>

          {/* Welcome Card */}
          <Card className="p-8 text-center mb-6">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-3">
              {t("aiChat.welcomeTitle")}
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto mb-8">
              {t("aiChat.welcomeDescription")}
            </p>
            <Button
              size="lg"
              onClick={handleStartConversation}
              disabled={startConversation.isPending}
              className="gap-2"
            >
              {startConversation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MessageCircle className="w-4 h-4" />
              )}
              {t("aiChat.startConversation")}
            </Button>
          </Card>

          {/* Quick suggestions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(quickReplies.data?.suggestions || [])
              .slice(0, 4)
              .map((suggestion, i) => (
                <button
                  key={i}
                  onClick={async () => {
                    await handleStartConversation();
                  }}
                  className="p-4 rounded-xl border bg-card hover:bg-accent text-start transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Plane className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">
                      {t("aiChat.quickSuggestion")}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{suggestion}</p>
                </button>
              ))}
          </div>
        </div>
      </div>
    );
  }

  // Active conversation
  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      {/* Chat Header */}
      <div className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-sm">
                  {t("aiChat.assistantName")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {isGenerating ? t("aiChat.typing") : t("aiChat.online")}
                </p>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewConversation}
            className="gap-1"
          >
            <Plus className="w-4 h-4" />
            {t("aiChat.newChat")}
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-primary/10"
                }`}
              >
                {msg.role === "user" ? (
                  <User className="w-4 h-4" />
                ) : (
                  <Bot className="w-4 h-4 text-primary" />
                )}
              </div>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border shadow-sm"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                <div
                  className={`flex items-center gap-1 mt-1 ${
                    msg.role === "user"
                      ? "text-primary-foreground/60"
                      : "text-muted-foreground"
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  <span className="text-xs">{formatTime(msg.createdAt)}</span>
                </div>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isGenerating && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="bg-card border shadow-sm rounded-2xl px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          {/* Flight suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground px-1">
                {t("aiChat.flightSuggestions")}
              </p>
              {suggestions.map(s => (
                <Card
                  key={s.id}
                  className="p-4 hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/booking/${s.flightId}`)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">{s.airline}</span>
                    <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                      {s.cabinClass}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">{s.origin}</span>
                    <Plane className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">{s.destination}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {new Date(s.departureTime).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      -{" "}
                      {new Date(s.arrivalTime).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="font-bold text-base text-foreground">
                      {(s.price / 100).toFixed(0)} SAR
                    </span>
                  </div>
                  {s.reason && (
                    <p className="text-xs text-primary mt-1">{s.reason}</p>
                  )}
                </Card>
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Quick replies */}
      {messages.length <= 1 && quickReplies.data?.suggestions && (
        <div className="border-t bg-background/50">
          <div className="max-w-3xl mx-auto px-4 py-2 flex gap-2 overflow-x-auto">
            {quickReplies.data.suggestions.slice(0, 4).map((suggestion, i) => (
              <button
                key={i}
                onClick={() => handleSendMessage(suggestion)}
                className="px-3 py-1.5 rounded-full border bg-card hover:bg-accent text-xs whitespace-nowrap transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={t("aiChat.placeholder")}
                rows={1}
                disabled={isGenerating}
                className="w-full resize-none rounded-xl border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                style={{ minHeight: "44px", maxHeight: "120px" }}
              />
            </div>
            {isGenerating ? (
              <Button
                size="icon"
                variant="destructive"
                onClick={handleStopGeneration}
                className="h-11 w-11 rounded-xl flex-shrink-0"
                title={t("aiChat.stopGeneration")}
              >
                <Square className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={() => handleSendMessage()}
                disabled={!inputValue.trim()}
                className="h-11 w-11 rounded-xl flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            {t("aiChat.disclaimer")}
          </p>
        </div>
      </div>
    </div>
  );
}
