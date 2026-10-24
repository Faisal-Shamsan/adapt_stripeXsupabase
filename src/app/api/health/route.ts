import { NextResponse } from "next/server";
import { envStatus } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deployment health: which required variables are missing (names only — never values) and what commit is live. */
export async function GET() {
  const status = envStatus();
  return NextResponse.json(
    {
      ok: status.ok,
      missing: status.missing,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
    { status: status.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
