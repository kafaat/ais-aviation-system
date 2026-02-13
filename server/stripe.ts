import Stripe from "stripe";

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not defined");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-12-15.clover",
      typescript: true,
    });
  }
  return _stripe;
}

export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const instance = getStripe();
    const value = Reflect.get(instance, prop, receiver);
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
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
