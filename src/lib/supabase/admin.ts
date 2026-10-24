import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

let client: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS and may call the revoked SECURITY DEFINER functions.
 * Import only from server code (API routes, server actions, lib). Never from components.
 */
export function admin(): SupabaseClient {
  if (!client) {
    client = createClient(env().NEXT_PUBLIC_SUPABASE_URL, env().SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
