import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Magic-link landing: exchange the code for a session cookie, then continue.
 * Redirects stay on the request's own origin so the PKCE/session cookies set during sign-in are the ones we read.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/new";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/new";
  if (code) {
    const sb = await serverSupabase();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
    return NextResponse.redirect(new URL(`/sign-in?error=${encodeURIComponent(error.message)}`, url.origin));
  }
  return NextResponse.redirect(new URL("/sign-in?error=missing_code", url.origin));
}
