import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const sb = await serverSupabase();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/", new URL(req.url).origin), 303);
}
