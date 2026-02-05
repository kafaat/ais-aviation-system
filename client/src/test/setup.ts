/**
 * Vitest test setup file
 * This file is loaded before each test file
 *
 * It includes:
 * - jest-dom matchers for better DOM assertions
 * - Mock implementations for browser APIs
 * - Common test utilities and helpers
 */

import { afterEach, vi, beforeAll } from "vitest";

// Check if we're in a browser/jsdom environment
const isBrowser = typeof window !== "undefined";

// Only import browser-specific testing utilities in browser environment
if (isBrowser) {
  // Dynamically import jest-dom matchers
  import("@testing-library/jest-dom/vitest");
}

// Mock console methods to reduce noise in tests
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "debug").mockImplementation(() => {});

// Cleanup after each test (only in browser environment)
afterEach(() => {
  if (isBrowser) {
    import("@testing-library/react").then(({ cleanup }) => cleanup());
  }
  vi.clearAllMocks();
});

// Setup mocks before all tests
beforeAll(async () => {
  // Only setup browser mocks in browser environment
  if (!isBrowser) return;

  // Mock window.matchMedia
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock window.scrollTo
  Object.defineProperty(window, "scrollTo", {
    writable: true,
    configurable: true,
    value: vi.fn(),
  });

  // Mock localStorage
  const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  };
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    configurable: true,
  });

  // Mock navigator.share only if not already defined
  if (!navigator.share) {
    Object.defineProperty(navigator, "share", {
      writable: true,
      configurable: true,
      value: vi.fn(),
    });
  }

  // Mock navigator.clipboard only if not already defined or configurable
  try {
    const clipboardMock = {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(""),
    };
    Object.defineProperty(navigator, "clipboard", {
      writable: true,
      configurable: true,
      value: clipboardMock,
    });
  } catch {
    // Clipboard already defined in JSDOM, use vi.spyOn instead
    if (navigator.clipboard) {
      vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
      vi.spyOn(navigator.clipboard, "readText").mockResolvedValue("");
    }
  }
});

// Mock ResizeObserver (only in browser environment)
if (isBrowser) {
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  // Mock IntersectionObserver
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    root: null,
    rootMargin: "",
    thresholds: [],
  }));
}

// Mock pointer capture methods (needed for Radix UI components)
// Only run in browser/jsdom environment
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();

  // Mock scrollIntoView (needed for Radix UI Select)
  Element.prototype.scrollIntoView = vi.fn();

  // Mock getBoundingClientRect
  Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
    width: 100,
    height: 50,
    top: 0,
    left: 0,
    bottom: 50,
    right: 100,
    x: 0,
    y: 0,
    toJSON: vi.fn(),
  });
}

// Mock framer-motion to avoid animation issues in tests (only in browser environment)
if (isBrowser) {
  vi.mock("framer-motion", async () => {
    const React = await import("react");
    return {
      motion: {
        div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
          React.createElement("div", props, children),
        header: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) =>
          React.createElement("header", props, children),
        section: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) =>
          React.createElement("section", props, children),
        h2: ({
          children,
          ...props
        }: React.HTMLAttributes<HTMLHeadingElement>) =>
          React.createElement("h2", props, children),
        h3: ({
          children,
          ...props
        }: React.HTMLAttributes<HTMLHeadingElement>) =>
          React.createElement("h3", props, children),
        p: ({
          children,
          ...props
        }: React.HTMLAttributes<HTMLParagraphElement>) =>
          React.createElement("p", props, children),
        button: ({
          children,
          ...props
        }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
          React.createElement("button", props, children),
      },
      AnimatePresence: ({ children }: { children: React.ReactNode }) =>
        children,
      useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
      useInView: () => true,
    };
  });
}
