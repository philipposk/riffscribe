// Pro stays visible but can't be bought until Stripe is set up on this deployment.
// Set NEXT_PUBLIC_BILLING_ENABLED=true (build-time) once the Stripe keys and price id are in place.
export const BILLING_LIVE = process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";
