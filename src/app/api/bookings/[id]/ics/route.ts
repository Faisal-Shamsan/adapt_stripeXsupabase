import { z } from "zod";
import { toResponse } from "@/lib/errors";
import { buildIcs } from "@/lib/ics";
import { env } from "@/lib/env";
import { loadBookingByToken } from "@/lib/bookings";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const token = z.string().length(48).parse(new URL(req.url).searchParams.get("token"));
    z.string().uuid().parse(id);
    const b = await loadBookingByToken(id, token);
    const ics = buildIcs({
      uid: b.id,
      start: new Date(b.starts_at),
      end: new Date(b.ends_at),
      summary: `${b.service_key.replace(/-/g, " ")} — ${b.tenant_name}`,
      description: b.resources?.length ? `With: ${b.resources.join(", ")}` : undefined,
      url: `${env().NEXT_PUBLIC_APP_URL}/${b.tenant_slug}/booking/${b.id}?token=${token}`,
    });
    return new Response(ics, {
      headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="booking-${b.id.slice(0, 8)}.ics"` },
    });
  } catch (e) {
    return toResponse(e);
  }
}
