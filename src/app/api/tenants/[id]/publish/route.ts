import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { rpcData, toResponse } from "@/lib/errors";
import { requireOwner } from "@/lib/ownership";

const Body = z.object({ published: z.boolean() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { published } = Body.parse(await req.json());
    const { owner, tenant } = await requireOwner(z.string().uuid().parse(id));
    rpcData(await admin().rpc("set_published", { p_tenant: tenant.id, p_owner: owner.id, p_published: published }));
    return NextResponse.json({ published, url: `/${tenant.slug}` });
  } catch (e) {
    return toResponse(e);
  }
}
