import Stripe from "stripe";

/** Tag on every subscription we create; the shared Stripe account fans events out to every 6x7 app. */
export const APP = "riffscribe";

let cached: Stripe | null = null;

/** Built on first use — Stripe's constructor throws on an empty key, and billing is optional. */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!cached) cached = new Stripe(key);
  return cached;
}

export const billingConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO);

export function origin(req: Request): string {
  return req.headers.get("origin") || "https://riffscribe.6x7.gr";
}
