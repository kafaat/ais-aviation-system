import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import AiChat from "../AiChat";
import en from "@/i18n/locales/en.json";
import ar from "@/i18n/locales/ar.json";
import { passengerRightsSource } from "@shared/passenger-policy";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient } from "@tanstack/react-query";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  current.queryClient?.clear();
});

const feedback = {
  sendBusy:
    "This conversation was busy with another reply. Your message was not sent.",
  sendTimedOut: "This message was not sent before the request time limit.",
  sendLimited: "This message was not sent because a chat limit was reached.",
  replyUnavailable:
    "Your message was accepted, but this reply is no longer available. Refresh the conversation to see saved messages.",
  sendUnknown:
    "We could not confirm the result of this message. It may have been saved. Refresh the conversation before sending it again.",
  refreshHistory: "Refresh conversation",
  refreshFailed:
    "Could not refresh the conversation. Your draft and current messages have been kept.",
  restoreDraft: "Use this draft",
  notSent: "Not sent",
  closeChat: "Close chat",
};
const busyArabic = "كانت هذه المحادثة تُعالج طلبًا آخر. لم تُرسل رسالتك.";

const current = vi.hoisted(() => ({
  language: "en",
  start: vi.fn(),
  send: vi.fn(),
  history: vi.fn(),
  queryClient: null as QueryClient | null,
  suggestedCabin: "economy",
  suggestedPassengers: 1,
  airportsUnavailable: false,
  retryAirports: vi.fn(),
  authenticated: true,
  pending: null as Promise<{
    message: string;
    policySourceLanguage?: "ar" | "en";
    exchangeBookings?: { id: number; bookingReference: string }[];
  }> | null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const locale = current.language === "en" ? en : ar;
      let value: unknown = locale;
      for (const path of key.split(".")) {
        if (typeof value !== "object" || value === null) return key;
        value = (value as Record<string, unknown>)[path];
      }
      return typeof value === "string" ? value : key;
    },
  }),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: current.authenticated ? { id: 1 } : null }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: { aiChat: { getHistory: { query: current.history } } },
      aiChat: {
        getHistory: {
          fetch: (input: { conversationId: number }) => {
            if (!current.queryClient) throw new Error("Query client missing");
            // Preserve the installed utility's actual in-flight reuse behavior.
            return current.queryClient.fetchQuery({
              queryKey: [["aiChat", "getHistory"], { input, type: "query" }],
              queryFn: () => current.history(input),
            });
          },
        },
      },
    }),
    reference: {
      airports: {
        useQuery: () => ({
          data: current.airportsUnavailable
            ? undefined
            : [
                { id: 11, code: "RUH", city: "Riyadh" },
                { id: 22, code: "JED", city: "Jeddah" },
              ],
          isError: current.airportsUnavailable,
          refetch: current.retryAirports,
        }),
      },
    },
    aiChat: {
      getQuickReplies: { useQuery: () => ({}) },
      startConversation: {
        useMutation: () => ({
          mutateAsync: current.start,
        }),
      },
      sendMessage: {
        useMutation: () => ({
          mutateAsync: current.send,
        }),
      },
    },
  },
}));

