import { NextResponse } from "next/server";
import { z } from "zod";
import { toResponse } from "@/lib/errors";
import { loadBookingByToken } from "@/lib/bookings";

/** Customer view of a booking, authorised by the manage token. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const token = z.string().length(48).parse(new URL(req.url).searchParams.get("token"));
    z.string().uuid().parse(id);
    return NextResponse.json(await loadBookingByToken(id, token));
  } catch (e) {
    return toResponse(e);
  }
}
