import { describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import {
  MAX_DELIVERY_ATTEMPTS,
  deliveryBackoffMs,
  dispatchStatusLabel,
} from "../../shared/on-call";
import {
  createGoAlertProvider,
  type OnCallProvider,
} from "../integrations/on-call";
import {
  deliverDispatch,
  queueAlertClose,
  queueAlertRaise,
} from "../services/on-call.service";

const sandbox = { mode: "sandbox" as const, reference: "sandbox:test" };

function seeded() {
  return transactionMemory({ alert_dispatches: [], operations_alerts: [] });
}

/** A provider double. `sent` is the record of what the provider was actually
 * asked to do, which is what the delivery discipline has to be judged on. */
function fakeProvider(
  behaviour: (attempt: number) => void | Promise<void> = () => {},
  dedupes = true
): OnCallProvider & { sent: { dedupKey: string; action: string }[] } {
  const sent: { dedupKey: string; action: string }[] = [];
  let attempt = 0;
  return {
    mode: "sandbox",
    reference: "sandbox:test",
    dedupes: dedupes as true,
    sent,
    async send(dispatch) {
      attempt += 1;
      await behaviour(attempt);
      sent.push({ dedupKey: dispatch.dedupKey, action: dispatch.action });
    },
  };
}

describe("delivery backoff", () => {
  it("grows exponentially and stops growing at half an hour", () => {
    expect(deliveryBackoffMs(1)).toBe(60_000);
    expect(deliveryBackoffMs(2)).toBe(120_000);
    expect(deliveryBackoffMs(5)).toBe(960_000);
    expect(deliveryBackoffMs(20)).toBe(1_800_000);
    // A zero or negative attempt count must still produce a real delay, or a
    // miscount would turn into a hot loop against the provider.
    expect(deliveryBackoffMs(0)).toBe(60_000);
    expect(deliveryBackoffMs(-3)).toBe(60_000);
  });
});

describe("status labels", () => {
  it("never describes a delivery receipt as reaching a person", () => {
    expect(dispatchStatusLabel("delivered")).toMatch(/not a confirmation/i);
    expect(dispatchStatusLabel("delivered", true)).toMatch(/وليس تأكيدًا/);
  });
});

describe("queueing", () => {
  it("queues nothing when no provider is configured", async () => {
    const fixture = seeded();
    const queued = await fixture.db.transaction((tx: any) =>
      queueAlertRaise(
        tx,
        { alertKey: "worker-observation", summary: "x" },
        null
      )
    );
    expect(queued).toBeNull();
    // An active alert with no dispatch is the honest state of a deployment
    // that pages nobody; a fabricated "delivered" row would not be.
    expect(fixture.rows("alert_dispatches")).toHaveLength(0);
  });

  it("queues a raise with a fresh dedup key per activation", async () => {
    const fixture = seeded();
    const first = await fixture.db.transaction((tx: any) =>
      queueAlertRaise(tx, { alertKey: "api-error-rate", summary: "a" }, sandbox)
    );
    const second = await fixture.db.transaction((tx: any) =>
      queueAlertRaise(tx, { alertKey: "api-error-rate", summary: "a" }, sandbox)
    );
    // Two activations are two incidents. Reusing one key would fold a new
    // outage into an incident the provider may already have closed.
    expect(first!.dedupKey).not.toBe(second!.dedupKey);
    const rows = fixture.rows("alert_dispatches");
    expect(rows).toHaveLength(2);
    expect(rows.every((row: any) => row.status === "pending")).toBe(true);
    expect(rows[0].providerReference).toBe("sandbox:test");
  });

  it("retains incident entropy even for a maximum-length alert key", async () => {
    const fixture = seeded();
    const keys = [];
    for (let i = 0; i < 3; i++)
      keys.push(
        (await queueAlertRaise(
          fixture.db,
          { alertKey: "a".repeat(100), summary: "repeat" },
          sandbox
        ))!.dedupKey
      );
    expect(new Set(keys).size).toBe(3);
    expect(keys.every(key => key.length <= 100)).toBe(true);
  });

  it("keeps a close bound to the original target, including an exhausted raise", async () => {
    const fixture = seeded();
    await queueAlertRaise(
      fixture.db,
      { alertKey: "target", summary: "x" },
      sandbox
    );
    fixture.rows("alert_dispatches")[0].status = "failed";
    await fixture.db.transaction((tx: any) =>
      queueAlertClose(tx, "target", { mode: "live", reference: "other-target" })
    );
    const close = fixture.rows("alert_dispatches")[1];
    expect(close.providerMode).toBe(sandbox.mode);
    expect(close.providerReference).toBe(sandbox.reference);
  });

  it("closes with the dedup key of the raise it is closing", async () => {
    const fixture = seeded();
    const raised = await fixture.db.transaction((tx: any) =>
      queueAlertRaise(
        tx,
        { alertKey: "outbox-delivery", summary: "b" },
        sandbox
      )
    );
    const closed = await fixture.db.transaction((tx: any) =>
      queueAlertClose(tx, "outbox-delivery", sandbox)
    );
    expect(closed!.dedupKey).toBe(raised!.dedupKey);
    const close = fixture
      .rows("alert_dispatches")
      .find((row: any) => row.action === "close");
    expect(close.summary).toMatch(/^Resolved: /);
  });

  it("queues no close when there is no incident to close", async () => {
    const fixture = seeded();
    // A bare close would tell the provider about an incident nobody opened.
    const closed = await fixture.db.transaction((tx: any) =>
      queueAlertClose(tx, "never-raised", sandbox)
    );
    expect(closed).toBeNull();
    expect(fixture.rows("alert_dispatches")).toHaveLength(0);
  });

  it("retains closure intent while the provider is disabled", async () => {
    const fixture = seeded();
    const raise = await queueAlertRaise(
      fixture.db,
      { alertKey: "disabled", summary: "x" },
      sandbox
    );
    const close = await fixture.db.transaction((tx: any) =>
      queueAlertClose(tx, "disabled", null)
    );
    expect(close?.dedupKey).toBe(raise?.dedupKey);
    expect(fixture.rows("alert_dispatches")[1].providerReference).toBe(
      sandbox.reference
    );
  });

  it("does not queue a second close for the same incident", async () => {
    const fixture = seeded();
    await fixture.db.transaction((tx: any) =>
      queueAlertRaise(tx, { alertKey: "flap", summary: "c" }, sandbox)
    );
    await fixture.db.transaction((tx: any) =>
      queueAlertClose(tx, "flap", sandbox)
    );
    await fixture.db.transaction((tx: any) =>
      queueAlertClose(tx, "flap", sandbox)
    );
    expect(
      fixture.rows("alert_dispatches").filter((r: any) => r.action === "close")
    ).toHaveLength(1);
  });
});

describe("delivery", () => {
  async function queued(fixture: ReturnType<typeof transactionMemory>) {
    await fixture.db.transaction((tx: any) =>
      queueAlertRaise(
        tx,
        { alertKey: "worker-observation", summary: "d" },
        sandbox
      )
    );
    return fixture.rows("alert_dispatches")[0].id as number;
  }

  it("records the provider receipt on success", async () => {
    const fixture = seeded();
    const id = await queued(fixture);
    const provider = fakeProvider();
    const result = await deliverDispatch(fixture.db, id, provider);
    expect(result).toBe("delivered");
    expect(provider.sent).toEqual([
      { dedupKey: expect.any(String), action: "raise" },
    ]);
    const [row] = fixture.rows("alert_dispatches");
    expect(row.status).toBe("delivered");
    expect(row.attempts).toBe(1);
    expect(row.deliveredAt).toBeInstanceOf(Date);
    expect(row.leaseToken).toBeNull();
  });

  it("marks the outcome unknown before it sends anything", async () => {
    const fixture = seeded();
    const id = await queued(fixture);
    let statusAtSendTime: string | undefined;
    const provider = fakeProvider(() => {
      // What the row says at the moment the request is in flight: a crash here
      // must leave evidence that a send may have happened.
      statusAtSendTime = fixture.rows("alert_dispatches")[0].status;
    });
    await deliverDispatch(fixture.db, id, provider);
    expect(statusAtSendTime).toBe("outcome_unknown");
  });

  it("backs off after a provider failure instead of retrying immediately", async () => {
    const fixture = seeded();
    const id = await queued(fixture);
    const provider = fakeProvider(() => {
      throw new Error("provider unreachable");
    });
    const now = new Date(Date.now() + 1000);
    expect(await deliverDispatch(fixture.db, id, provider, now)).toBe("retry");
    const [row] = fixture.rows("alert_dispatches");
    expect(row.status).toBe("pending");
    expect(row.lastError).toBe("provider unreachable");
    expect(row.nextAttemptAt.getTime()).toBe(
      now.getTime() + deliveryBackoffMs(1)
    );
    // Still inside the backoff: the worker must not touch it again.
    expect(await deliverDispatch(fixture.db, id, provider, now)).toBe(
      "skipped"
    );
  });

  it("retries after an unknown outcome, since the provider deduplicates", async () => {
    const fixture = seeded();
    const id = await queued(fixture);
    const provider = fakeProvider(attempt => {
      if (attempt === 1) throw new Error("connection reset");
    });
    const first = new Date(Date.now() + 1000);
    expect(await deliverDispatch(fixture.db, id, provider, first)).toBe(
      "retry"
    );
    const later = new Date(first.getTime() + deliveryBackoffMs(1));
    expect(await deliverDispatch(fixture.db, id, provider, later)).toBe(
      "delivered"
    );
    // Both attempts carried the same key, which is exactly why the repeat is
    // safe: the provider folds them into one incident.
    expect(new Set(provider.sent.map(s => s.dedupKey)).size).toBe(1);
  });

  it("refuses to retry a provider that does not deduplicate", async () => {
    const fixture = seeded();
    const id = await queued(fixture);
    const provider = fakeProvider(attempt => {
      if (attempt === 1) throw new Error("connection reset");
    }, false);
    const first = new Date(Date.now() + 1000);
    await deliverDispatch(fixture.db, id, provider, first);
    const later = new Date(first.getTime() + deliveryBackoffMs(1));
    // Without provider-side dedup a repeat would page twice, so the retry
    // path must not be inherited by such a provider.
    expect(await deliverDispatch(fixture.db, id, provider, later)).toBe(
      "failed"
    );
    expect(fixture.rows("alert_dispatches")[0]).toMatchObject({
      leaseToken: null,
      leaseUntil: null,
      lastError: "On-call provider cannot be retried safely",
    });
  });

  it("does not send a queued dispatch to a different provider identity or mode", async () => {
    for (const change of [
      { reference: "another-account" },
      { mode: "live" as const },
    ]) {
      const fixture = seeded();
      const id = await queued(fixture);
      const provider = Object.assign(fakeProvider(), change);
      expect(await deliverDispatch(fixture.db, id, provider)).toBe("failed");
      expect(provider.sent).toHaveLength(0);
      expect(fixture.rows("alert_dispatches")[0].attempts).toBe(0);
    }
  });

  it("does not reopen a closed incident after a lost raise response", async () => {
    const fixture = seeded();
    const id = await queued(fixture);
    let open = false;
    let raises = 0;
    const provider: OnCallProvider = {
      ...sandbox,
      dedupes: true,
      async send(dispatch) {
        // Model GoAlert deduplication: only OPEN alerts fold repeated raises.
        if (dispatch.action === "close") {
          open = false;
          return;
        }
        if (!open) {
          raises++;
          open = true;
        }
        if (raises === 1) throw new Error("accepted, response lost");
      },
    };
    const now = new Date(Date.now() + 1000);
    expect(await deliverDispatch(fixture.db, id, provider, now)).toBe("retry");
    await fixture.db.transaction((tx: any) =>
      queueAlertClose(tx, "worker-observation", sandbox)
    );
    const closeId = fixture.rows("alert_dispatches")[1].id;
    expect(await deliverDispatch(fixture.db, closeId, provider, now)).toBe(
      "delivered"
    );
    expect(
      await deliverDispatch(
        fixture.db,
        id,
        provider,
        new Date(now.getTime() + deliveryBackoffMs(1))
      )
    ).toBe("skipped");
    expect(open).toBe(false);
    expect(raises).toBe(1);
    expect(fixture.rows("alert_dispatches")[0].status).toBe("cancelled");
  });

  it("honours the attempt ceiling after a crash left the last outcome unknown", async () => {
    const fixture = seeded();
    const id = await queued(fixture);
    Object.assign(fixture.rows("alert_dispatches")[0], {
      attempts: MAX_DELIVERY_ATTEMPTS,
      status: "outcome_unknown",
      leaseUntil: new Date(0),
    });
    const provider = fakeProvider();
    expect(await deliverDispatch(fixture.db, id, provider)).toBe("failed");
    expect(provider.sent).toHaveLength(0);
  });

  it("gives up after the attempt ceiling and keeps the record", async () => {
    const fixture = seeded();
    const id = await queued(fixture);
    const provider = fakeProvider(() => {
      throw new Error("provider unreachable");
    });
    let now = new Date(Date.now() + 1000);
    const results: string[] = [];
    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
      results.push(await deliverDispatch(fixture.db, id, provider, now));
      now = new Date(now.getTime() + deliveryBackoffMs(attempt) + 1000);
    }
    expect(results.at(-1)).toBe("failed");
    const [row] = fixture.rows("alert_dispatches");
    expect(row.status).toBe("failed");
    expect(row.nextAttemptAt).toBeNull();
    // An undeliverable page is itself an operational fact; the row stays.
    expect(row.lastError).toBe("provider unreachable");
  });

  it("does not resend an already delivered dispatch", async () => {
    const fixture = seeded();
    const id = await queued(fixture);
    const provider = fakeProvider();
    await deliverDispatch(fixture.db, id, provider);
    expect(await deliverDispatch(fixture.db, id, provider)).toBe("skipped");
    expect(provider.sent).toHaveLength(1);
  });

  it("does not touch a dispatch another worker holds", async () => {
    const fixture = seeded();
    const id = await queued(fixture);
    const now = new Date(Date.now() + 1000);
    fixture.rows("alert_dispatches")[0].leaseUntil = new Date(
      now.getTime() + 60_000
    );
    expect(await deliverDispatch(fixture.db, id, fakeProvider(), now)).toBe(
      "skipped"
    );
  });

  it("stores a bounded error and never echoes the provider body", async () => {
    const fixture = seeded();
    const id = await queued(fixture);
    const provider = fakeProvider(() => {
      throw new Error("x".repeat(900));
    });
    await deliverDispatch(fixture.db, id, provider);
    expect(fixture.rows("alert_dispatches")[0].lastError).toHaveLength(500);
  });
});

