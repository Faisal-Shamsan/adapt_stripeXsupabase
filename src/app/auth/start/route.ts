import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * "Get started": make sure the browser has an owner session, creating an anonymous Supabase user if needed.
 * Ownership, RLS and every server check work exactly as with a signed-in user; there is simply no email step.
 * Route Handlers may set cookies, which is why this is not done in a page.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/new";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/new";

  const sb = await serverSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) {
    const { error } = await sb.auth.signInAnonymously();
    if (error) {
      console.error("anonymous sign-in failed", error.message);
      return NextResponse.redirect(new URL("/?error=start", url.origin), 303);
    }
  }
  return NextResponse.redirect(new URL(safeNext, url.origin), 303);
}
