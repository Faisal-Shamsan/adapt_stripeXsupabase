import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { HttpError, rpcData, toResponse } from "@/lib/errors";
import { requireOwner } from "@/lib/ownership";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { tenant } = await requireOwner(z.string().uuid().parse(id));
    const { data, error } = await admin().from("config_versions").select("version, source, prompt, created_at").eq("tenant_id", tenant.id).order("version", { ascending: false }).limit(50);
    if (error) throw new HttpError(500, "internal error");
    return NextResponse.json({ versions: data });
  } catch (e) {
    return toResponse(e);
  }
}

const Body = z.object({ version: z.number().int().positive() });

/** Roll back: re-applies the chosen version as a new version. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { version } = Body.parse(await req.json());
    const { owner, tenant } = await requireOwner(z.string().uuid().parse(id));
    const v = rpcData<number>(await admin().rpc("rollback_config", { p_tenant: tenant.id, p_owner: owner.id, p_version: version }));
    return NextResponse.json({ version: v });
  } catch (e) {
    return toResponse(e);
  }
}
