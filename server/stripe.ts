import Stripe from "stripe";

// Allow tests to run without STRIPE_SECRET_KEY in test environments
if (!process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV !== "test") {
  throw new Error("STRIPE_SECRET_KEY is not defined");
}

// Create a dummy stripe instance for test environments without STRIPE_SECRET_KEY
const stripeKey =
  process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_for_tests_only";

export const stripe = new Stripe(stripeKey, {
  apiVersion: "2025-12-15.clover",
  typescript: true,
});

// Product definitions for flights
export const FLIGHT_PRODUCTS = {
  ECONOMY_TICKET: {
    name: "Economy Class Ticket",
    description: "Standard economy class flight ticket",
  },
  BUSINESS_TICKET: {
    name: "Business Class Ticket",
    description: "Premium business class flight ticket with extra amenities",
  },
} as const;