beforeEach(() => {
  current.queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  current.authenticated = true;
  current.language = "en";
  current.airportsUnavailable = false;
  current.retryAirports.mockClear();
  current.suggestedCabin = "economy";
  current.suggestedPassengers = 1;
  current.pending = null;
  current.history.mockReset().mockResolvedValue([]);
  current.send.mockReset().mockImplementation(
    async () =>
      current.pending ?? {
        message: "Flight found",
        suggestions: [
          {
            id: 1,
            flightId: 99,
            airline: "Test airline",
            origin: "RUH",
            destination: "JED",
            price: 10049,
            originTimezone: "Asia/Riyadh",
            destinationTimezone: "Asia/Riyadh",
            cabinClass: current.suggestedCabin,
            passengers: current.suggestedPassengers,
            departureTime: "2026-11-04T09:00:00Z",
            arrivalTime: "2026-11-04T11:00:00Z",
          },
        ],
      }
  );
  Element.prototype.scrollIntoView = vi.fn();
  current.start
    .mockReset()
    .mockResolvedValue({ conversationId: 1, greeting: "Hello" });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function chatError(code: string) {
  return Object.assign(new Error("Synthetic chat failure"), {
    data: { code },
  });
}

function historyRow(id: number, role: "user" | "assistant", content: string) {
  return {
    id,
    conversationId: 1,
    role,
    content,
    metadata: null,
    tokensUsed: null,
    processingTimeMs: null,
    createdAt: new Date("2031-09-12T12:00:00Z"),
  };
}

async function openChat(locale = en) {
  render(<AiChat />);
  fireEvent.click(
    screen.getByRole("button", { name: locale.aiChat.startConversation })
  );
  return screen.findByRole("textbox", { name: locale.aiChat.messageLabel });
}

function submitDraft(input: HTMLElement, text: string, locale = en) {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(
    screen.getByRole("button", { name: locale.aiChat.sendMessage })
  );
}

it.each([
  ["en", en],
  ["ar", ar],
] as const)(
  "restores only an unaccepted busy draft and explains it in %s",
  async (language, locale) => {
    current.language = language;
    current.send.mockRejectedValue(chatError("CONFLICT"));
    const input = await openChat(locale);
    submitDraft(input, "  Please compare these flights  ", locale);
    await waitFor(() =>
      expect(input).toHaveValue("  Please compare these flights  ")
    );
    expect(screen.getByRole("log")).not.toHaveTextContent(
      "Please compare these flights"
    );
    expect(screen.getByRole("log")).toHaveTextContent("Hello");
    expect(
      screen.getByText(language === "ar" ? busyArabic : feedback.sendBusy)
    ).toBeVisible();
    expect(current.send).toHaveBeenCalledExactlyOnceWith({
      conversationId: 1,
      message: "Please compare these flights",
    });
    expect(current.history).not.toHaveBeenCalled();
  }
);

it.each([
  ["TIMEOUT", "sendTimedOut"],
  ["TOO_MANY_REQUESTS", "sendLimited"],
] as const)(
  "restores the unaccepted current draft on typed %s and permits a history read",
  async (code, label) => {
    current.send.mockRejectedValue(chatError(code));
    current.history.mockResolvedValue([
      historyRow(1, "assistant", "An earlier accepted reply was recovered"),
    ]);
    const input = await openChat();
    submitDraft(input, "My unaccepted draft");
    await waitFor(() => expect(input).toHaveValue("My unaccepted draft"));
    expect(screen.getByText(feedback[label])).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: feedback.refreshHistory })
    );
    expect(
      await screen.findByText("An earlier accepted reply was recovered")
    ).toBeVisible();
    expect(input).toHaveValue("My unaccepted draft");
    expect(current.send).toHaveBeenCalledTimes(1);
    expect(current.history).toHaveBeenCalledExactlyOnceWith({
      conversationId: 1,
    });
  }
);

it("does not remove a previous accepted turn with the same text or timestamp", async () => {
  vi.spyOn(Date, "now").mockReturnValue(123456);
  current.send
    .mockResolvedValueOnce({ message: "First accepted answer" })
    .mockRejectedValueOnce(chatError("CONFLICT"));
  const input = await openChat();
  submitDraft(input, "Repeated question");
  await screen.findByText("First accepted answer");
  submitDraft(input, "Repeated question");
  await waitFor(() => expect(input).toHaveValue("Repeated question"));
  const log = screen.getByRole("log");
  expect(within(log).getAllByText("Repeated question")).toHaveLength(1);
  expect(log).toHaveTextContent("First accepted answer");
  expect(current.send).toHaveBeenCalledTimes(2);
});

it("preserves an unrelated typed draft when a quick prompt is rejected", async () => {
  const pending = deferred<{ message: string }>();
  current.send.mockReturnValue(pending.promise);
  const input = await openChat();
  fireEvent.change(input, { target: { value: "My separate flight question" } });
  fireEvent.click(screen.getByRole("button", { name: en.aiChat.policyHelp }));
  expect(input).toHaveValue("My separate flight question");
  await act(async () => pending.reject(chatError("CONFLICT")));
  expect(input).toHaveValue("My separate flight question");
  expect(screen.getByRole("log")).toHaveTextContent(feedback.notSent);
  expect(
    screen.getByRole("button", { name: feedback.restoreDraft })
  ).toBeDisabled();
  expect(current.send).toHaveBeenCalledExactlyOnceWith({
    conversationId: 1,
    message: en.aiChat.policyHelp,
  });
});

