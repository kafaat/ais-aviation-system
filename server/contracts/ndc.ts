// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  airShopping: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        offerId: z.string(),
        responseId: z.string(),
        airline: z.object({ code: z.string(), name: z.string() }),
        origin: z.object({
          code: z.string(),
          name: z.string(),
          city: z.string(),
        }),
        destination: z.object({
          code: z.string(),
          name: z.string(),
          city: z.string(),
        }),
        departureDate: z.string(),
        returnDate: z.union([z.undefined(), z.string()]).optional(),
        cabinClass: z.enum(["economy", "business", "first", "premium_economy"]),
        pricing: z.object({
          basePrice: outputNumber,
          taxesAndFees: outputNumber,
          totalPrice: outputNumber,
          currency: z.string(),
          pricePerPassenger: outputNumber,
          passengerCount: outputNumber,
        }),
        segments: z.array(
          z.object({
            segmentKey: z.string(),
            flightId: outputNumber,
            flightNumber: z.string(),
            airlineCode: z.string(),
            airlineName: z.string(),
            origin: z.object({
              code: z.string(),
              name: z.string(),
              city: z.string(),
              country: z.string(),
            }),
            destination: z.object({
              code: z.string(),
              name: z.string(),
              city: z.string(),
              country: z.string(),
            }),
            departureTime: z.string(),
            arrivalTime: z.string(),
            aircraftType: z.union([z.null(), z.string()]),
            cabinClass: z.enum([
              "economy",
              "business",
              "first",
              "premium_economy",
            ]),
            fareClass: z.union([z.undefined(), z.string()]).optional(),
            duration: z.union([z.undefined(), outputNumber]).optional(),
          })
        ),
        bundledServices: z.array(
          z.object({
            code: z.string(),
            name: z.string(),
            description: z.union([z.null(), z.string()]),
            included: z.boolean(),
          })
        ),
        fareClass: z
          .union([
            z.undefined(),
            z.object({
              code: z.string(),
              name: z.string(),
              fareFamily: z.union([z.null(), z.string()]),
              refundable: z.boolean(),
              changeable: z.boolean(),
              changeFee: z.union([z.null(), outputNumber]),
              baggageAllowance: z.union([z.null(), outputNumber]),
              baggagePieces: z.union([z.null(), outputNumber]),
            }),
          ])
          .optional(),
        expiresAt: z.string(),
        status: z.enum([
          "cancelled",
          "active",
          "expired",
          "selected",
          "ordered",
        ]),
        channel: z.enum([
          "direct",
          "ndc_aggregator",
          "gds",
          "ota",
          "travel_agent",
        ]),
        ndcVersion: z.string(),
      })
    ),
  }),
  offerPrice: z.object({
    success: z.boolean(),
    data: z.object({
      offerId: z.string(),
      responseId: z.string(),
      airline: z.object({ code: z.string(), name: z.string() }),
      origin: z.object({
        code: z.string(),
        name: z.string(),
        city: z.string(),
      }),
      destination: z.object({
        code: z.string(),
        name: z.string(),
        city: z.string(),
      }),
      departureDate: z.string(),
      returnDate: z.union([z.undefined(), z.string()]).optional(),
      cabinClass: z.enum(["economy", "business", "first", "premium_economy"]),
      pricing: z.object({
        basePrice: outputNumber,
        taxesAndFees: outputNumber,
        totalPrice: outputNumber,
        currency: z.string(),
        pricePerPassenger: outputNumber,
        passengerCount: outputNumber,
      }),
      segments: z.array(
        z.object({
          segmentKey: z.string(),
          flightId: outputNumber,
          flightNumber: z.string(),
          airlineCode: z.string(),
          airlineName: z.string(),
          origin: z.object({
            code: z.string(),
            name: z.string(),
            city: z.string(),
            country: z.string(),
          }),
          destination: z.object({
            code: z.string(),
            name: z.string(),
            city: z.string(),
            country: z.string(),
          }),
          departureTime: z.string(),
          arrivalTime: z.string(),
          aircraftType: z.union([z.null(), z.string()]),
          cabinClass: z.enum([
            "economy",
            "business",
            "first",
            "premium_economy",
          ]),
          fareClass: z.union([z.undefined(), z.string()]).optional(),
          duration: z.union([z.undefined(), outputNumber]).optional(),
        })
      ),
      bundledServices: z.array(
        z.object({
          code: z.string(),
          name: z.string(),
          description: z.union([z.null(), z.string()]),
          included: z.boolean(),
        })
      ),
      fareClass: z
        .union([
          z.undefined(),
          z.object({
            code: z.string(),
            name: z.string(),
            fareFamily: z.union([z.null(), z.string()]),
            refundable: z.boolean(),
            changeable: z.boolean(),
            changeFee: z.union([z.null(), outputNumber]),
            baggageAllowance: z.union([z.null(), outputNumber]),
            baggagePieces: z.union([z.null(), outputNumber]),
          }),
        ])
        .optional(),
      expiresAt: z.string(),
      status: z.enum(["cancelled", "active", "expired", "selected", "ordered"]),
      channel: z.enum([
        "direct",
        "ndc_aggregator",
        "gds",
        "ota",
        "travel_agent",
      ]),
      ndcVersion: z.string(),
    }),
  }),
  createOrder: z.object({
    success: z.boolean(),
    data: z.object({
      orderId: z.string(),
      offerId: z.string(),
      bookingId: z.union([z.null(), outputNumber]),
      userId: z.union([z.undefined(), outputNumber]).optional(),
      airline: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
      }),
      passengers: z.array(
        z.object({
          type: z.enum(["adult", "child", "infant"]),
          title: z.union([z.undefined(), z.string()]).optional(),
          firstName: z.string(),
          lastName: z.string(),
          dateOfBirth: z.union([z.undefined(), z.string()]).optional(),
          gender: z
            .union([z.undefined(), z.literal("male"), z.literal("female")])
            .optional(),
          passportNumber: z.union([z.undefined(), z.string()]).optional(),
          passportExpiry: z.union([z.undefined(), z.string()]).optional(),
          passportCountry: z.union([z.undefined(), z.string()]).optional(),
          nationality: z.union([z.undefined(), z.string()]).optional(),
          frequentFlyerNumber: z.union([z.undefined(), z.string()]).optional(),
          frequentFlyerAirline: z.union([z.undefined(), z.string()]).optional(),
        })
      ),
      contactInfo: z.object({
        emailAddress: z.string(),
        phoneNumber: z.string(),
        phoneCountryCode: z.union([z.undefined(), z.string()]).optional(),
        email: z.union([z.undefined(), z.string()]).optional(),
        phone: z.union([z.undefined(), z.string()]).optional(),
        address: z
          .union([
            z.undefined(),
            z.string(),
            z.object({
              street: z.union([z.undefined(), z.string()]).optional(),
              city: z.union([z.undefined(), z.string()]).optional(),
              state: z.union([z.undefined(), z.string()]).optional(),
              postalCode: z.union([z.undefined(), z.string()]).optional(),
              country: z.union([z.undefined(), z.string()]).optional(),
            }),
          ])
          .optional(),
      }),
      paymentMethod: z.union([z.null(), z.string()]),
      totalAmount: outputNumber,
      currency: z.string(),
      ticketNumbers: z.array(z.string()),
      emdNumbers: z.array(z.string()),
      status: z.enum([
        "cancelled",
        "pending",
        "confirmed",
        "refunded",
        "changed",
        "ticketed",
        "partially_ticketed",
      ]),
      channel: z.enum([
        "direct",
        "ndc_aggregator",
        "gds",
        "ota",
        "travel_agent",
      ]),
      distributorId: z.union([z.null(), z.string()]),
      servicingHistory: z.array(
        z.object({
          action: z.string(),
          timestamp: z.string(),
          details: z.string(),
          performedBy: z.union([z.undefined(), z.string()]).optional(),
        })
      ),
      createdAt: z.string(),
      updatedAt: z.string(),
      ndcVersion: z.string(),
    }),
  }),
  retrieveOrder: z.object({
    success: z.boolean(),
    data: z.object({
      orderId: z.string(),
      offerId: z.string(),
      bookingId: z.union([z.null(), outputNumber]),
      userId: z.union([z.undefined(), outputNumber]).optional(),
      airline: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
      }),
      passengers: z.array(
        z.object({
          type: z.enum(["adult", "child", "infant"]),
          title: z.union([z.undefined(), z.string()]).optional(),
          firstName: z.string(),
          lastName: z.string(),
          dateOfBirth: z.union([z.undefined(), z.string()]).optional(),
          gender: z
            .union([z.undefined(), z.literal("male"), z.literal("female")])
            .optional(),
          passportNumber: z.union([z.undefined(), z.string()]).optional(),
          passportExpiry: z.union([z.undefined(), z.string()]).optional(),
          passportCountry: z.union([z.undefined(), z.string()]).optional(),
          nationality: z.union([z.undefined(), z.string()]).optional(),
          frequentFlyerNumber: z.union([z.undefined(), z.string()]).optional(),
          frequentFlyerAirline: z.union([z.undefined(), z.string()]).optional(),
        })
      ),
      contactInfo: z.object({
        emailAddress: z.string(),
        phoneNumber: z.string(),
        phoneCountryCode: z.union([z.undefined(), z.string()]).optional(),
        email: z.union([z.undefined(), z.string()]).optional(),
        phone: z.union([z.undefined(), z.string()]).optional(),
        address: z
          .union([
            z.undefined(),
            z.string(),
            z.object({
              street: z.union([z.undefined(), z.string()]).optional(),
              city: z.union([z.undefined(), z.string()]).optional(),
              state: z.union([z.undefined(), z.string()]).optional(),
              postalCode: z.union([z.undefined(), z.string()]).optional(),
              country: z.union([z.undefined(), z.string()]).optional(),
            }),
          ])
          .optional(),
      }),
      paymentMethod: z.union([z.null(), z.string()]),
      totalAmount: outputNumber,
      currency: z.string(),
      ticketNumbers: z.array(z.string()),
      emdNumbers: z.array(z.string()),
      status: z.enum([
        "cancelled",
        "pending",
        "confirmed",
        "refunded",
        "changed",
        "ticketed",
        "partially_ticketed",
      ]),
      channel: z.enum([
        "direct",
        "ndc_aggregator",
        "gds",
        "ota",
        "travel_agent",
      ]),
      distributorId: z.union([z.null(), z.string()]),
      servicingHistory: z.array(
        z.object({
          action: z.string(),
          timestamp: z.string(),
          details: z.string(),
          performedBy: z.union([z.undefined(), z.string()]).optional(),
        })
      ),
      createdAt: z.string(),
      updatedAt: z.string(),
      ndcVersion: z.string(),
    }),
  }),
  cancelOrder: z.object({
    success: z.boolean(),
    data: z.object({
      orderId: z.string(),
      offerId: z.string(),
      bookingId: z.union([z.null(), outputNumber]),
      userId: z.union([z.undefined(), outputNumber]).optional(),
      airline: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
      }),
      passengers: z.array(
        z.object({
          type: z.enum(["adult", "child", "infant"]),
          title: z.union([z.undefined(), z.string()]).optional(),
          firstName: z.string(),
          lastName: z.string(),
          dateOfBirth: z.union([z.undefined(), z.string()]).optional(),
          gender: z
            .union([z.undefined(), z.literal("male"), z.literal("female")])
            .optional(),
          passportNumber: z.union([z.undefined(), z.string()]).optional(),
          passportExpiry: z.union([z.undefined(), z.string()]).optional(),
          passportCountry: z.union([z.undefined(), z.string()]).optional(),
          nationality: z.union([z.undefined(), z.string()]).optional(),
          frequentFlyerNumber: z.union([z.undefined(), z.string()]).optional(),
          frequentFlyerAirline: z.union([z.undefined(), z.string()]).optional(),
        })
      ),
      contactInfo: z.object({
        emailAddress: z.string(),
        phoneNumber: z.string(),
        phoneCountryCode: z.union([z.undefined(), z.string()]).optional(),
        email: z.union([z.undefined(), z.string()]).optional(),
        phone: z.union([z.undefined(), z.string()]).optional(),
        address: z
          .union([
            z.undefined(),
            z.string(),
            z.object({
              street: z.union([z.undefined(), z.string()]).optional(),
              city: z.union([z.undefined(), z.string()]).optional(),
              state: z.union([z.undefined(), z.string()]).optional(),
              postalCode: z.union([z.undefined(), z.string()]).optional(),
              country: z.union([z.undefined(), z.string()]).optional(),
            }),
          ])
          .optional(),
      }),
      paymentMethod: z.union([z.null(), z.string()]),
      totalAmount: outputNumber,
      currency: z.string(),
      ticketNumbers: z.array(z.string()),
      emdNumbers: z.array(z.string()),
      status: z.enum([
        "cancelled",
        "pending",
        "confirmed",
        "refunded",
        "changed",
        "ticketed",
        "partially_ticketed",
      ]),
      channel: z.enum([
        "direct",
        "ndc_aggregator",
        "gds",
        "ota",
        "travel_agent",
      ]),
      distributorId: z.union([z.null(), z.string()]),
      servicingHistory: z.array(
        z.object({
          action: z.string(),
          timestamp: z.string(),
          details: z.string(),
          performedBy: z.union([z.undefined(), z.string()]).optional(),
        })
      ),
      createdAt: z.string(),
      updatedAt: z.string(),
      ndcVersion: z.string(),
    }),
  }),
  changeOrder: z.object({
    success: z.boolean(),
    data: z.object({
      orderId: z.string(),
      offerId: z.string(),
      bookingId: z.union([z.null(), outputNumber]),
      userId: z.union([z.undefined(), outputNumber]).optional(),
      airline: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
      }),
      passengers: z.array(
        z.object({
          type: z.enum(["adult", "child", "infant"]),
          title: z.union([z.undefined(), z.string()]).optional(),
          firstName: z.string(),
          lastName: z.string(),
          dateOfBirth: z.union([z.undefined(), z.string()]).optional(),
          gender: z
            .union([z.undefined(), z.literal("male"), z.literal("female")])
            .optional(),
          passportNumber: z.union([z.undefined(), z.string()]).optional(),
          passportExpiry: z.union([z.undefined(), z.string()]).optional(),
          passportCountry: z.union([z.undefined(), z.string()]).optional(),
          nationality: z.union([z.undefined(), z.string()]).optional(),
          frequentFlyerNumber: z.union([z.undefined(), z.string()]).optional(),
          frequentFlyerAirline: z.union([z.undefined(), z.string()]).optional(),
        })
      ),
      contactInfo: z.object({
        emailAddress: z.string(),
        phoneNumber: z.string(),
        phoneCountryCode: z.union([z.undefined(), z.string()]).optional(),
        email: z.union([z.undefined(), z.string()]).optional(),
        phone: z.union([z.undefined(), z.string()]).optional(),
        address: z
          .union([
            z.undefined(),
            z.string(),
            z.object({
              street: z.union([z.undefined(), z.string()]).optional(),
              city: z.union([z.undefined(), z.string()]).optional(),
              state: z.union([z.undefined(), z.string()]).optional(),
              postalCode: z.union([z.undefined(), z.string()]).optional(),
              country: z.union([z.undefined(), z.string()]).optional(),
            }),
          ])
          .optional(),
      }),
      paymentMethod: z.union([z.null(), z.string()]),
      totalAmount: outputNumber,
      currency: z.string(),
      ticketNumbers: z.array(z.string()),
      emdNumbers: z.array(z.string()),
      status: z.enum([
        "cancelled",
        "pending",
        "confirmed",
        "refunded",
        "changed",
        "ticketed",
        "partially_ticketed",
      ]),
      channel: z.enum([
        "direct",
        "ndc_aggregator",
        "gds",
        "ota",
        "travel_agent",
      ]),
      distributorId: z.union([z.null(), z.string()]),
      servicingHistory: z.array(
        z.object({
          action: z.string(),
          timestamp: z.string(),
          details: z.string(),
          performedBy: z.union([z.undefined(), z.string()]).optional(),
        })
      ),
      createdAt: z.string(),
      updatedAt: z.string(),
      ndcVersion: z.string(),
    }),
  }),
  addServices: z.object({
    success: z.boolean(),
    data: z.object({
      orderId: z.string(),
      offerId: z.string(),
      bookingId: z.union([z.null(), outputNumber]),
      userId: z.union([z.undefined(), outputNumber]).optional(),
      airline: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
      }),
      passengers: z.array(
        z.object({
          type: z.enum(["adult", "child", "infant"]),
          title: z.union([z.undefined(), z.string()]).optional(),
          firstName: z.string(),
          lastName: z.string(),
          dateOfBirth: z.union([z.undefined(), z.string()]).optional(),
          gender: z
            .union([z.undefined(), z.literal("male"), z.literal("female")])
            .optional(),
          passportNumber: z.union([z.undefined(), z.string()]).optional(),
          passportExpiry: z.union([z.undefined(), z.string()]).optional(),
          passportCountry: z.union([z.undefined(), z.string()]).optional(),
          nationality: z.union([z.undefined(), z.string()]).optional(),
          frequentFlyerNumber: z.union([z.undefined(), z.string()]).optional(),
          frequentFlyerAirline: z.union([z.undefined(), z.string()]).optional(),
        })
      ),
      contactInfo: z.object({
        emailAddress: z.string(),
        phoneNumber: z.string(),
        phoneCountryCode: z.union([z.undefined(), z.string()]).optional(),
        email: z.union([z.undefined(), z.string()]).optional(),
        phone: z.union([z.undefined(), z.string()]).optional(),
        address: z
          .union([
            z.undefined(),
            z.string(),
            z.object({
              street: z.union([z.undefined(), z.string()]).optional(),
              city: z.union([z.undefined(), z.string()]).optional(),
              state: z.union([z.undefined(), z.string()]).optional(),
              postalCode: z.union([z.undefined(), z.string()]).optional(),
              country: z.union([z.undefined(), z.string()]).optional(),
            }),
          ])
          .optional(),
      }),
      paymentMethod: z.union([z.null(), z.string()]),
      totalAmount: outputNumber,
      currency: z.string(),
      ticketNumbers: z.array(z.string()),
      emdNumbers: z.array(z.string()),
      status: z.enum([
        "cancelled",
        "pending",
        "confirmed",
        "refunded",
        "changed",
        "ticketed",
        "partially_ticketed",
      ]),
      channel: z.enum([
        "direct",
        "ndc_aggregator",
        "gds",
        "ota",
        "travel_agent",
      ]),
      distributorId: z.union([z.null(), z.string()]),
      servicingHistory: z.array(
        z.object({
          action: z.string(),
          timestamp: z.string(),
          details: z.string(),
          performedBy: z.union([z.undefined(), z.string()]).optional(),
        })
      ),
      createdAt: z.string(),
      updatedAt: z.string(),
      ndcVersion: z.string(),
    }),
  }),
  listOrders: z.object({
    success: z.boolean(),
    data: z.object({
      orders: z.array(
        z.object({
          orderId: z.string(),
          offerId: z.string(),
          bookingId: z.union([z.null(), outputNumber]),
          userId: z.union([z.undefined(), outputNumber]).optional(),
          airline: z.object({
            id: outputNumber,
            code: z.string(),
            name: z.string(),
          }),
          passengers: z.array(
            z.object({
              type: z.enum(["adult", "child", "infant"]),
              title: z.union([z.undefined(), z.string()]).optional(),
              firstName: z.string(),
              lastName: z.string(),
              dateOfBirth: z.union([z.undefined(), z.string()]).optional(),
              gender: z
                .union([z.undefined(), z.literal("male"), z.literal("female")])
                .optional(),
              passportNumber: z.union([z.undefined(), z.string()]).optional(),
              passportExpiry: z.union([z.undefined(), z.string()]).optional(),
              passportCountry: z.union([z.undefined(), z.string()]).optional(),
              nationality: z.union([z.undefined(), z.string()]).optional(),
              frequentFlyerNumber: z
                .union([z.undefined(), z.string()])
                .optional(),
              frequentFlyerAirline: z
                .union([z.undefined(), z.string()])
                .optional(),
            })
          ),
          contactInfo: z.object({
            emailAddress: z.string(),
            phoneNumber: z.string(),
            phoneCountryCode: z.union([z.undefined(), z.string()]).optional(),
            email: z.union([z.undefined(), z.string()]).optional(),
            phone: z.union([z.undefined(), z.string()]).optional(),
            address: z
              .union([
                z.undefined(),
                z.string(),
                z.object({
                  street: z.union([z.undefined(), z.string()]).optional(),
                  city: z.union([z.undefined(), z.string()]).optional(),
                  state: z.union([z.undefined(), z.string()]).optional(),
                  postalCode: z.union([z.undefined(), z.string()]).optional(),
                  country: z.union([z.undefined(), z.string()]).optional(),
                }),
              ])
              .optional(),
          }),
          paymentMethod: z.union([z.null(), z.string()]),
          totalAmount: outputNumber,
          currency: z.string(),
          ticketNumbers: z.array(z.string()),
          emdNumbers: z.array(z.string()),
          status: z.enum([
            "cancelled",
            "pending",
            "confirmed",
            "refunded",
            "changed",
            "ticketed",
            "partially_ticketed",
          ]),
          channel: z.enum([
            "direct",
            "ndc_aggregator",
            "gds",
            "ota",
            "travel_agent",
          ]),
          distributorId: z.union([z.null(), z.string()]),
          servicingHistory: z.array(
            z.object({
              action: z.string(),
              timestamp: z.string(),
              details: z.string(),
              performedBy: z.union([z.undefined(), z.string()]).optional(),
            })
          ),
          createdAt: z.string(),
          updatedAt: z.string(),
          ndcVersion: z.string(),
        })
      ),
      total: outputNumber,
    }),
  }),
  getOrderHistory: z.object({
    success: z.boolean(),
    data: z.object({
      orders: z.array(
        z.object({
          orderId: z.string(),
          offerId: z.string(),
          bookingId: z.union([z.null(), outputNumber]),
          userId: z.union([z.undefined(), outputNumber]).optional(),
          airline: z.object({
            id: outputNumber,
            code: z.string(),
            name: z.string(),
          }),
          passengers: z.array(
            z.object({
              type: z.enum(["adult", "child", "infant"]),
              title: z.union([z.undefined(), z.string()]).optional(),
              firstName: z.string(),
              lastName: z.string(),
              dateOfBirth: z.union([z.undefined(), z.string()]).optional(),
              gender: z
                .union([z.undefined(), z.literal("male"), z.literal("female")])
                .optional(),
              passportNumber: z.union([z.undefined(), z.string()]).optional(),
              passportExpiry: z.union([z.undefined(), z.string()]).optional(),
              passportCountry: z.union([z.undefined(), z.string()]).optional(),
              nationality: z.union([z.undefined(), z.string()]).optional(),
              frequentFlyerNumber: z
                .union([z.undefined(), z.string()])
                .optional(),
              frequentFlyerAirline: z
                .union([z.undefined(), z.string()])
                .optional(),
            })
          ),
          contactInfo: z.object({
            emailAddress: z.string(),
            phoneNumber: z.string(),
            phoneCountryCode: z.union([z.undefined(), z.string()]).optional(),
            email: z.union([z.undefined(), z.string()]).optional(),
            phone: z.union([z.undefined(), z.string()]).optional(),
            address: z
              .union([
                z.undefined(),
                z.string(),
                z.object({
                  street: z.union([z.undefined(), z.string()]).optional(),
                  city: z.union([z.undefined(), z.string()]).optional(),
                  state: z.union([z.undefined(), z.string()]).optional(),
                  postalCode: z.union([z.undefined(), z.string()]).optional(),
                  country: z.union([z.undefined(), z.string()]).optional(),
                }),
              ])
              .optional(),
          }),
          paymentMethod: z.union([z.null(), z.string()]),
          totalAmount: outputNumber,
          currency: z.string(),
          ticketNumbers: z.array(z.string()),
          emdNumbers: z.array(z.string()),
          status: z.enum([
            "cancelled",
            "pending",
            "confirmed",
            "refunded",
            "changed",
            "ticketed",
            "partially_ticketed",
          ]),
          channel: z.enum([
            "direct",
            "ndc_aggregator",
            "gds",
            "ota",
            "travel_agent",
          ]),
          distributorId: z.union([z.null(), z.string()]),
          servicingHistory: z.array(
            z.object({
              action: z.string(),
              timestamp: z.string(),
              details: z.string(),
              performedBy: z.union([z.undefined(), z.string()]).optional(),
            })
          ),
          createdAt: z.string(),
          updatedAt: z.string(),
          ndcVersion: z.string(),
        })
      ),
      total: outputNumber,
    }),
  }),
  expireOffers: z.object({ success: z.boolean(), data: outputNumber }),
  getStatistics: z.object({
    success: z.boolean(),
    data: z.object({
      totalOffers: outputNumber,
      activeOffers: outputNumber,
      expiredOffers: outputNumber,
      totalOrders: outputNumber,
      ordersByStatus: z.record(z.string(), outputNumber),
      ordersByChannel: z.record(z.string(), outputNumber),
      totalRevenue: outputNumber,
      currency: z.string(),
    }),
  }),
};
