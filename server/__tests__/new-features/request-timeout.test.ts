import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Mock logger
vi.mock("../../_core/logger", () => ({
  createServiceLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { requestTimeoutMiddleware } from "../../_core/middleware/request-timeout.middleware";

describe("Request Timeout Middleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createMockReqRes() {
    const req = {
      method: "GET",
      path: "/api/test",
    } as any;

    const res = Object.assign(new EventEmitter(), {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }) as any;

    const next = vi.fn();

    return { req, res, next };
  }

  it("should be a function that returns middleware", () => {
    const middleware = requestTimeoutMiddleware();
    expect(typeof middleware).toBe("function");
  });

  it("should call next() immediately", () => {
    const middleware = requestTimeoutMiddleware();
    const { req, res, next } = createMockReqRes();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("should return 408 after timeout if response not sent", () => {
    const middleware = requestTimeoutMiddleware(1000); // 1 second
    const { req, res, next } = createMockReqRes();

    middleware(req, res, next);

    // Advance time past timeout
    vi.advanceTimersByTime(1001);

    expect(res.status).toHaveBeenCalledWith(408);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Request Timeout",
        message: expect.stringContaining("1000ms"),
      })
    );
  });

  it("should not return 408 if response finished before timeout", () => {
    const middleware = requestTimeoutMiddleware(5000);
    const { req, res, next } = createMockReqRes();

    middleware(req, res, next);

    // Simulate response finishing before timeout
    res.emit("finish");

    // Advance time past timeout
    vi.advanceTimersByTime(6000);

    // Should not have been called since response already finished
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should not return 408 if response closed before timeout", () => {
    const middleware = requestTimeoutMiddleware(5000);
    const { req, res, next } = createMockReqRes();

    middleware(req, res, next);

    // Simulate connection close before timeout
    res.emit("close");

    // Advance time past timeout
    vi.advanceTimersByTime(6000);

    expect(res.status).not.toHaveBeenCalled();
  });

  it("should not return 408 if headers already sent", () => {
    const middleware = requestTimeoutMiddleware(1000);
    const { req, res, next } = createMockReqRes();

    middleware(req, res, next);

    // Simulate headers already sent
    res.headersSent = true;

    // Advance time past timeout
    vi.advanceTimersByTime(1001);

    // Should not attempt to send response since headers are already sent
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should use default 30s timeout when no argument provided", () => {
    const middleware = requestTimeoutMiddleware();
    const { req, res, next } = createMockReqRes();

    middleware(req, res, next);

    // Should not timeout at 29 seconds
    vi.advanceTimersByTime(29000);
    expect(res.status).not.toHaveBeenCalled();

    // Should timeout at 30+ seconds
    vi.advanceTimersByTime(2000);
    expect(res.status).toHaveBeenCalledWith(408);
  });

  it("should use custom timeout value", () => {
    const middleware = requestTimeoutMiddleware(500);
    const { req, res, next } = createMockReqRes();

    middleware(req, res, next);

    // Should not timeout at 400ms
    vi.advanceTimersByTime(400);
    expect(res.status).not.toHaveBeenCalled();

    // Should timeout at 500ms
    vi.advanceTimersByTime(200);
    expect(res.status).toHaveBeenCalledWith(408);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("500ms"),
      })
    );
  });

  it("should include timeout duration in error message", () => {
    const middleware = requestTimeoutMiddleware(15000);
    const { req, res, next } = createMockReqRes();

    middleware(req, res, next);
    vi.advanceTimersByTime(15001);

    expect(res.json).toHaveBeenCalledWith({
      error: "Request Timeout",
      message: "Request exceeded the 15000ms time limit",
    });
  });
});
