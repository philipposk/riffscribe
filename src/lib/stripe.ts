import Stripe from "stripe";

/** Tag on every subscription we create; the shared Stripe account fans events out to every 6x7 app. */
export const APP = "riffscribe";
export const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://riffscribe.6x7.gr";
/** Labels our Checkout Sessions in the Dashboard: a constant name plus 8 random letters, per Stripe. */
export const CHECKOUT_TAG = "riffscribe_pro_checkout_qmxvtrka";

let cached: Stripe | null = null;

/** Built on first use — Stripe's constructor throws on an empty key, and billing is optional. */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!cached)
    cached = new Stripe(key, {
      // The default of the installed stripe-node (22.6.2). The live webhook
      // endpoint must be created with this same version; change both together.
      apiVersion: "2026-08-26.dahlia",
      // The SDK adds its own idempotency keys to these retries.
      maxNetworkRetries: 2,
      appInfo: { name: "riffscribe" },
    });
  return cached;
}

export const billingConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO);

/** The key is a live one (secret or restricted). Test-mode ids and events are then ignored. */
export const liveMode = () => /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "");

/** An opt-in server flag: on only when set to exactly "true". */
export const flag = (name: string) => process.env[name] === "true";

const ALLOWED_ORIGINS = [
  /^https:\/\/riffscribe\.6x7\.gr$/,
  /^https:\/\/riffscribe-[a-z0-9-]+\.vercel\.app$/, // previews, which run on test keys
  /^http:\/\/localhost:\d+$/,
];

/** Where Stripe sends the person back to: the request's own origin if it is one of ours, else the site. */
export function origin(req: Request): string {
  const o = req.headers.get("origin") ?? "";
  return ALLOWED_ORIGINS.some((r) => r.test(o)) ? o : SITE;
}