it("keeps newer edits after Stop waiting and preserves a late rejected draft for manual use", async () => {
  const pending = deferred<{ message: string }>();
  current.send.mockReturnValue(pending.promise);
  const input = await openChat();
  submitDraft(input, "The rejected earlier draft");
  fireEvent.click(screen.getByRole("button", { name: en.aiChat.stopWaiting }));
  fireEvent.change(input, { target: { value: "Newer writing" } });
  await act(async () => pending.reject(chatError("CONFLICT")));
  expect(input).toHaveValue("Newer writing");
  const restore = screen.getByRole("button", { name: feedback.restoreDraft });
  expect(restore).toBeDisabled();
  expect(screen.getByRole("log")).toHaveTextContent(feedback.notSent);
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(restore);
  expect(input).toHaveValue("The rejected earlier draft");
  expect(screen.getByRole("log")).not.toHaveTextContent(
    "The rejected earlier draft"
  );
  expect(current.send).toHaveBeenCalledTimes(1);
});

it("does not overwrite a deliberate edit then deletion with a late rejected draft", async () => {
  const pending = deferred<{ message: string }>();
  current.send.mockReturnValue(pending.promise);
  const input = await openChat();
  submitDraft(input, "Earlier draft");
  fireEvent.click(screen.getByRole("button", { name: en.aiChat.stopWaiting }));
  fireEvent.change(input, { target: { value: "Deliberate edit" } });
  fireEvent.change(input, { target: { value: "" } });
  await act(async () => pending.reject(chatError("CONFLICT")));
  expect(input).toHaveValue("");
  expect(
    screen.getByRole("button", { name: feedback.restoreDraft })
  ).toBeEnabled();
  expect(current.send).toHaveBeenCalledTimes(1);
});

it.each(["resolve", "conflict"] as const)(
  "an older stopped request's %s and finally cannot end a newer wait",
  async outcome => {
    const first = deferred<{ message: string }>();
    const second = deferred<{ message: string }>();
    current.send
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const input = await openChat();
    submitDraft(input, "First question");
    fireEvent.click(
      screen.getByRole("button", { name: en.aiChat.stopWaiting })
    );
    submitDraft(input, "Second question");
    await act(async () => {
      if (outcome === "resolve")
        first.resolve({ message: "Hidden older answer" });
      else first.reject(chatError("CONFLICT"));
    });
    expect(input).toBeDisabled();
    expect(
      screen.getByRole("button", { name: en.aiChat.stopWaiting })
    ).toBeVisible();
    expect(screen.getByRole("log")).not.toHaveTextContent(
      "Hidden older answer"
    );
    if (outcome === "conflict") {
      expect(screen.getByRole("log")).toHaveTextContent(feedback.notSent);
      expect(input).toHaveValue("");
    }
    await act(async () => second.resolve({ message: "Current answer" }));
    expect(input).toBeEnabled();
    expect(screen.getByRole("log")).toHaveTextContent("Current answer");
    expect(current.send).toHaveBeenCalledTimes(2);
  }
);

it("keeps an accepted stale turn and reconciles saved history without restoring or resending it", async () => {
  const history = deferred<ReturnType<typeof historyRow>[]>();
  current.send.mockRejectedValue(chatError("PRECONDITION_FAILED"));
  current.history.mockReturnValue(history.promise);
  const input = await openChat();
  submitDraft(input, "Accepted question");
  await waitFor(() =>
    expect(current.history).toHaveBeenCalledExactlyOnceWith({
      conversationId: 1,
    })
  );
  expect(input).toHaveValue("");
  expect(screen.getByRole("log")).toHaveTextContent("Accepted question");
  expect(screen.getByText(feedback.replyUnavailable)).toBeVisible();
  await act(async () =>
    history.resolve([
      historyRow(1, "assistant", "Hello"),
      historyRow(2, "user", "Accepted question"),
      historyRow(3, "assistant", "Saved recovered reply"),
    ])
  );
  const log = screen.getByRole("log");
  expect(within(log).getAllByText("Accepted question")).toHaveLength(1);
  expect(log).toHaveTextContent("Saved recovered reply");
  expect(log).not.toHaveTextContent("Synthetic chat failure");
  expect(input).toHaveValue("");
  expect(current.send).toHaveBeenCalledTimes(1);
});

