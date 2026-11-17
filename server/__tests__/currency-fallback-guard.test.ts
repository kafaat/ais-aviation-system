import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditLogs,
  exchangeRates,
  operationsAlerts,
} from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import * as relational from "./helpers/authority-relational-fixture";

/**
 * #319 Wave 1 fallback guard: the hard-coded FALLBACK_RATES may label an
 * estimate (a quote whose source says "fallback"); they never produce an
 * amount, and no module on a money path (found by the rule below, not by a
 * fixed list) can reach them.
 */
const boundary = vi.hoisted(() => ({
  db: null as unknown,
  cache: new Map<string, string>(),
}));
const engine = vi.hoisted(() => ({
  calculateDynamicPrice: vi.fn(),
  getPriceRange: vi.fn(),
  getPriceForecast: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../services/cache.service", () => ({
  cacheService: {
    isConnected: () => false,
    checkRateLimit: async () => ({ allowed: true, remaining: 1 }),
    async get(key: string) {
      const text = boundary.cache.get(key);
      return text ? JSON.parse(text) : null;
    },
    async set(key: string, value: unknown) {
      boundary.cache.set(key, JSON.stringify(value));
    },
    async del(key: string) {
      return Number(boundary.cache.delete(key));
    },
  },
}));
vi.mock("../services/pricing/dynamic-pricing.service", () => ({
  DynamicPricingService: engine,
}));

import * as currency from "../services/currency/currency.service";

const CURRENCY_SERVICE = "server/services/currency/currency.service.ts";
type PricingCaller = ReturnType<
  (typeof import("../routers/pricing.router"))["pricingRouter"]["createCaller"]
>;

/**
 * Money paths, by rule: every non-test module under server/ whose path has a
 * segment (split on "/", ".", "_" or "-") naming money: a refund, payment,
 * payout, settlement, ledger, pricing engine, price or fare, quote, offer,
 * checkout, invoice, order and its servicing or modification, booking,
 * rebooking, NDC, loyalty or miles, wallet, credit, voucher, revenue, BSP,
 * cancellation, compensation, EMD, ticket or coupon, financial, finance or
 * accounting, reconciliation, Stripe, split payment, fee, tax, ancillary,
 * hotel, commission or economics. A new module named for any of these is
 * covered without editing this test.
 */
const MONEY_PATH_SEGMENT = new RegExp(
  `(?:^|[/._-])(?:${[
    "refunds?",
    "payments?",
    "payout",
    "pay",
    "settlements?",
    "ledgers?",
    "pricing",
    "prices?",
    "fares?",
    "quotes?",
    "offers?",
    "checkout",
    "invoices?",
    "orders?",
    "servicing",
    "modifications?",
    "bookings?",
    "rebooking",
    "ndc",
    "loyalty",
    "miles",
    "wallet",
    "credits?",
    "vouchers?",
    "revenue",
    "bsp",
    "cancellation",
    "compensation",
    "emd",
    "tickets?",
    "eticket",
    "coupons?",
    "financial",
    "finance",
    "accounting",
    "reconciliation",
    "stripe",
    "split",
    "fees?",
    "tax(?:es)?",
    "ancillary",
    "hotel",
    "commissions?",
    "economics",
  ].join("|")})(?=$|[/._-])`,
  "i"
);

/**
 * Display-only importers: the only modules that may import the currency
 * module directly. A money-path module may reach it only if it is listed
 * here, with the reason it is display-only.
 */
const DISPLAY_ONLY_IMPORTERS: Record<string, string> = {
  "server/routers/ibe-public.ts": "the labelled display estimate",
  "server/routers/pricing.router.ts":
    "SAR prices shown in another currency, conversions and the labelled quote, all under the display rule; base and final prices stay SAR",
  "server/services/standard-reports-commercial.service.ts":
    "the list of supported currency codes only",
  "server/services/currency/operator-rates.service.ts":
    "operator quote entry and the display-rate alarm",
};

/** The explicit list this guard used before the rule; the rule must keep
 * covering it, plus the two modules the list missed. */
const EARLIER_MONEY_PATHS = [
  "server/services/pricing/dynamic-pricing.service.ts",
  "server/services/dynamic-pricing.service.ts",
  "server/services/price-quote.service.ts",
  "server/services/price-lock.service.ts",
  "server/services/fare-components.service.ts",
  "server/services/retail-offer.service.ts",
  "server/routers/price-quote.ts",
  "server/services/booking-checkout.service.ts",
  "server/services/booking-invoice.service.ts",
  "server/services/payments.service.ts",
  "server/services/split-checkout.service.ts",
  "server/services/order-service-checkout.service.ts",
  "server/services/ndc-unpaid.service.ts",
  "server/services/payment-providers/index.ts",
  "server/routers/payments.ts",
  "server/routers/bookings.ts",
  "server/routers/split-payments.ts",
  "server/services/order-servicing.service.ts",
  "server/services/booking-modification.service.ts",
  "server/routers/modifications.ts",
  "server/routers/ndc.ts",
  "server/services/payment-settlement.service.ts",
  "server/services/booking-settlement.service.ts",
  "server/services/stripe/stripe-reconciliation.service.ts",
  "server/services/corporate-settlement.service.ts",
  "server/services/bsp-settlement.service.ts",
  "server/services/financial-reporting.service.ts",
  "server/services/wallet.service.ts",
  "server/webhooks/stripe.ts",
  "server/services/refunds.service.ts",
  "server/services/internal-refund.service.ts",
  "server/services/ordinary-refund.service.ts",
  "server/services/order-refunds.service.ts",
  "server/services/split-refund.service.ts",
  "server/routers/refunds.ts",
  "server/routers/wallet.ts",
  "server/services/flight-cancellation.service.ts",
  "server/services/revenue-accounting.service.ts",
];

