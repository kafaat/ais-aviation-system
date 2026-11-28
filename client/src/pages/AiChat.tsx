import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { isCivilDay } from "@shared/ibe-search";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passengerRightsSource } from "@shared/passenger-policy";
import { loginPath } from "@shared/return-to";
import { airlineSupportUrl } from "@/lib/airline-support";
import { chatSendFailure, type ChatSendStatus } from "@/lib/chat-send-failure";
import { formatFlightTime } from "@/lib/flight-time";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/_core/hooks/useAuth";
import { Link, useLocation } from "wouter";
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
  unsentDraft?: string;
  exchangeBookings?: { id: number; bookingReference: string }[];
  policySourceLanguage?: keyof typeof passengerRightsSource;
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
  originTimezone: string | null;
  destinationTimezone: string | null;
  departureTime: string;
  arrivalTime: string;
  price: number;
  cabinClass: string;
  passengers: number;
  reason?: string;
}

function ChatDisclosure() {
  const { t } = useTranslation();
  const supportUrl = airlineSupportUrl();
  return (
    <div className="text-sm text-muted-foreground">
      <p>{t("aiChat.disclaimer")}</p>
      {supportUrl ? (
        <a
          href={supportUrl.href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {t("aiChat.contactSupport")}
        </a>
      ) : (
        <p>{t("aiChat.supportFallback")}</p>
      )}
    </div>
  );
}

const emptyRoute = {
  origin: "",
  destination: "",
  departureDate: "",
  passengers: 1,
  cabinClass: "economy" as "economy" | "business",
};
const selectClass =
  "block h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export default function AiChat() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageDisplay[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [sendStatus, setSendStatus] = useState<ChatSendStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [suggestions, setSuggestions] = useState<FlightSuggestion[]>([]);
  const [includeRoute, setIncludeRoute] = useState(false);
  const [route, setRoute] = useState(emptyRoute);
  const [routeAttempted, setRouteAttempted] = useState(false);
  const airports = trpc.reference.airports.useQuery(undefined, {
    enabled: !!user && includeRoute && !conversationId,
  });
  const originId = Number(route.origin);
  const destinationId = Number(route.destination);
  const airportsUnavailable =
    airports.isError || (!airports.isLoading && !airports.data?.length);
  const routeValid =
    !airportsUnavailable &&
    originId !== destinationId &&
    airports.data?.some(airport => airport.id === originId && originId > 0) &&
    airports.data.some(
      airport => airport.id === destinationId && destinationId > 0
    ) &&
    isCivilDay(route.departureDate) &&
    Number.isInteger(route.passengers) &&
    route.passengers >= 1 &&
    route.passengers <= 9;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<number | null>(null);
  const conversationEpochRef = useRef(0);
  const localMessageIdRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const transcriptRevisionRef = useRef(0);
  const historyRequestRef = useRef<object | null>(null);
  const startRequestRef = useRef<object | null>(null);

  const utils = trpc.useUtils();
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

  useEffect(() => {
    return () => {
      conversationEpochRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      historyRequestRef.current = null;
      startRequestRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height =
        Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  }, [inputValue]);

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
      // A cached fetch can reuse a read started before a newer accepted send.
      // Each reconciliation needs its own request as well as local guards.
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
          createdAt: row.createdAt.toISOString(),
        })),
        ...previous.filter(row => row.unsentDraft !== undefined),
      ]);
      // Saved history does not contain the transient flight/referral projections.
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

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    draftRevisionRef.current += 1;
    setInputValue(e.target.value);
  };

  const handleStartConversation = async () => {
    if (startRequestRef.current) return;
    if (includeRoute && !routeValid) {
      setRouteAttempted(true);
      return;
    }
    const request = {};
    const epoch = conversationEpochRef.current;
    startRequestRef.current = request;
    try {
      const result = await startConversation.mutateAsync(
        includeRoute
          ? {
              initialContext: {
                originId,
                destinationId,
                departureDate: route.departureDate,
                passengers: route.passengers,
                cabinClass: route.cabinClass,
              },
            }
          : {}
      );
      if (
        startRequestRef.current !== request ||
        conversationEpochRef.current !== epoch
      )
        return;
      conversationIdRef.current = result.conversationId;
      setConversationId(result.conversationId);
      transcriptRevisionRef.current += 1;
      setMessages([
        {
          id: --localMessageIdRef.current,
          role: "assistant",
          content: result.greeting,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch {
      if (startRequestRef.current === request) {
        console.error("Failed to start conversation");
      }
    } finally {
      if (startRequestRef.current === request) startRequestRef.current = null;
    }
  };

  const handleSendMessage = async (message?: string) => {
    const msgText = message ?? inputValue.trim();
    const id = conversationIdRef.current;
    if (
      !msgText ||
      id === null ||
      (abortControllerRef.current && !abortControllerRef.current.signal.aborted)
    )
      return;

    const epoch = conversationEpochRef.current;
    const draftText = message === undefined ? inputValue : msgText;
    const restoreRevision =
      message === undefined || inputValue.length === 0
        ? draftRevisionRef.current + 1
        : null;
    draftRevisionRef.current += 1;
    // A quick prompt is separate from an existing composer draft.
    if (message === undefined) setInputValue("");
    invalidateHistoryRead();
    const transcriptRevision = ++transcriptRevisionRef.current;
    const previousSuggestions = suggestions;

    // Add user message immediately
    const userMsg: ChatMessageDisplay = {
      id: --localMessageIdRef.current,
      role: "user",
      content: msgText,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsGenerating(true);
    setSendStatus(null);
    setSuggestions([]);

    // Suppress a late reply locally. This does not cancel server processing.
    const request = new AbortController();
    abortControllerRef.current = request;

    try {
      const result = await sendMessageMut.mutateAsync({
        conversationId: id,
        message: msgText,
      });

      // Check if generation was stopped
      if (
        request.signal.aborted ||
        abortControllerRef.current !== request ||
        conversationEpochRef.current !== epoch
      )
        return;

      const aiMsg: ChatMessageDisplay = {
        id: --localMessageIdRef.current,
        role: "assistant",
        content: result.message,
        policySourceLanguage: result.policySourceLanguage,
        exchangeBookings: result.exchangeBookings,
        createdAt: new Date().toISOString(),
      };
      transcriptRevisionRef.current += 1;
      setMessages(prev => [...prev, aiMsg]);

      if (result.suggestions) {
        setSuggestions(result.suggestions);
      }
    } catch (err) {
      if (conversationEpochRef.current !== epoch) return;
      const failure = chatSendFailure(err);
      if (failure.unaccepted) {
        // Even a locally stopped request must correct a known admission failure.
        const restore =
          restoreRevision !== null &&
          draftRevisionRef.current === restoreRevision;
        const unchangedTranscript =
          transcriptRevisionRef.current === transcriptRevision;
        if (restore) {
          draftRevisionRef.current += 1;
          setInputValue(draftText);
        }
        setMessages(previous => {
          const found = previous.some(row => row.id === userMsg.id);
          const retained = previous.flatMap(row =>
            row.id !== userMsg.id
              ? [row]
              : restore
                ? []
                : [{ ...row, unsentDraft: draftText }]
          );
          return !found && !restore
            ? [...retained, { ...userMsg, unsentDraft: draftText }]
            : retained;
        });
        if (abortControllerRef.current === request) {
          setSendStatus(failure.status);
          if (unchangedTranscript) setSuggestions(previousSuggestions);
        }
      } else if (
        !request.signal.aborted &&
        abortControllerRef.current === request
      ) {
        setSendStatus(failure.status);
        if (failure.reconcile) void handleRefreshHistory();
      }
    } finally {
      if (abortControllerRef.current === request) {
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    }
  };

  const handleStopWaiting = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
      setSendStatus("waitStopped");
    }
  };

  const handleRestoreDraft = (message: ChatMessageDisplay) => {
    if (
      message.unsentDraft === undefined ||
      inputValue.length > 0 ||
      (abortControllerRef.current && !abortControllerRef.current.signal.aborted)
    )
      return;
    draftRevisionRef.current += 1;
    setInputValue(message.unsentDraft);
    setMessages(previous => previous.filter(row => row.id !== message.id));
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleNewConversation = () => {
    conversationEpochRef.current += 1;
    handleStopWaiting();
    abortControllerRef.current = null;
    conversationIdRef.current = null;
    startRequestRef.current = null;
    draftRevisionRef.current += 1;
    transcriptRevisionRef.current += 1;
    invalidateHistoryRead();
    setSendStatus(null);
    setIncludeRoute(false);
    setRoute(emptyRoute);
    setRouteAttempted(false);
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
          <Button asChild>
            <Link href={loginPath("/ai-chat")}>{t("common.login")}</Link>
          </Button>
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
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("common.back")}
              onClick={() => navigate("/")}
            >
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
            <div className="mb-4">
              <ChatDisclosure />
            </div>
            <div className="mb-5 text-start">
              <label className="flex items-center justify-center gap-2">
                <input
                  type="checkbox"
                  checked={includeRoute}
                  onChange={event => {
                    setIncludeRoute(event.target.checked);
                    setRouteAttempted(false);
                  }}
                />
                {t("aiChat.addRoute")}
              </label>
              {includeRoute && (
                <div className="mt-4 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(["origin", "destination"] as const).map(field => (
                      <div key={field}>
                        <Label htmlFor={`chat-${field}`}>
                          {field === "origin"
                            ? t("home.search.from")
                            : t("home.search.to")}
                        </Label>
                        <select
                          id={`chat-${field}`}
                          className={selectClass}
                          value={route[field]}
                          onChange={event =>
                            setRoute({ ...route, [field]: event.target.value })
                          }
                        >
                          <option value="">
                            {field === "origin"
                              ? t("home.search.selectOrigin")
                              : t("home.search.selectDestination")}
                          </option>
                          {airports.data?.map(airport => (
                            <option key={airport.id} value={airport.id}>
                              {airport.city} ({airport.code})
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                    <div>
                      <Label htmlFor="chat-date">
                        {t("home.search.departureDate")}
                      </Label>
                      <Input
                        id="chat-date"
                        type="date"
                        value={route.departureDate}
                        onChange={event =>
                          setRoute({
                            ...route,
                            departureDate: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="chat-passengers">
                        {t("booking.passengers")}
                      </Label>
                      <select
                        id="chat-passengers"
                        className={selectClass}
                        value={route.passengers}
                        onChange={event =>
                          setRoute({
                            ...route,
                            passengers: Number(event.target.value),
                          })
                        }
                      >
                        {Array.from({ length: 9 }, (_, index) => index + 1).map(
                          count => (
                            <option key={count} value={count}>
                              {count}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="chat-cabin">
                        {t("filters.cabinClass")}
                      </Label>
                      <select
                        id="chat-cabin"
                        className={selectClass}
                        value={route.cabinClass}
                        onChange={event =>
                          setRoute({
                            ...route,
                            cabinClass:
                              event.target.value === "business"
                                ? "business"
                                : "economy",
                          })
                        }
                      >
                        <option value="economy">{t("search.economy")}</option>
                        <option value="business">{t("search.business")}</option>
                      </select>
                    </div>
                  </div>
                  {airports.isLoading ? (
                    <p role="status">{t("common.loading")}</p>
                  ) : airportsUnavailable ? (
                    <div role="alert">
                      <p>{t("aiChat.airportOptionsUnavailable")}</p>
                      <Button
                        variant="outline"
                        onClick={() => void airports.refetch()}
                      >
                        {t("common.retry")}
                      </Button>
                    </div>
                  ) : (
                    routeAttempted &&
                    !routeValid && (
                      <p role="alert">{t("aiChat.invalidRoute")}</p>
                    )
                  )}
                </div>
              )}
              {startConversation.isError && (
                <p role="alert">{t("aiChat.startError")}</p>
              )}
            </div>
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
                  disabled={startConversation.isPending}
                  onClick={handleStartConversation}
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
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("common.back")}
              onClick={() => navigate("/")}
            >
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
                <p className="text-xs text-muted-foreground" role="status">
                  {isGenerating
                    ? t("aiChat.waiting")
                    : isRefreshing
                      ? t("aiChat.refreshingHistory")
                      : t("aiChat.ready")}
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
      <div
        className="flex-1 overflow-y-auto"
        role="log"
        aria-label={t("aiChat.conversationLog")}
      >
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
                <span className="sr-only">
                  {t(
                    msg.role === "user" ? "aiChat.you" : "aiChat.assistantName"
                  )}
                </span>
                <p className="text-sm whitespace-pre-wrap" dir="auto">
                  {msg.content}
                </p>
                {msg.unsentDraft !== undefined && (
                  <div className="mt-2 text-xs">
                    <p>{t("aiChat.notSent")}</p>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-inherit underline"
                      disabled={isGenerating || inputValue.length > 0}
                      onClick={() => handleRestoreDraft(msg)}
                    >
                      {t("aiChat.restoreDraft")}
                    </Button>
                  </div>
                )}
                {msg.exchangeBookings && (
                  <nav
                    aria-label={t("aiChat.exchangeHelp")}
                    className="grid gap-2"
                  >
                    {msg.exchangeBookings.map(booking => (
                      <Link
                        key={booking.id}
                        className="underline"
                        href={`/my-bookings?exchange=${booking.id}`}
                      >
                        {t("aiChat.reviewExchange")}{" "}
                        <bdi>{booking.bookingReference}</bdi>
                      </Link>
                    ))}
                    <Link href="/my-bookings" className="underline">
                      {t("myBookings.title")}
                    </Link>
                  </nav>
                )}
                {msg.policySourceLanguage && (
                  <a
                    href={passengerRightsSource[msg.policySourceLanguage]}
                    className="underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("aiChat.policySource")}
                  </a>
                )}
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
                <Link
                  key={s.id}
                  href={`/booking/${s.flightId}?${new URLSearchParams({ class: s.cabinClass, passengers: String(s.passengers) })}`}
                  className="block rounded-xl border bg-card p-4 hover:border-primary/50 focus-visible:outline-2 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">{s.airline}</span>
                    <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                      {s.cabinClass === "business"
                        ? t("search.business")
                        : t("search.economy")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">{s.origin}</span>
                    <Plane className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">{s.destination}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <bdi dir="ltr">
                      {formatFlightTime(s.departureTime, s.originTimezone)} –{" "}
                      {formatFlightTime(s.arrivalTime, s.destinationTimezone)}
                    </bdi>
                    <bdi className="font-bold text-base text-foreground">
                      {(s.price / 100).toFixed(2)} {t("common.currency")}{" "}
                      {t("priceCalendar.perPerson")}
                    </bdi>
                  </div>
                  {s.reason && (
                    <p className="text-xs text-primary mt-1">{s.reason}</p>
                  )}
                </Link>
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
                disabled={isGenerating}
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
          {!messages.some(message => message.exchangeBookings) && (
            <button
              type="button"
              disabled={isGenerating}
              className="mb-2 me-3 text-sm underline"
              onClick={() => handleSendMessage(t("aiChat.exchangeHelp"))}
            >
              {t("aiChat.exchangeHelp")}
            </button>
          )}
          {!messages.some(message => message.policySourceLanguage) && (
            <button
              type="button"
              disabled={isGenerating}
              className="mb-2 text-sm underline"
              onClick={() => handleSendMessage(t("aiChat.policyHelp"))}
            >
              {t("aiChat.policyHelp")}
            </button>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                aria-label={t("aiChat.messageLabel")}
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
                onClick={handleStopWaiting}
                className="h-11 w-11 rounded-xl flex-shrink-0"
                title={t("aiChat.stopWaiting")}
                aria-label={t("aiChat.stopWaiting")}
              >
                <Square className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                aria-label={t("aiChat.sendMessage")}
                onClick={() => handleSendMessage()}
                disabled={!inputValue.trim()}
                className="h-11 w-11 rounded-xl flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
          <Button
            type="button"
            variant="link"
            className="mt-2 h-auto p-0 text-xs"
            disabled={isGenerating || isRefreshing}
            onClick={() => void handleRefreshHistory()}
          >
            {isRefreshing
              ? t("aiChat.refreshingHistory")
              : t("aiChat.refreshHistory")}
          </Button>
          {isGenerating && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("aiChat.stopWaitingNote")}
            </p>
          )}
          <div className="text-center mt-2">
            <ChatDisclosure />
          </div>
        </div>
      </div>
    </div>
  );
}
