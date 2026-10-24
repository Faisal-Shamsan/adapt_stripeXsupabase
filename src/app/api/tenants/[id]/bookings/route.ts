import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { rpcData, toResponse } from "@/lib/errors";
import { requireOwner } from "@/lib/ownership";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { owner, tenant } = await requireOwner(z.string().uuid().parse(id));
    const rows = rpcData<unknown[]>(await admin().rpc("owner_bookings", { p_tenant: tenant.id, p_owner: owner.id }));
    return NextResponse.json({ bookings: rows });
  } catch (e) {
    return toResponse(e);
  }
}