it("keeps the accepted row if history fails and retries only the history read", async () => {
  current.send.mockRejectedValue(chatError("PRECONDITION_FAILED"));
  current.history
    .mockRejectedValueOnce(new Error("Synthetic read failure"))
    .mockResolvedValueOnce([
      historyRow(1, "user", "Accepted question"),
      historyRow(2, "assistant", "Saved answer"),
    ]);
  const input = await openChat();
  submitDraft(input, "Accepted question");
  expect(await screen.findByText(feedback.refreshFailed)).toBeVisible();
  expect(screen.getByRole("log")).toHaveTextContent("Accepted question");
  expect(input).toHaveValue("");
  fireEvent.click(
    screen.getByRole("button", { name: feedback.refreshHistory })
  );
  expect(await screen.findByText("Saved answer")).toBeVisible();
  expect(current.send).toHaveBeenCalledTimes(1);
  expect(current.history).toHaveBeenCalledTimes(2);
});

it.each([
  Object.assign(new Error("TIMEOUT"), { data: { httpStatus: 504 } }),
  Object.assign(new Error("The request was aborted"), { name: "AbortError" }),
])(
  "treats transport failure as unknown delivery and never automatically resends",
  async error => {
    current.send.mockRejectedValue(error);
    const input = await openChat();
    submitDraft(input, "Possibly accepted question");
    expect(await screen.findByText(feedback.sendUnknown)).toBeVisible();
    expect(input).toHaveValue("");
    expect(screen.getByRole("log")).toHaveTextContent(
      "Possibly accepted question"
    );
    expect(screen.getByRole("log")).not.toHaveTextContent(error.message);
    expect(
      screen.queryByRole("button", { name: feedback.restoreDraft })
    ).toBeNull();
    expect(current.send).toHaveBeenCalledTimes(1);
    expect(current.history).not.toHaveBeenCalled();
  }
);

it("does not let an old history read replace a newer send or its waiting state", async () => {
  const history = deferred<ReturnType<typeof historyRow>[]>();
  const next = deferred<{ message: string }>();
  current.send
    .mockRejectedValueOnce(chatError("PRECONDITION_FAILED"))
    .mockReturnValueOnce(next.promise);
  current.history.mockReturnValue(history.promise);
  const input = await openChat();
  submitDraft(input, "Accepted old question");
  await waitFor(() => expect(current.history).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(input).toBeEnabled());
  submitDraft(input, "Newer question");
  await act(async () =>
    history.resolve([historyRow(1, "assistant", "Old read snapshot")])
  );
  expect(screen.getByRole("log")).toHaveTextContent("Newer question");
  expect(screen.getByRole("log")).not.toHaveTextContent("Old read snapshot");
  expect(input).toBeDisabled();
  await act(async () => next.resolve({ message: "Newer answer" }));
  expect(screen.getByRole("log")).toHaveTextContent("Newer answer");
});

it("does not apply a pending history read to a new conversation", async () => {
  const history = deferred<ReturnType<typeof historyRow>[]>();
  current.send.mockRejectedValue(chatError("PRECONDITION_FAILED"));
  current.history.mockReturnValue(history.promise);
  const input = await openChat();
  submitDraft(input, "Old accepted question");
  await waitFor(() => expect(current.history).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: en.aiChat.newChat }));
  current.start.mockResolvedValue({
    conversationId: 2,
    greeting: "Fresh greeting",
  });
  fireEvent.click(
    screen.getByRole("button", { name: en.aiChat.startConversation })
  );
  await screen.findByText("Fresh greeting");
  await act(async () =>
    history.resolve([historyRow(1, "assistant", "Old saved transcript")])
  );
  expect(screen.getByRole("log")).toHaveTextContent("Fresh greeting");
  expect(screen.getByRole("log")).not.toHaveTextContent("Old saved transcript");
  expect(screen.queryByText(feedback.replyUnavailable)).toBeNull();
});

