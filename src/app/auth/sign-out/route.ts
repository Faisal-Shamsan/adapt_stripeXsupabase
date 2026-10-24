import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function POST() {
  const sb = await serverSupabase();
  await sb.auth.signOut();
  return NextResponse.redirect(`${env().NEXT_PUBLIC_APP_URL}/`, 303);
}
