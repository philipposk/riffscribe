/**
 * What each plan allows. The database enforces these (riffscribe_limits in
 * supabase/accounts.sql) — this copy is only for showing them. Keep in step.
 *
 * Transcription and stem splitting run on the player's own machine and cost
 * nothing to serve, so they are never metered. What costs money is what lives
 * on the server: saved songs and the assistant.
 */
export type PlanId = "free" | "pro";

export const PLANS: Record<PlanId, { label: string; price: string; songs: number; assistant: number }> = {
  free: { label: "Free", price: "€0", songs: 10, assistant: 100 },
  pro: { label: "Pro", price: "€5 / month", songs: 1000, assistant: 2000 },
};

export function planLabel(plan: string | null | undefined): string {
  return plan && plan in PLANS ? PLANS[plan as PlanId].label : plan === "max" ? "Max" : "Pro";
}