it("issues a fresh history read after a newer accepted turn instead of reusing a cached in-flight snapshot", async () => {
  const oldHistory = deferred<ReturnType<typeof historyRow>[]>();
  const freshHistory = deferred<ReturnType<typeof historyRow>[]>();
  current.history
    .mockReturnValueOnce(oldHistory.promise)
    .mockReturnValueOnce(freshHistory.promise);
  current.send.mockRejectedValue(chatError("PRECONDITION_FAILED"));
  const input = await openChat();
  submitDraft(input, "First accepted question");
  await waitFor(() => expect(current.history).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(input).toBeEnabled());

  submitDraft(input, "Second accepted question");
  await waitFor(() => expect(current.send).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "Separate newer draft" } });
  await act(async () =>
    oldHistory.resolve([
      historyRow(1, "assistant", "Hello"),
      historyRow(2, "user", "First accepted question"),
    ])
  );

  expect(screen.getByRole("log")).toHaveTextContent("Second accepted question");
  expect(current.history).toHaveBeenCalledTimes(2);
  expect(input).toHaveValue("Separate newer draft");
  await act(async () =>
    freshHistory.resolve([
      historyRow(1, "assistant", "Hello"),
      historyRow(2, "user", "First accepted question"),
      historyRow(3, "assistant", "First saved reply"),
      historyRow(4, "user", "Second accepted question"),
      historyRow(5, "assistant", "Second saved reply"),
    ])
  );
  expect(screen.getByRole("log")).toHaveTextContent("Second saved reply");
  expect(current.send).toHaveBeenCalledTimes(2);
  expect(input).toHaveValue("Separate newer draft");
});

it("takes a guest to sign-in and preserves the AI chat return destination", async () => {
  current.authenticated = false;
  const route = memoryLocation({ path: "/ai-chat", record: true });
  render(
    <Router hook={route.hook}>
      <Route path="/ai-chat">
        <AiChat />
      </Route>
      <Route path="/login">
        <h1>Sign in to continue</h1>
      </Route>
    </Router>
  );
  fireEvent.click(screen.getByRole("link", { name: en.common.login }));
  expect(
    await screen.findByRole("heading", { name: "Sign in to continue" })
  ).toBeVisible();
  expect(route.history.at(-1)).toBe("/login?returnTo=%2Fai-chat");
});

it.each([
  ["en", en.aiChat],
  ["ar", ar.aiChat],
] as const)(
  "discloses AI before and during chat and provides accessible flight links in %s",
  async (language, labels) => {
    current.language = language;
    Element.prototype.scrollIntoView = vi.fn();
    render(<AiChat />);
    expect(screen.getByText(labels.disclaimer)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: labels.startConversation })
    );
    const log = await screen.findByRole("log", {
      name: labels.conversationLog,
    });
    expect(log).toHaveTextContent("Hello");
    expect(screen.getByText(labels.disclaimer)).toBeVisible();
    fireEvent.change(
      screen.getByRole("textbox", { name: labels.messageLabel }),
      {
        target: { value: "RUH to JED" },
      }
    );
    fireEvent.click(screen.getByRole("button", { name: labels.sendMessage }));
    expect(
      await screen.findByRole("link", { name: /Test airline/ })
    ).toHaveAttribute("href", "/booking/99?class=economy&passengers=1");
    expect(log).toHaveTextContent("Flight found");
    expect(log).toHaveTextContent("12:00 – 14:00");
    expect(log).toHaveTextContent("100.49");
  }
);

it("discards an old answer after a new conversation starts", async () => {
  const labels = en.aiChat;
  current.language = "en";
  Element.prototype.scrollIntoView = vi.fn();
  let finish!: (value: { message: string }) => void;
  current.pending = new Promise(resolve => {
    finish = resolve;
  });
  render(<AiChat />);
  fireEvent.click(
    screen.getByRole("button", { name: labels.startConversation })
  );
  fireEvent.change(
    await screen.findByRole("textbox", { name: labels.messageLabel }),
    {
      target: { value: "A question about the old booking" },
    }
  );
  fireEvent.click(screen.getByRole("button", { name: labels.sendMessage }));
  fireEvent.click(screen.getByRole("button", { name: labels.newChat }));
  fireEvent.click(
    screen.getByRole("button", { name: labels.startConversation })
  );
  const log = await screen.findByRole("log");
  await act(async () => finish({ message: "Stale response" }));
  current.pending = null;
  expect(log).not.toHaveTextContent("Stale response");
});

