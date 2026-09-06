import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  withCircuitBreaker,
  getCircuitBreakerStatus,
  CircuitState,
} from "./production.service";

/**
 * Tests for the (previously untested) circuit breaker that now protects the
 * auth-service client. Each test uses a unique service name because breaker
 * state lives in a module-level map shared across the process.
 */

let counter = 0;
function uniqueName() {
  return `test-svc-${Date.now()}-${counter++}`;
}

const fail = () => Promise.reject(new Error("boom"));
const ok = (v = "ok") => Promise.resolve(v);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("withCircuitBreaker", () => {
  it("returns the result and stays CLOSED on success", async () => {
    const name = uniqueName();
    await expect(withCircuitBreaker(name, () => ok("hi"))).resolves.toBe("hi");
    expect(getCircuitBreakerStatus()[name].state).toBe(CircuitState.CLOSED);
  });

  it("opens after the failure threshold and then fast-fails without calling fn", async () => {
    const name = uniqueName();
    const opts = {
      failureThreshold: 2,
      resetTimeout: 1000,
      monitorWindow: 60000,
    };

    await expect(withCircuitBreaker(name, fail, opts)).rejects.toThrow("boom");
    await expect(withCircuitBreaker(name, fail, opts)).rejects.toThrow("boom");
    expect(getCircuitBreakerStatus()[name].state).toBe(CircuitState.OPEN);

    // Circuit is open -> fn must not run, rejects with SERVICE_UNAVAILABLE.
    const fn = vi.fn(() => ok());
    await expect(withCircuitBreaker(name, fn, opts)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("transitions to HALF_OPEN after resetTimeout and CLOSES on success", async () => {
    const name = uniqueName();
    const opts = {
      failureThreshold: 1,
      resetTimeout: 1000,
      monitorWindow: 60000,
    };

    await expect(withCircuitBreaker(name, fail, opts)).rejects.toThrow();
    expect(getCircuitBreakerStatus()[name].state).toBe(CircuitState.OPEN);

    // Advance past the reset timeout -> next call is allowed (half-open trial).
    vi.setSystemTime(new Date("2026-01-01T00:00:02Z")); // +2s > 1s
    await expect(
      withCircuitBreaker(name, () => ok("recovered"), opts)
    ).resolves.toBe("recovered");
    expect(getCircuitBreakerStatus()[name].state).toBe(CircuitState.CLOSED);
  });

  it("resets the failure count when failures fall outside the monitor window", async () => {
    const name = uniqueName();
    const opts = {
      failureThreshold: 2,
      resetTimeout: 1000,
      monitorWindow: 5000,
    };

    await expect(withCircuitBreaker(name, fail, opts)).rejects.toThrow();
    // Wait longer than the monitor window before the next failure.
    vi.setSystemTime(new Date("2026-01-01T00:00:10Z")); // +10s > 5s
    await expect(withCircuitBreaker(name, fail, opts)).rejects.toThrow();

    // Count was reset, so two spaced-out failures don't open the circuit.
    expect(getCircuitBreakerStatus()[name].state).toBe(CircuitState.CLOSED);
  });
});
