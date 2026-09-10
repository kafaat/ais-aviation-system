// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber, structuredValue } from "./primitives";
export const responseContracts = {
  getDashboard: z.object({
    success: z.boolean(),
    data: z.object({
      demandForecasts: z.array(
        z.object({
          flightId: outputNumber,
          forecasts: z.array(
            z.object({
              date: z.string(),
              demand: outputNumber,
              lower: outputNumber,
              upper: outputNumber,
            })
          ),
        })
      ),
      segmentDistribution: z.array(
        z.object({
          name: z.string(),
          count: outputNumber,
          percentage: outputNumber,
        })
      ),
      activeTests: z.array(
        z.object({
          id: outputNumber,
          name: z.string(),
          status: z.string(),
          variants: z.array(
            z.object({
              name: z.string(),
              impressions: outputNumber,
              conversions: outputNumber,
              revenue: outputNumber,
            })
          ),
        })
      ),
      revenueMetrics: z.object({
        totalRevenue: outputNumber,
        avgYield: outputNumber,
        loadFactor: outputNumber,
        optimizationImpact: outputNumber,
      }),
      recentOptimizations: z.array(
        z.object({
          flightId: outputNumber,
          cabinClass: z.string(),
          recommendation: z.string(),
          priceChange: outputNumber,
          status: z.string(),
        })
      ),
    }),
  }),
  setEnabled: z.object({ success: z.boolean(), enabled: z.boolean() }),
  forecastDemand: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        date: z.string(),
        predictedDemand: outputNumber,
        confidenceLower: outputNumber,
        confidenceUpper: outputNumber,
        recommendedPrice: outputNumber,
        recommendedMultiplier: outputNumber,
        featureImportances: z.record(z.string(), outputNumber),
      })
    ),
  }),
  forecastRoute: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        flightId: outputNumber,
        date: z.string(),
        predictedDemand: outputNumber,
        confidenceLower: outputNumber,
        confidenceUpper: outputNumber,
        recommendedPrice: outputNumber,
      })
    ),
  }),
  forecastAccuracy: z.object({
    success: z.boolean(),
    data: z.object({
      mae: outputNumber,
      rmse: outputNumber,
      mape: outputNumber,
      r2: outputNumber,
      sampleCount: outputNumber,
    }),
  }),
  getCustomerProfile: z.object({
    success: z.boolean(),
    data: z.object({
      userId: outputNumber,
      segments: z.array(
        z.object({
          segmentId: outputNumber,
          segmentName: z.string(),
          segmentType: z.string(),
          score: outputNumber,
          priceMultiplier: outputNumber,
        })
      ),
      metrics: z.object({
        daysSinceLastBooking: outputNumber,
        lastBookingDate: z.union([z.null(), z.date()]),
        totalBookings: outputNumber,
        bookingsLast90Days: outputNumber,
        bookingsLast365Days: outputNumber,
        avgBookingsPerMonth: outputNumber,
        totalSpending: outputNumber,
        avgBookingValue: outputNumber,
        maxBookingValue: outputNumber,
        avgLeadTimeDays: outputNumber,
        preferredCabinClass: z.enum(["economy", "business", "mixed"]),
        cancellationRate: outputNumber,
        ancillaryPurchaseRate: outputNumber,
        priceSensitivityScore: outputNumber,
        avgPriceLevel: outputNumber,
      }),
      pricingAdjustment: outputNumber,
    }),
  }),
  getMyProfile: z.object({
    success: z.boolean(),
    data: z.object({
      segments: z.array(z.object({ name: z.string(), type: z.string() })),
      metrics: z.object({
        totalBookings: outputNumber,
        avgBookingValue: outputNumber,
        preferredCabinClass: z.enum(["economy", "business", "mixed"]),
      }),
    }),
  }),
  getSegments: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        id: outputNumber,
        name: z.string(),
        nameAr: z.union([z.null(), z.string()]),
        description: z.union([z.null(), z.string()]),
        segmentType: z.enum([
          "value",
          "frequency",
          "behavior",
          "loyalty_tier",
          "corporate",
          "price_sensitive",
          "premium",
        ]),
        criteria: structuredValue,
        priceMultiplier: outputNumber,
        maxDiscount: outputNumber,
        memberCount: outputNumber,
        isActive: z.boolean(),
      })
    ),
  }),
  upsertSegment: z.object({ success: z.boolean(), id: outputNumber }),
  runSegmentation: z.object({
    success: z.boolean(),
    data: z.object({
      processed: outputNumber,
      segmented: outputNumber,
      errors: outputNumber,
    }),
  }),
  optimizeFlight: z.object({
    success: z.boolean(),
    data: z.object({
      flightId: outputNumber,
      cabinClass: z.enum(["economy", "business"]),
      currentPrice: outputNumber,
      optimizedPrice: outputNumber,
      multiplier: outputNumber,
      expectedRevenueChange: outputNumber,
      expectedLoadFactorChange: outputNumber,
      confidence: outputNumber,
      factors: z.object({
        demandForecast: outputNumber,
        priceElasticity: outputNumber,
        competitorIndex: outputNumber,
        occupancyRate: outputNumber,
        daysUntilDeparture: outputNumber,
        historicalYield: outputNumber,
        seasonalFactor: outputNumber,
        segmentMix: z.record(z.string(), outputNumber),
      }),
      recommendation: z.enum(["increase", "decrease", "hold"]),
      optimizationGoal: z.string(),
    }),
  }),
  optimizeUpcoming: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        flightId: outputNumber,
        cabinClass: z.enum(["economy", "business"]),
        currentPrice: outputNumber,
        optimizedPrice: outputNumber,
        multiplier: outputNumber,
        expectedRevenueChange: outputNumber,
        expectedLoadFactorChange: outputNumber,
        confidence: outputNumber,
        factors: z.object({
          demandForecast: outputNumber,
          priceElasticity: outputNumber,
          competitorIndex: outputNumber,
          occupancyRate: outputNumber,
          daysUntilDeparture: outputNumber,
          historicalYield: outputNumber,
          seasonalFactor: outputNumber,
          segmentMix: z.record(z.string(), outputNumber),
        }),
        recommendation: z.enum(["increase", "decrease", "hold"]),
        optimizationGoal: z.string(),
      })
    ),
    total: outputNumber,
  }),
  applyOptimization: z.object({ success: z.boolean() }),
  getRevenueMetrics: z.object({
    success: z.boolean(),
    data: z.object({
      totalRevenue: outputNumber,
      avgYield: outputNumber,
      loadFactor: outputNumber,
      revenuePerSeat: outputNumber,
      revenuePerFlight: outputNumber,
      optimizationImpact: outputNumber,
      periodStart: z.date(),
      periodEnd: z.date(),
    }),
  }),
  createABTest: z.object({ success: z.boolean(), testId: outputNumber }),
  startABTest: z.object({ success: z.boolean() }),
  pauseABTest: z.object({ success: z.boolean() }),
  completeABTest: z.object({ success: z.boolean() }),
  getABTests: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        id: outputNumber,
        name: z.string(),
        description: z.union([z.null(), z.string()]),
        hypothesis: z.union([z.null(), z.string()]),
        status: z.string(),
        variants: z.array(
          z.object({
            id: outputNumber,
            name: z.string(),
            isControl: z.boolean(),
            pricingStrategy: z.object({
              type: z.enum(["multiplier", "fixed_adjustment", "dynamic_rule"]),
              multiplier: z.union([z.undefined(), outputNumber]).optional(),
              fixedAdjustment: z
                .union([z.undefined(), outputNumber])
                .optional(),
              ruleConfig: z
                .union([z.undefined(), z.record(z.string(), structuredValue)])
                .optional(),
            }),
            weight: outputNumber,
            metrics: z.object({
              impressions: outputNumber,
              conversions: outputNumber,
              conversionRate: outputNumber,
              totalRevenue: outputNumber,
              averageOrderValue: outputNumber,
              revenuePerImpression: outputNumber,
            }),
          })
        ),
        startDate: z.date(),
        endDate: z.union([z.null(), z.date()]),
        trafficPercentage: outputNumber,
        minimumSampleSize: outputNumber,
        confidenceLevel: outputNumber,
      })
    ),
  }),
  getABTestResults: z.object({
    success: z.boolean(),
    data: z.object({
      testId: outputNumber,
      testName: z.string(),
      status: z.string(),
      variants: z.array(
        z.object({
          variantId: outputNumber,
          variantName: z.string(),
          isControl: z.boolean(),
          metrics: z.object({
            impressions: outputNumber,
            conversions: outputNumber,
            conversionRate: outputNumber,
            totalRevenue: outputNumber,
            averageOrderValue: outputNumber,
            revenuePerImpression: outputNumber,
          }),
          statisticalPower: outputNumber,
        })
      ),
      winner: z.union([
        z.null(),
        z.object({
          variantId: outputNumber,
          variantName: z.string(),
          isControl: z.boolean(),
          metrics: z.object({
            impressions: outputNumber,
            conversions: outputNumber,
            conversionRate: outputNumber,
            totalRevenue: outputNumber,
            averageOrderValue: outputNumber,
            revenuePerImpression: outputNumber,
          }),
          statisticalPower: outputNumber,
        }),
      ]),
      isSignificant: z.boolean(),
      pValue: outputNumber,
      relativeLift: outputNumber,
      confidenceLevel: outputNumber,
      recommendedAction: z.string(),
    }),
  }),
};