it("discloses that stopping the wait hides the pending reply without claiming server cancellation", async () => {
  current.language = "en";
  Element.prototype.scrollIntoView = vi.fn();
  let finish!: (value: { message: string }) => void;
  current.pending = new Promise(resolve => {
    finish = resolve;
  });
  try {
    render(<AiChat />);
    fireEvent.click(
      screen.getByRole("button", { name: en.aiChat.startConversation })
    );
    const input = await screen.findByRole("textbox", {
      name: en.aiChat.messageLabel,
    });
    fireEvent.change(input, { target: { value: "Find a flight" } });
    fireEvent.click(
      screen.getByRole("button", { name: en.aiChat.sendMessage })
    );
    const stop = await screen.findByRole("button", { name: "Stop waiting" });
    expect(
      screen.getByText(
        /The request may still finish and be saved to this conversation/
      )
    ).toBeVisible();
    fireEvent.click(stop);
    expect(input).toBeEnabled();
    await act(async () =>
      finish({ message: "Completed after the wait stopped" })
    );
    expect(screen.getByRole("log")).not.toHaveTextContent(
      "Completed after the wait stopped"
    );
  } finally {
    current.pending = null;
  }
});

it.each([
  "",
  "javascript:alert(1)",
  "http://example.test/help",
  "https://u:p@example.test/help",
])(
  "uses the airline contact fallback when the support URL is unavailable or unsafe (%s)",
  value => {
    current.language = "en";
    vi.stubEnv("VITE_AIRLINE_SUPPORT_URL", value);
    render(<AiChat />);
    expect(screen.getByText(en.aiChat.supportFallback)).toBeVisible();
    expect(
      screen.queryByRole("link", { name: en.aiChat.contactSupport })
    ).toBeNull();
  }
);

