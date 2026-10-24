import { z } from "zod";

const Server = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  STRIPE_CONNECT_COUNTRY: z.string().length(2).default("DE"),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(300),
  PLATFORM_FEE_FIXED_CENTS: z.coerce.number().int().min(0).default(25),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-5"),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

let cached: z.infer<typeof Server> | null = null;

/** Server-only. Throws at first use if the environment is misconfigured. */
export function env(): z.infer<typeof Server> {
  if (cached) return cached;
  const r = Server.safeParse(process.env);
  if (!r.success) {
    const missing = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  cached = r.data;
  return cached;
}
