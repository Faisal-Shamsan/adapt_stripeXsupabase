import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { HttpError, rpcData, toResponse } from "@/lib/errors";
import { loadActiveResources, loadPublicTenant } from "@/lib/tenant";

const Query = z.object({ from: z.string().datetime({ offset: true }).optional(), days: z.coerce.number().int().min(1).max(60).default(14) });

type Row = {
  session_id: string;
  service_key: string;
  starts_at: string;
  ends_at: string;
  instructor_id: string | null;
  capacity: number;
  spots_left: number;
  spot_kind: string | null;
  free_spots: string[] | null;
};

/** Upcoming class sessions with remaining capacity and, for spot classes, the free spots. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const url = new URL(req.url);
    const q = Query.parse({ from: url.searchParams.get("from") ?? undefined, days: url.searchParams.get("days") ?? undefined });

    const tenant = await loadPublicTenant(slug);
    if (!tenant) throw new HttpError(404, "business not found");
    const resources = await loadActiveResources(tenant.id);
    const byId = new Map(resources.map((r) => [r.id, r]));

    const from = q.from ? new Date(q.from) : new Date();
    const to = new Date(from.getTime() + q.days * 86_400_000);
    const rows = rpcData<Row[]>(await admin().rpc("available_sessions", { p_tenant: tenant.id, p_from: from.toISOString(), p_to: to.toISOString() }));

    return NextResponse.json({
      sessions: rows.map((r) => ({
        id: r.session_id,
        serviceKey: r.service_key,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        instructor: r.instructor_id ? (byId.get(r.instructor_id)?.label ?? null) : null,
        capacity: r.capacity,
        spotsLeft: r.spots_left,
        spotKind: r.spot_kind,
        freeSpots: r.free_spots?.map((id) => byId.get(id)).filter(Boolean) ?? null,
      })),
    });
  } catch (e) {
    return toResponse(e);
  }
}