it("opens the configured human support channel without forwarding the conversation", () => {
  current.language = "en";
  const url = "https://support.example.test/help";
  vi.stubEnv("VITE_AIRLINE_SUPPORT_URL", url);
  render(<AiChat />);
  const link = screen.getByRole("link", { name: en.aiChat.contactSupport });
  expect(link).toHaveAttribute("href", url);
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

it.each([
  ["ar", ar.aiChat],
  ["en", en.aiChat],
] as const)(
  "opens local policy guidance from the %s chat and only links the application source",
  async (language, labels) => {
    current.language = language;
    current.pending = Promise.resolve({
      message: "Claim statement: https://unknown.example",
      policySourceLanguage: language,
    });
    try {
      render(<AiChat />);
      fireEvent.click(
        screen.getByRole("button", { name: labels.startConversation })
      );
      fireEvent.click(
        await screen.findByRole("button", { name: labels.policyHelp })
      );
      const source = await screen.findByRole("link", {
        name: labels.policySource,
      });
      expect(source).toHaveAttribute("href", passengerRightsSource[language]);
      expect(screen.queryByRole("link", { name: /unknown/ })).toBeNull();
    } finally {
      current.pending = null;
    }
  }
);

it.each([
  ["ar", ar.aiChat],
  ["en", en.aiChat],
] as const)(
  "opens the owned booking review from an assistant exchange referral in %s",
  async (language, labels) => {
    current.language = language;
    current.pending = Promise.resolve({
      message: "Review only",
      exchangeBookings: [{ id: 17, bookingReference: "MYBOOK" }],
    });
    try {
      render(<AiChat />);
      fireEvent.click(
        screen.getByRole("button", { name: labels.startConversation })
      );
      fireEvent.click(
        await screen.findByRole("button", { name: labels.exchangeHelp })
      );
      expect(
        await screen.findByRole("link", { name: new RegExp("MYBOOK") })
      ).toHaveAttribute("href", "/my-bookings?exchange=17");
      expect(
        screen.getByRole("link", {
          name: (language === "ar" ? ar : en).myBookings.title,
        })
      ).toHaveAttribute("href", "/my-bookings");
    } finally {
      current.pending = null;
    }
  }
);

it.each([
  ["ar", ar],
  ["en", en],
] as const)(
  "submits only a complete explicit flight search in %s",
  async (language, locale) => {
    current.language = language;
    Element.prototype.scrollIntoView = vi.fn();
    render(<AiChat />);
    const start = screen.getByRole("button", {
      name: locale.aiChat.startConversation,
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: locale.aiChat.addRoute })
    );
    const origin = screen.getByLabelText(locale.home.search.from);
    const destination = screen.getByLabelText(locale.home.search.to);
    fireEvent.change(origin, { target: { value: "11" } });
    fireEvent.click(start);
    expect(screen.getByRole("alert")).toHaveTextContent(
      locale.aiChat.invalidRoute
    );
    expect(current.start).not.toHaveBeenCalled();
    fireEvent.change(destination, { target: { value: "22" } });
    fireEvent.click(start);
    expect(screen.getByRole("alert")).toHaveTextContent(
      locale.aiChat.invalidRoute
    );
    expect(current.start).not.toHaveBeenCalled();
    fireEvent.change(destination, { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText(locale.home.search.departureDate), {
      target: { value: "2031-09-12" },
    });
    fireEvent.click(start);
    expect(current.start).not.toHaveBeenCalled();
    fireEvent.change(destination, { target: { value: "22" } });
    fireEvent.change(screen.getByLabelText(locale.booking.passengers), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText(locale.filters.cabinClass), {
      target: { value: "business" },
    });
    fireEvent.click(start);
    await screen.findByRole("log");
    expect(current.start).toHaveBeenCalledExactlyOnceWith({
      initialContext: {
        originId: 11,
        destinationId: 22,
        departureDate: "2031-09-12",
        passengers: 2,
        cabinClass: "business",
      },
    });
    current.suggestedCabin = "business";
    current.suggestedPassengers = 3;
    fireEvent.change(
      screen.getByRole("textbox", { name: locale.aiChat.messageLabel }),
      {
        target: {
          value:
            language === "ar"
              ? "اعرض الرحلات لـ 3 مسافرين"
              : "Show flights for 3 passengers",
        },
      }
    );
    fireEvent.click(
      screen.getByRole("button", { name: locale.aiChat.sendMessage })
    );
    const link = await screen.findByRole("link", { name: /Test airline/ });
    expect(link).toHaveAttribute(
      "href",
      "/booking/99?class=business&passengers=3"
    );
    expect(link).toHaveTextContent(locale.search.business);
    expect(link).toHaveTextContent(locale.priceCalendar.perPerson);
    fireEvent.click(
      screen.getByRole("button", { name: locale.aiChat.newChat })
    );
    expect(
      screen.getByRole("checkbox", { name: locale.aiChat.addRoute })
    ).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: locale.aiChat.startConversation })
    );
    await screen.findByRole("log");
    expect(current.start).toHaveBeenLastCalledWith({});
  }
);
it.each([
  ["ar", ar],
  ["en", en],
] as const)(
  "keeps general chat available when airports cannot be loaded in %s",
  async (language, locale) => {
    current.language = language;
    current.airportsUnavailable = true;
    Element.prototype.scrollIntoView = vi.fn();
    render(<AiChat />);
    const toggle = screen.getByRole("checkbox", {
      name: locale.aiChat.addRoute,
    });
    fireEvent.click(toggle);
    expect(screen.getByRole("alert")).toHaveTextContent(
      locale.aiChat.airportOptionsUnavailable
    );
    fireEvent.click(screen.getByRole("button", { name: locale.common.retry }));
    expect(current.retryAirports).toHaveBeenCalledOnce();
    const start = screen.getByRole("button", {
      name: locale.aiChat.startConversation,
    });
    fireEvent.click(start);
    expect(current.start).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    fireEvent.click(start);
    await screen.findByRole("log");
    expect(current.start).toHaveBeenCalledExactlyOnceWith({});
  }
);
