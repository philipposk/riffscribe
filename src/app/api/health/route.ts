/** Liveness and configuration check: env presence only, no secrets and no outbound calls. */
export const dynamic = "force-dynamic";

const has = (...names: string[]) => names.every((n) => Boolean(process.env[n]));

export function GET() {
  return Response.json(
    {
      ok: true,
      supabase: has("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      assistant: has("OPENROUTER_API_KEY") || has("ANTHROPIC_API_KEY"),
      billing: has("STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO", "STRIPE_WEBHOOK_SECRET"),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
