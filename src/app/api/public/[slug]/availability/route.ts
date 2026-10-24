import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { HttpError, rpcData, toResponse } from "@/lib/errors";
import { loadActiveResources, loadPublicTenant } from "@/lib/tenant";
import { SLOT_STEP_MIN } from "@/lib/bookings";

const Query = z.object({ service: z.string().min(1).max(40), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

type Row = { starts_at: string; ends_at: string; candidates: Record<string, string[]> };

/** Slots for one service on one local date, with the eligible resources per kind (labels for the picker). */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const url = new URL(req.url);
    const q = Query.parse({ service: url.searchParams.get("service"), date: url.searchParams.get("date") });

    const tenant = await loadPublicTenant(slug);
    if (!tenant) throw new HttpError(404, "business not found");
    const resources = await loadActiveResources(tenant.id);
    const byId = new Map(resources.map((r) => [r.id, r]));

    const rows = rpcData<Row[]>(await admin().rpc("available_slots", { p_tenant: tenant.id, p_service_key: q.service, p_date: q.date, p_step_min: SLOT_STEP_MIN }));

    return NextResponse.json({
      date: q.date,
      step: SLOT_STEP_MIN,
      slots: rows.map((r) => ({
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        candidates: Object.fromEntries(Object.entries(r.candidates).map(([kind, ids]) => [kind, ids.map((id) => byId.get(id)).filter(Boolean)])),
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
