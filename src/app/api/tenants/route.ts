import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { HttpError, rpcData, toResponse } from "@/lib/errors";
import { currentUser } from "@/lib/supabase/server";

const Body = z.object({ name: z.string().trim().min(1).max(60) });

/** Signed-in user creates a new business. */
export async function POST(req: Request) {
  try {
    const { name } = Body.parse(await req.json());
    const user = await currentUser();
    if (!user) throw new HttpError(401, "sign in required");
    const rows = rpcData<{ id: string; slug: string }[]>(await admin().rpc("create_tenant", { p_owner: user.id, p_name: name }));
    return NextResponse.json(rows[0], { status: 201 });
  } catch (e) {
    return toResponse(e);
  }
}

/** The signed-in user's businesses. */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, "sign in required");
    const { data, error } = await admin().from("tenants").select("id, slug, name, published, config_version").eq("owner_id", user.id).order("created_at");
    if (error) throw new HttpError(500, "internal error");
    return NextResponse.json({ tenants: data });
  } catch (e) {
    return toResponse(e);
  }
}
