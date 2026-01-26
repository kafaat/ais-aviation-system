import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not defined");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
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