describe("GoAlert adapter", () => {
  it("sends the dedup key and closes with the same one", async () => {
    const calls: { url: string; body: string; auth: string | null }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: URL | string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: String(init?.body),
        auth:
          (init?.headers as Record<string, string> | undefined)
            ?.authorization ?? null,
      });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    try {
      const provider = createGoAlertProvider({
        mode: "sandbox",
        baseUrl: "https://goalert.invalid",
        token: "fixture token value",
        reference: "sandbox:test",
      });
      const dispatch = {
        alertKey: "api-error-rate",
        dedupKey: "api-error-rate:1",
        summary: "Observed API error rate exceeds 5%",
        details: "",
      };
      await provider.send({ ...dispatch, action: "raise" });
      await provider.send({ ...dispatch, action: "close" });
      expect(calls[0].url).toBe(
        "https://goalert.invalid/api/v2/generic/incoming"
      );
      expect(calls[0].body).toContain("dedup=api-error-rate%3A1");
      expect(calls[0].body).not.toContain("action=close");
      expect(calls[1].body).toContain("action=close");
      expect(calls[1].body).toContain("dedup=api-error-rate%3A1");
      // The credential travels in a header, not a query string that proxies
      // and access logs would capture.
      expect(calls[0].url).not.toContain("token");
      expect(calls[0].auth).toBe("Bearer fixture token value");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reports a rejection without quoting the request back", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("token=fixture token value is invalid", {
        status: 403,
        statusText: "Forbidden",
      })) as typeof fetch;
    try {
      const provider = createGoAlertProvider({
        mode: "sandbox",
        baseUrl: "https://goalert.invalid",
        token: "fixture token value",
        reference: "sandbox:test",
      });
      await expect(
        provider.send({
          alertKey: "k",
          action: "raise",
          dedupKey: "k:1",
          summary: "s",
          details: "",
        })
      ).rejects.toThrow(/403 Forbidden/);
      await expect(
        provider.send({
          alertKey: "k",
          action: "raise",
          dedupKey: "k:1",
          summary: "s",
          details: "",
        })
      ).rejects.not.toThrow(/fixture token value/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("configuration", () => {
  it("pages nobody until it is explicitly configured", async () => {
    const previous = { ...process.env };
    try {
      delete process.env.ONCALL_MODE;
      const { configuredOnCallProvider } =
        await import("../integrations/on-call");
      expect(configuredOnCallProvider()).toBeNull();
      process.env.ONCALL_MODE = "disabled";
      expect(configuredOnCallProvider()).toBeNull();
      process.env.ONCALL_MODE = "nonsense";
      expect(() => configuredOnCallProvider()).toThrow(/Invalid ONCALL_MODE/);
      process.env.ONCALL_MODE = "sandbox";
      expect(() => configuredOnCallProvider()).toThrow(/not configured/);
      process.env.ONCALL_BASE_URL = "https://goalert.invalid";
      process.env.ONCALL_TOKEN = "fixture token value";
      expect(configuredOnCallProvider()?.mode).toBe("sandbox");
      // An untested rotation is not an on-call capability.
      process.env.ONCALL_MODE = "live";
      delete process.env.ONCALL_ACCEPTANCE_REFERENCE;
      expect(() => configuredOnCallProvider()).toThrow(/recorded acceptance/);
      process.env.ONCALL_ACCEPTANCE_REFERENCE = "Ops rotation accepted 2026-09";
      const live = configuredOnCallProvider();
      expect(live?.mode).toBe("live");
      expect(live?.reference).toMatch(
        /^Ops rotation accepted 2026-09#target:[0-9a-f]{64}$/
      );
    } finally {
      vi.unstubAllEnvs();
      for (const key of Object.keys(process.env))
        if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  });

  it("identifies a sandbox target without storing its credential", async () => {
    const previous = { ...process.env };
    try {
      process.env.ONCALL_MODE = "sandbox";
      process.env.ONCALL_BASE_URL = "https://goalert.invalid";
      process.env.ONCALL_TOKEN = "fixture token value";
      const { configuredOnCallProvider } =
        await import("../integrations/on-call");
      const reference = configuredOnCallProvider()!.reference;
      expect(reference).toMatch(/^sandbox#target:[0-9a-f]{64}$/);
      expect(reference).not.toContain("fixture token value");
    } finally {
      for (const key of Object.keys(process.env))
        if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  });

  it("changes target identity when endpoint or credential changes, even with the same acceptance reference", () => {
    const config = {
      mode: "live" as const,
      baseUrl: "https://goalert.invalid",
      token: "fixture token value",
      reference: "accepted rotation",
    };
    const original = createGoAlertProvider(config).reference;
    expect(
      createGoAlertProvider({ ...config, baseUrl: `${config.baseUrl}/` })
        .reference
    ).toBe(original);
    expect(
      createGoAlertProvider({ ...config, token: "another fixture value" })
        .reference
    ).not.toBe(original);
    expect(
      createGoAlertProvider({ ...config, baseUrl: "https://other.invalid" })
        .reference
    ).not.toBe(original);
  });
});
