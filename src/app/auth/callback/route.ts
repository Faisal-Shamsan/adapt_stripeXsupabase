import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/** Magic-link landing: exchange the code for a session cookie, then continue. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/new";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/new";
  if (code) {
    const sb = await serverSupabase();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${env().NEXT_PUBLIC_APP_URL}${safeNext}`);
  }
  return NextResponse.redirect(`${env().NEXT_PUBLIC_APP_URL}/sign-in?error=link`);
}