/** Non-test TypeScript modules under server/, relative to the repository. */
function serverModules(directory = "server"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === "__tests__" || entry.name === "node_modules"
        ? []
        : serverModules(path);
    return /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

const isMoneyPath = (module: string) =>
  MONEY_PATH_SEGMENT.test(module.replace(/^server\//, ""));

/** Static runtime import graph (type-only imports excluded), as the service
 * catalog builds it: static, re-export and dynamic imports inside the repo.
 * `extraEdges` adds imports to the real graph, to prove the guard fails. */
function importGraph(extraEdges: Record<string, string[]> = {}) {
  const root = process.cwd();
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const edges = new Map<string, string[]>();
  const dependencies = (file: string): string[] => {
    const known = edges.get(file);
    if (known) return known;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      let spec: string | undefined;
      if (
        ts.isImportDeclaration(node) &&
        !node.importClause?.isTypeOnly &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        spec = node.moduleSpecifier.text;
      if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        spec = node.moduleSpecifier.text;
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        spec = node.arguments[0].text;
      if (spec) {
        const target = ts.resolveModuleName(spec, file, parsed.options, ts.sys)
          .resolvedModule?.resolvedFileName;
        if (
          target &&
          !target.includes("node_modules") &&
          !target.endsWith(".d.ts")
        )
          found.push(resolve(target));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const extra of extraEdges[relative(root, file)] ?? [])
      found.push(resolve(extra));
    edges.set(file, found);
    return found;
  };
  /** The import chain from entry to target, or null when unreachable. */
  const chainTo = (entry: string, target: string): string[] | null => {
    const start = resolve(entry);
    const goal = resolve(target);
    const previous = new Map<string, string | null>([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const file = queue.shift()!;
      if (file === goal) {
        const chain: string[] = [];
        for (let at: string | null = file; at; at = previous.get(at) ?? null)
          chain.unshift(relative(root, at));
        return chain;
      }
      for (const next of dependencies(file))
        if (!previous.has(next)) {
          previous.set(next, file);
          queue.push(next);
        }
    }
    return null;
  };
  const directImporters = (target: string) =>
    serverModules()
      .filter(module => dependencies(resolve(module)).includes(resolve(target)))
      .sort();
  return { chainTo, directImporters };
}

/** Money-path modules outside the allow-list that reach the currency module. */
function moneyPathViolations(graph: ReturnType<typeof importGraph>) {
  return serverModules()
    .sort()
    .filter(
      module => isMoneyPath(module) && !(module in DISPLAY_ONLY_IMPORTERS)
    )
    .map(module => graph.chainTo(module, CURRENCY_SERVICE))
    .filter(chain => chain !== null);
}

function sqlTime(offsetMs: number) {
  return new Date(Date.now() + offsetMs)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
}

describe("currency fallback guard", () => {
  let fixture: ReturnType<typeof relational.authorityRelationalFixture>;

  beforeEach(() => {
    boundary.cache.clear();
    engine.calculateDynamicPrice.mockReset();
    engine.getPriceRange.mockReset();
    engine.getPriceForecast.mockReset();
    fixture = relational.authorityRelationalFixture([exchangeRates]);
    boundary.db = fixture.db;
  });

  afterEach(() => {
    boundary.db = null;
    fixture.close();
  });

  it("control: keeps every money path, found by rule, outside the currency module's import graph", () => {
    const graph = importGraph();
    const modules = serverModules();
    const money = modules.filter(isMoneyPath);
    // The rule is not vacuous: it finds well over the earlier explicit list,
    // covers every module of that list and the two the list missed.
    expect(money.length).toBeGreaterThan(150);
    for (const module of EARLIER_MONEY_PATHS) {
      expect(existsSync(module), module).toBe(true);
      expect(isMoneyPath(module), module).toBe(true);
    }
    expect(moneyPathViolations(graph)).toEqual([]);
    // The graph is live: the display and pricing routers do reach it.
    expect(
      graph.chainTo("server/routers/ibe-public.ts", CURRENCY_SERVICE)
    ).toEqual(["server/routers/ibe-public.ts", CURRENCY_SERVICE]);
  });

  it("control: only the allow-listed display-only modules import the currency module", () => {
    const graph = importGraph();
    expect(graph.directImporters(CURRENCY_SERVICE)).toEqual(
      Object.keys(DISPLAY_ONLY_IMPORTERS).sort()
    );
    // The only allow-listed money path is the pricing router.
    expect(Object.keys(DISPLAY_ONLY_IMPORTERS).filter(isMoneyPath)).toEqual([
      "server/routers/pricing.router.ts",
    ]);
  });

  it("control: the rule flags a money path that gains a route to the currency module", () => {
    const added = {
      "server/services/flight-cancellation.service.ts": [CURRENCY_SERVICE],
      // A route through an intermediate module counts as well.
      "server/services/revenue-accounting.service.ts": [
        "server/services/currency/operator-rates.service.ts",
      ],
    };
    const flagged = moneyPathViolations(importGraph(added)).map(
      chain => chain[0]
    );
    expect(flagged).toEqual(
      expect.arrayContaining([
        "server/services/flight-cancellation.service.ts",
        "server/services/revenue-accounting.service.ts",
        // ...and every money path that imports them.
        "server/routers/revenue-accounting.ts",
      ])
    );
  });

  it("fix: exposes no fallback constant and no stub that writes or caches them", () => {
    expect(Object.keys(currency)).not.toContain("FALLBACK_RATES");
    expect(Object.keys(currency)).not.toContain("updateExchangeRates");
    expect(Object.keys(currency.CurrencyService)).not.toContain(
      "updateExchangeRates"
    );
  });

  it.each([
    ["no observation", () => undefined],
    [
      "a failed rate query",
      () =>
        fixture.sqlite.exec(
          "ALTER TABLE exchange_rates RENAME TO unavailable_exchange_rates"
        ),
    ],
  ])(
    "fix: converts no amount from a fallback constant after %s",
    async (_case, arrange) => {
      arrange();
      for (const [from, to] of [
        ["SAR", "USD"],
        ["USD", "SAR"],
        ["USD", "AED"],
      ])
        await expect(currency.convertCurrency(100, from, to)).rejects.toThrow(
          currency.ExchangeRateUnavailableError
        );
      await expect(currency.convertPriceForDisplay(100, "USD")).rejects.toThrow(
        currency.ExchangeRateUnavailableError
      );
      // The constants still label an estimate, and only as such.
      expect(await currency.getExchangeRate("SAR", "USD")).toMatchObject({
        rate: 0.2666,
        source: "fallback",
      });
      expect(await currency.getExchangeRate("USD", "AED")).toMatchObject({
        source: "cross_rate_fallback",
      });
      expect(boundary.cache.size).toBe(0);
    }
  );

  it("fix: the pricing router quotes no converted price and converts no amount without an observed rate", async () => {
    engine.calculateDynamicPrice.mockResolvedValue({
      basePrice: 50000,
      finalPrice: 50000,
      breakdown: {},
      validUntil: new Date("2030-01-01T00:00:00Z"),
      priceId: "price-fx-guard",
    });
    const { pricingRouter } = await import("../routers/pricing.router");
    const caller = pricingRouter.createCaller({
      user: null,
      tenantId: null,
      authMethod: null,
      req: { headers: {} },
      res: undefined,
    } as unknown as TrpcContext);
    await expect(
      caller.calculate({
        flightId: 1,
        cabinClass: "economy",
        passengers: 1,
        currency: "USD",
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "No current exchange rate observation: SAR to USD. Request the price in SAR.",
    });
    expect(engine.calculateDynamicPrice).toHaveBeenCalledTimes(1);
    // Fix round 2: the same precondition as the price routes (it was
    // BAD_REQUEST before the conversion route took the display rule).
    await expect(
      caller.convertCurrency({
        amount: 100,
        fromCurrency: "SAR",
        toCurrency: "USD",
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "No current exchange rate observation: SAR to USD. Request the price in SAR.",
    });
    // The labelled quote remains available for what it is.
    expect(
      await caller.getExchangeRate({ fromCurrency: "SAR", toCurrency: "USD" })
    ).toMatchObject({ data: { source: "fallback" } });

    // With an observed rate the same call converts, from that observation.
    fixture.insert(exchangeRates, {
      id: 1,
      fromCurrency: "SAR",
      toCurrency: "USD",
      rate: "0.25000000",
      source: "bank",
      validFrom: new Date(Date.now() - 60_000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19),
      validTo: null,
      updatedAt: new Date(Date.now() - 60_000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19),
    });
    expect(
      await caller.convertCurrency({
        amount: 100,
        fromCurrency: "SAR",
        toCurrency: "USD",
      })
    ).toMatchObject({ data: { convertedAmount: 25, exchangeRate: 0.25 } });
  });
  const breakdown = {
    basePrice: 50000,
    demandMultiplier: 1,
    timeMultiplier: 1,
    occupancyMultiplier: 1,
    seasonalMultiplier: 1,
    aiMultiplier: 1,
    promoDiscount: 0,
    taxes: 0,
    fees: 0,
    total: 50000,
  };
  const validUntil = new Date("2030-01-01T00:00:00Z");
  const forecastDate = new Date("2030-01-02T00:00:00Z");
  const routes = {
    calculate: {
      call: (caller: PricingCaller, currency: string) =>
        caller.calculate({
          flightId: 1,
          cabinClass: "economy",
          passengers: 1,
          currency,
        }),
      engine: engine.calculateDynamicPrice,
      sar: {
        success: true,
        data: {
          basePrice: 50000,
          finalPrice: 50000,
          convertedPrice: 50000,
          currency: "SAR",
          breakdown,
          validUntil,
          priceId: "price-fx-guard",
          formatted: "500.00 ر.س",
        },
      },
    },
    getPriceRange: {
      call: (caller: PricingCaller, currency: string) =>
        caller.getPriceRange({
          originId: 1,
          destinationId: 2,
          cabinClass: "economy",
          startDate: "2030-01-01T00:00:00.000Z",
          endDate: "2030-01-31T00:00:00.000Z",
          currency,
        }),
      engine: engine.getPriceRange,
      sar: {
        success: true,
        data: {
          min: 40000,
          max: 60000,
          average: 50000,
          currency: "SAR",
          formattedMin: "400.00 ر.س",
          formattedMax: "600.00 ر.س",
        },
      },
    },
    getForecast: {
      call: (caller: PricingCaller, currency: string) =>
        caller.getForecast({
          flightId: 1,
          cabinClass: "economy",
          days: 1,
          currency,
        }),
      engine: engine.getPriceForecast,
      sar: {
        success: true,
        data: {
          forecast: [
            {
              date: forecastDate,
              predictedPrice: 50000,
              formatted: "500.00 ر.س",
            },
          ],
          currency: "SAR",
        },
      },
    },
  } as const;

  it.each(Object.keys(routes) as Array<keyof typeof routes>)(
    "fix: pricing.%s answers a non-SAR request without a rate with PRECONDITION_FAILED and a SAR request unchanged",
    async name => {
      engine.calculateDynamicPrice.mockResolvedValue({
        basePrice: 50000,
        finalPrice: 50000,
        breakdown,
        validUntil,
        priceId: "price-fx-guard",
      });
      engine.getPriceRange.mockResolvedValue({
        min: 40000,
        max: 60000,
        average: 50000,
      });
      engine.getPriceForecast.mockResolvedValue([
        { date: forecastDate, predictedPrice: 50000 },
      ]);
      const { pricingRouter } = await import("../routers/pricing.router");
      const caller = pricingRouter.createCaller({
        user: null,
        tenantId: null,
        authMethod: null,
        req: { headers: {} },
        res: undefined,
      } as unknown as TrpcContext);
      const route = routes[name];
      for (const currency of ["USD", "EUR"])
        await expect(route.call(caller, currency)).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: `No current exchange rate observation: SAR to ${currency}. Request the price in SAR.`,
        });
      expect(await route.call(caller, "SAR")).toEqual(route.sar);
      // Only a missing rate is a precondition; an engine fault stays a
      // server error.
      route.engine.mockRejectedValueOnce(new Error("engine down"));
      await expect(route.call(caller, "USD")).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "engine down",
      });
    }
  );

  // Fix round 1, item 3: a price is converted only with the quote the
  // display estimate would show (approved source, observed < 24 h ago).
  const HOUR = 3_600_000;
  function mockEngine() {
    engine.calculateDynamicPrice.mockResolvedValue({
      basePrice: 50000,
      finalPrice: 50000,
      breakdown,
      validUntil,
      priceId: "price-fx-guard",
    });
    engine.getPriceRange.mockResolvedValue({
      min: 40000,
      max: 60000,
      average: 50000,
    });
    engine.getPriceForecast.mockResolvedValue([
      { date: forecastDate, predictedPrice: 50000 },
    ]);
  }
  async function pricingCaller(): Promise<PricingCaller> {
    const { pricingRouter } = await import("../routers/pricing.router");
    return pricingRouter.createCaller({
      user: null,
      tenantId: null,
      authMethod: null,
      req: { headers: {} },
      res: undefined,
    } as unknown as TrpcContext);
  }
  function seedUsdQuote(quote: { observedAgoMs: number; source?: string }) {
    fixture.insert(exchangeRates, {
      id: 1,
      fromCurrency: "SAR",
      toCurrency: "USD",
      rate: "0.25000000",
      source: quote.source ?? "bank",
      validFrom: sqlTime(-quote.observedAgoMs),
      validTo: sqlTime(20 * HOUR),
      updatedAt: sqlTime(-quote.observedAgoMs),
    });
  }
  const convertedAtQuarter = {
    calculate: {
      success: true,
      data: {
        basePrice: 50000,
        finalPrice: 50000,
        convertedPrice: 12500,
        currency: "USD",
        breakdown,
        validUntil,
        priceId: "price-fx-guard",
        formatted: "$125.00",
      },
    },
    getPriceRange: {
      success: true,
      data: {
        min: 10000,
        max: 15000,
        average: 12500,
        currency: "USD",
        formattedMin: "$100.00",
        formattedMax: "$150.00",
      },
    },
    getForecast: {
      success: true,
      data: {
        forecast: [
          { date: forecastDate, predictedPrice: 12500, formatted: "$125.00" },
        ],
        currency: "USD",
      },
    },
  } as const;

  it.each(Object.keys(routes) as Array<keyof typeof routes>)(
    "fix: pricing.%s converts no price with a quote the display would not show",
    async name => {
      mockEngine();
      const caller = await pricingCaller();
      for (const [quote, why] of [
        [{ observedAgoMs: 30 * HOUR }, "observed 30 hours ago"],
        [{ observedAgoMs: HOUR, source: "ecb" }, "from an unapproved source"],
      ] as const) {
        fixture.sqlite.exec("DELETE FROM exchange_rates");
        boundary.cache.clear();
        seedUsdQuote(quote);
        expect(await currency.getDisplayExchangeRate("USD"), why).toBeNull();
        await expect(
          routes[name].call(caller, "USD"),
          why
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message:
            "No current exchange rate observation: SAR to USD. Request the price in SAR.",
        });
      }
    }
  );

  it.each(Object.keys(routes) as Array<keyof typeof routes>)(
    "control: pricing.%s converts a price with the quote the display shows",
    async name => {
      mockEngine();
      seedUsdQuote({ observedAgoMs: HOUR });
      expect(await currency.getDisplayExchangeRate("USD")).toMatchObject({
        rate: 0.25,
        source: "bank",
      });
      expect(await routes[name].call(await pricingCaller(), "USD")).toEqual(
        convertedAtQuarter[name]
      );
    }
  );

  // Fix round 1, item 5: each layer below holds on its own.
  it("control: a correction reaches the next conversion at once, not a cached snapshot", async () => {
    fixture.close();
    fixture = relational.authorityRelationalFixture([
      exchangeRates,
      auditLogs,
      operationsAlerts,
    ]);
    boundary.db = fixture.db;
    const { recordOperatorExchangeRate } =
      await import("../services/currency/operator-rates.service");
    const actor = { userId: 20, role: "admin" };
    const start = Date.now();
    const usdQuote = (rate: string, supersedesId?: number) => ({
      baseCurrency: "SAR" as const,
      quoteCurrency: "USD" as const,
      rate,
      source: "bank" as const,
      sourceReference: "Bank reference rate sheet 2026-11-16",
      validFrom: new Date(start - HOUR),
      validTo: new Date(start + 20 * HOUR),
      ...(supersedesId === undefined ? {} : { supersedesId }),
    });
    const first = await recordOperatorExchangeRate(
      usdQuote("0.25000000"),
      actor
    );
    expect(
      (await currency.convertCurrency(100, "SAR", "USD")).convertedAmount
    ).toBe(25);
    expect(boundary.cache.has("exchange_rate:v3:SAR_USD")).toBe(true);
    await recordOperatorExchangeRate(usdQuote("0.30000000", first.id), actor);
    expect(
      (await currency.convertCurrency(100, "SAR", "USD")).convertedAmount
    ).toBe(30);
  });

  it("control: an amount conversion refuses a stored row whose source names a fallback", async () => {
    fixture.insert(exchangeRates, {
      id: 1,
      fromCurrency: "SAR",
      toCurrency: "KWD",
      rate: "0.08200000",
      source: "fallback",
      validFrom: sqlTime(-60_000),
      validTo: null,
      updatedAt: sqlTime(-60_000),
    });
    await expect(currency.convertCurrency(100, "SAR", "KWD")).rejects.toThrow(
      currency.ExchangeRateUnavailableError
    );
    // It stays a labelled quote, also once the quote path has cached it.
    expect(await currency.getExchangeRate("SAR", "KWD")).toMatchObject({
      rate: 0.082,
      source: "fallback",
    });
    expect(boundary.cache.has("exchange_rate:v3:SAR_KWD")).toBe(true);
    await expect(currency.convertCurrency(100, "SAR", "KWD")).rejects.toThrow(
      currency.ExchangeRateUnavailableError
    );
  });

  it("control: an amount conversion refuses at the missing observation, before any estimate", async () => {
    fixture.insert(exchangeRates, {
      id: 1,
      fromCurrency: "SAR",
      toCurrency: "AED",
      rate: "0.97930000",
      source: "bank",
      validFrom: sqlTime(-60_000),
      validTo: null,
      updatedAt: sqlTime(-60_000),
    });
    const refusal = await currency
      .convertCurrency(100, "USD", "AED")
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(currency.ExchangeRateUnavailableError);
    // It names the leg without an observation: no estimate was built for
    // that leg and then refused as a cross rate.
    expect(refusal).toMatchObject({ fromCurrency: "USD", toCurrency: "SAR" });
    expect(boundary.cache.has("exchange_rate:v3:USD_AED")).toBe(false);
    // The quote path still labels the same cross rate as an estimate.
    expect(await currency.getExchangeRate("USD", "AED")).toMatchObject({
      source: "cross_rate_fallback",
    });
  });

  // Fix round 2 (lab receipt for #378 at 6600395): pricing.convertCurrency,
  // pricing.getExchangeRate and convertPriceForDisplay take the display rule
  // too. A quote the display would not show produces no amount and no rate.
  const DAY = 24 * HOUR;
  const operator = { userId: 20, role: "admin" };
  /** SAR_GBP in the label-only fallback constants. */
  const GBP_ESTIMATE = 0.21;
  const gbp = { fromCurrency: "SAR", toCurrency: "GBP" } as const;
  async function operatorEntry() {
    fixture.close();
    fixture = relational.authorityRelationalFixture([
      exchangeRates,
      auditLogs,
      operationsAlerts,
    ]);
    boundary.db = fixture.db;
    const { recordOperatorExchangeRate } =
      await import("../services/currency/operator-rates.service");
    return recordOperatorExchangeRate;
  }
  function gbpQuote(
    validFromMs: number,
    validToMs: number,
    extra: { rate?: string; supersedesId?: number } = {}
  ) {
    const start = Date.now();
    return {
      baseCurrency: "SAR" as const,
      quoteCurrency: "GBP" as const,
      rate: "0.30000000",
      source: "bank" as const,
      sourceReference: "Bank reference rate sheet 2026-11-14",
      validFrom: new Date(start + validFromMs),
      validTo: new Date(start + validToMs),
      ...extra,
    };
  }
  function seedGbpRow(source: string, id = 1) {
    const observed = sqlTime(-HOUR);
    fixture.insert(exchangeRates, {
      id,
      ...gbp,
      rate: "0.30000000",
      source,
      validFrom: observed,
      validTo: sqlTime(20 * HOUR),
      updatedAt: observed,
    });
    return new Date(`${observed.replace(" ", "T")}Z`);
  }
  /** Each leaves no quote the display shows for SAR/GBP; 100 SAR at the
   * stored rate would be 30 or 31 GBP. */
  const rejected = {
    "a maintained quote observed 48 hours ago, inside its validity window":
      async () => {
        const record = await operatorEntry();
        await record(gbpQuote(-48 * HOUR, 20 * DAY), operator);
      },
    "a fresh row from the unapproved source fallback": async () => {
      seedGbpRow("fallback");
    },
    "a fresh row from the unapproved source ecb": async () => {
      seedGbpRow("ecb");
    },
    "a maintained quote superseded by a correction observed 48 hours ago":
      async () => {
        const record = await operatorEntry();
        const first = await record(gbpQuote(-HOUR, 20 * HOUR), operator);
        await record(
          gbpQuote(-48 * HOUR, 20 * DAY, {
            rate: "0.31000000",
            supersedesId: first.id,
          }),
          operator
        );
      },
    "a maintained quote withdrawn by a correction that has expired":
      async () => {
        const record = await operatorEntry();
        const first = await record(gbpQuote(-HOUR, 20 * HOUR), operator);
        await record(
          gbpQuote(-2 * HOUR, -HOUR / 2, { supersedesId: first.id }),
          operator
        );
      },
    "a maintained quote that starts in an hour": async () => {
      const record = await operatorEntry();
      await record(gbpQuote(HOUR, 20 * HOUR), operator);
    },
  } as const;
  type Rejected = keyof typeof rejected;
  const rejectedCases = Object.keys(rejected) as Rejected[];

  it.each(rejectedCases)(
    "fix: pricing.convertCurrency answers PRECONDITION_FAILED and pricing.getExchangeRate the labelled estimate for %s",
    async name => {
      await rejected[name]();
      expect(await currency.getDisplayExchangeRate("GBP")).toBeNull();
      const caller = await pricingCaller();
      await expect(
        caller.convertCurrency({ ...gbp, amount: 100 })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message:
          "No current exchange rate observation: SAR to GBP. Request the price in SAR.",
      });
      const quote = await caller.getExchangeRate(gbp);
      expect(quote).toEqual({
        success: true,
        data: {
          ...gbp,
          rate: GBP_ESTIMATE,
          inverseRate: 1 / GBP_ESTIMATE,
          source: "fallback",
          updatedAt: expect.any(Date),
        },
      });
    }
  );

  it.each([
    rejectedCases[0],
    rejectedCases[2],
    rejectedCases[3],
  ] satisfies Rejected[])(
    "fix: convertPriceForDisplay returns no converted amount for %s",
    async name => {
      await rejected[name]();
      await expect(currency.convertPriceForDisplay(100, "GBP")).rejects.toThrow(
        new currency.ExchangeRateUnavailableError("SAR", "GBP")
      );
    }
  );

  it.each([
    rejectedCases[1],
    rejectedCases[4],
    rejectedCases[5],
  ] satisfies Rejected[])(
    "control: convertPriceForDisplay returns no converted amount for %s",
    async name => {
      await rejected[name]();
      await expect(currency.convertPriceForDisplay(100, "GBP")).rejects.toThrow(
        new currency.ExchangeRateUnavailableError("SAR", "GBP")
      );
    }
  );

  it.each(rejectedCases)(
    "control: the three price routes answer as before for %s",
    async name => {
      await rejected[name]();
      mockEngine();
      const caller = await pricingCaller();
      for (const route of Object.values(routes)) {
        await expect(route.call(caller, "GBP")).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message:
            "No current exchange rate observation: SAR to GBP. Request the price in SAR.",
        });
        expect(await route.call(caller, "SAR")).toEqual(route.sar);
      }
    }
  );

  it("fix: pricing.convertCurrency refuses a cross rate with a leg the display rule rejects", async () => {
    fixture.insert(exchangeRates, {
      id: 1,
      fromCurrency: "USD",
      toCurrency: "SAR",
      rate: "3.75000000",
      source: "bank",
      validFrom: sqlTime(-HOUR),
      validTo: sqlTime(20 * HOUR),
      updatedAt: sqlTime(-HOUR),
    });
    fixture.insert(exchangeRates, {
      id: 2,
      fromCurrency: "SAR",
      toCurrency: "AED",
      rate: "0.95000000",
      source: "bank",
      validFrom: sqlTime(-48 * HOUR),
      validTo: sqlTime(20 * DAY),
      updatedAt: sqlTime(-48 * HOUR),
    });
    const caller = await pricingCaller();
    const usdToAed = { fromCurrency: "USD", toCurrency: "AED" };
    await expect(
      caller.convertCurrency({ ...usdToAed, amount: 1000 })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "No current exchange rate observation: SAR to AED. Request the price in SAR.",
    });
    // The quote labels the stale leg as an estimate: 3.75 x 0.9793, not 0.95.
    const quote = await caller.getExchangeRate(usdToAed);
    expect(quote.data.source).toBe("cross_rate_fallback");
    expect(quote.data.rate).toBeCloseTo(3.672375, 12);
  });

  it("fix: pricing.convertCurrency does not use a cross rate cached without the display rule", async () => {
    fixture.insert(exchangeRates, {
      id: 1,
      fromCurrency: "USD",
      toCurrency: "SAR",
      rate: "3.75000000",
      source: "bank",
      validFrom: sqlTime(-HOUR),
      validTo: sqlTime(20 * HOUR),
      updatedAt: sqlTime(-HOUR),
    });
    fixture.insert(exchangeRates, {
      id: 2,
      fromCurrency: "SAR",
      toCurrency: "AED",
      rate: "0.95000000",
      source: "ecb",
      validFrom: sqlTime(-HOUR),
      validTo: sqlTime(20 * HOUR),
      updatedAt: sqlTime(-HOUR),
    });
    // A conversion without the display rule composes and caches the cross
    // rate from the ecb leg.
    expect(
      (await currency.convertCurrency(1000, "USD", "AED")).convertedAmount
    ).toBe(3562.5);
    expect(boundary.cache.has("exchange_rate:v3:USD_AED")).toBe(true);
    // Only that cached cross rate is left: it cannot show its legs.
    fixture.sqlite.exec("DELETE FROM exchange_rates");
    boundary.cache.delete("exchange_rate:v3:USD_SAR");
    boundary.cache.delete("exchange_rate:v3:SAR_AED");
    const caller = await pricingCaller();
    await expect(
      caller.convertCurrency({
        fromCurrency: "USD",
        toCurrency: "AED",
        amount: 1000,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      (await caller.getExchangeRate({ fromCurrency: "USD", toCurrency: "AED" }))
        .data.source
    ).toBe("cross_rate_fallback");
  });

  it("control: a fresh quote converts on all three paths", async () => {
    const observed = seedGbpRow("bank");
    expect(await currency.getDisplayExchangeRate("GBP")).toMatchObject({
      rate: 0.3,
      source: "bank",
    });
    const caller = await pricingCaller();
    expect(await caller.convertCurrency({ ...gbp, amount: 100 })).toEqual({
      success: true,
      data: {
        originalAmount: 100,
        originalCurrency: "SAR",
        convertedAmount: 30,
        targetCurrency: "GBP",
        exchangeRate: 0.3,
        formattedOriginal: "100.00",
        formattedConverted: "30.00",
        rateTimestamp: observed,
      },
    });
    expect(await caller.getExchangeRate(gbp)).toEqual({
      success: true,
      data: {
        ...gbp,
        rate: 0.3,
        inverseRate: 1 / 0.3,
        source: "bank",
        updatedAt: observed,
      },
    });
    expect(await currency.convertPriceForDisplay(100, "GBP")).toEqual({
      amount: 30,
      currency: "GBP",
      formatted: "30.00",
      formattedWithSymbol: "£ 30.00",
    });
  });

  it("control: SAR responses are unchanged", async () => {
    // Whatever the stored quotes, SAR never reads them.
    await rejected[rejectedCases[0]]();
    seedGbpRow("ecb", 99);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const now = new Date("2030-01-01T00:00:00Z");
      vi.setSystemTime(now);
      const caller = await pricingCaller();
      const sar = { fromCurrency: "SAR", toCurrency: "SAR" };
      expect(await caller.convertCurrency({ ...sar, amount: 1.234 })).toEqual({
        success: true,
        data: {
          originalAmount: 1.234,
          originalCurrency: "SAR",
          convertedAmount: 1.23,
          targetCurrency: "SAR",
          exchangeRate: 1,
          formattedOriginal: "1.23",
          formattedConverted: "1.23",
          rateTimestamp: now,
        },
      });
      expect(await caller.getExchangeRate(sar)).toEqual({
        success: true,
        data: {
          ...sar,
          rate: 1,
          inverseRate: 1,
          source: "identity",
          updatedAt: now,
        },
      });
      expect(await currency.convertPriceForDisplay(500, "SAR")).toEqual({
        amount: 500,
        currency: "SAR",
        formatted: "500.00",
        formattedWithSymbol: "ر.س 500.00",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // Integrator hardening after the independent review of fix round 2: two
  // weakenings of the rule survived the tests above.
  it("fix: a quote observed exactly 24 hours ago converts nothing, as the display shows nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
      fixture.insert(exchangeRates, {
        id: 1,
        ...gbp,
        rate: "0.30000000",
        source: "bank",
        validFrom: sqlTime(-DAY),
        validTo: sqlTime(20 * HOUR),
        updatedAt: sqlTime(-DAY),
      });
      expect(await currency.getDisplayExchangeRate("GBP")).toBeNull();
      const caller = await pricingCaller();
      await expect(
        caller.convertCurrency({ ...gbp, amount: 100 })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect((await caller.getExchangeRate(gbp)).data.source).toBe("fallback");
      await expect(currency.convertPriceForDisplay(100, "GBP")).rejects.toThrow(
        new currency.ExchangeRateUnavailableError("SAR", "GBP")
      );
      // One second younger, the same quote is shown and converts.
      vi.setSystemTime(new Date("2029-12-31T23:59:59Z"));
      expect(await caller.convertCurrency({ ...gbp, amount: 100 })).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({ convertedAmount: 30 }),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["observed 48 hours ago by an approved source", "bank", -48 * HOUR],
    ["observed an hour ago by the unapproved source ecb", "ecb", -HOUR],
  ])(
    "fix: a direct pair without SAR converts nothing when its quote was %s",
    async (_name, source, observedOffsetMs) => {
      fixture.insert(exchangeRates, {
        id: 1,
        fromCurrency: "USD",
        toCurrency: "AED",
        rate: "3.67250000",
        source,
        validFrom: sqlTime(observedOffsetMs),
        validTo: sqlTime(20 * DAY),
        updatedAt: sqlTime(observedOffsetMs),
      });
      const caller = await pricingCaller();
      const usdToAed = { fromCurrency: "USD", toCurrency: "AED" };
      await expect(
        caller.convertCurrency({ ...usdToAed, amount: 1000 })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining(
          "No current exchange rate observation"
        ),
      });
      const quote = await caller.getExchangeRate(usdToAed);
      expect(quote.data.source).not.toBe(source);
    }
  );

  // Fix round 3 (lab receipt for #378 at 1cec4e6): a cached snapshot is never
  // re-checked for supersession, so under the display rule the two routes
  // neither read nor write the rate cache. The generic functions still do,
  // under the same key.
  const gbpKey = "exchange_rate:v3:SAR_GBP";
  const cachedRate = (key: string) =>
    (JSON.parse(boundary.cache.get(key)!) as { quote: { rate: number } }).quote
      .rate;

  it.each([
    {
      name: "the correction's cache invalidation fails",
      via: "record",
      observedMs: -60_000,
      eligible: true,
    },
    {
      name: "the correction is written in SQL",
      via: "sql",
      observedMs: -60_000,
      eligible: true,
    },
    {
      name: "a correction observed 48 hours ago fails to invalidate the cache",
      via: "record",
      observedMs: -48 * HOUR,
      eligible: false,
    },
  ] as const)(
    "fix: pricing.convertCurrency and pricing.getExchangeRate ignore a superseded quote left in the cache when $name",
    async scenario => {
      const record = await operatorEntry();
      const first = await record(gbpQuote(-HOUR, 20 * HOUR), operator);
      // Quote A, cached under the routes' key by the generic conversion.
      expect(
        (await currency.convertCurrency(100, "SAR", "GBP")).convertedAmount
      ).toBe(30);
      expect(cachedRate(gbpKey)).toBe(0.3);
      if (scenario.via === "sql") {
        fixture.insert(exchangeRates, {
          id: first.id + 1,
          ...gbp,
          rate: "0.31000000",
          source: "bank",
          validFrom: sqlTime(scenario.observedMs),
          validTo: sqlTime(20 * HOUR),
          updatedAt: sqlTime(scenario.observedMs),
          supersedesId: first.id,
          version: 2,
        });
      } else {
        const { cacheService } = await import("../services/cache.service");
        // cache.service.ts del() answers 0 after a Redis error.
        const del = vi.spyOn(cacheService, "del").mockResolvedValue(0);
        try {
          await record(
            gbpQuote(scenario.observedMs, 20 * HOUR, {
              rate: "0.31000000",
              supersedesId: first.id,
            }),
            operator
          );
        } finally {
          del.mockRestore();
        }
      }
      expect(cachedRate(gbpKey)).toBe(0.3);
      const caller = await pricingCaller();
      if (scenario.eligible) {
        expect(
          await caller.convertCurrency({ ...gbp, amount: 100 })
        ).toMatchObject({ data: { convertedAmount: 31, exchangeRate: 0.31 } });
        expect(await caller.getExchangeRate(gbp)).toMatchObject({
          data: { rate: 0.31, source: "bank" },
        });
      } else {
        await expect(
          caller.convertCurrency({ ...gbp, amount: 100 })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await caller.getExchangeRate(gbp)).toMatchObject({
          data: { rate: GBP_ESTIMATE, source: "fallback" },
        });
      }
      // The superseded snapshot is still cached; the routes did not read it.
      expect(cachedRate(gbpKey)).toBe(0.3);
    }
  );

  it("fix: pricing.convertCurrency and pricing.getExchangeRate neither read nor write the rate cache", async () => {
    seedGbpRow("bank");
    fixture.insert(exchangeRates, {
      id: 2,
      fromCurrency: "USD",
      toCurrency: "SAR",
      rate: "3.75000000",
      source: "bank",
      validFrom: sqlTime(-HOUR),
      validTo: sqlTime(20 * HOUR),
      updatedAt: sqlTime(-HOUR),
    });
    const { cacheService } = await import("../services/cache.service");
    const get = vi.spyOn(cacheService, "get");
    const set = vi.spyOn(cacheService, "set");
    const caller = await pricingCaller();
    const usdToGbp = { fromCurrency: "USD", toCurrency: "GBP" };
    const sarToEur = { fromCurrency: "SAR", toCurrency: "EUR" };
    const routes = async () => {
      expect(
        await caller.convertCurrency({ ...gbp, amount: 100 })
      ).toMatchObject({ data: { convertedAmount: 30 } });
      expect(await caller.getExchangeRate(gbp)).toMatchObject({
        data: { rate: 0.3, source: "bank" },
      });
      expect(
        await caller.convertCurrency({ ...usdToGbp, amount: 100 })
      ).toMatchObject({ data: { convertedAmount: 112.5 } });
      expect(await caller.getExchangeRate(usdToGbp)).toMatchObject({
        data: { rate: 1.125, source: "cross_rate" },
      });
      expect(await caller.getExchangeRate(sarToEur)).toMatchObject({
        data: { source: "fallback" },
      });
      await expect(
        caller.convertCurrency({ ...sarToEur, amount: 100 })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    };
    try {
      await routes();
      expect(get).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(boundary.cache.size).toBe(0);
      // Warmed by the generic conversion, the cache is still left alone.
      await currency.convertCurrency(100, "USD", "GBP");
      const warmed = new Map(boundary.cache);
      expect([...warmed.keys()].sort()).toEqual([
        gbpKey,
        "exchange_rate:v3:USD_GBP",
        "exchange_rate:v3:USD_SAR",
      ]);
      get.mockClear();
      set.mockClear();
      await routes();
      expect(get).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(new Map(boundary.cache)).toEqual(warmed);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
