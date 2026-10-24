"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Anon-key client for the browser: auth and RLS-scoped reads (owner sees own tenant's rows) only. */
export function browserSupabase() {
  // Dot access: Next only inlines NEXT_PUBLIC_* for this form at build time.
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
