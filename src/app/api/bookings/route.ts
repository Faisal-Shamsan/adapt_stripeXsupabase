import { NextResponse } from "next/server";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { HttpError, rpcData, toResponse } from "@/lib/errors";

export const SLOT_STEP_MIN = 15;

const Customer = {
  email: z.string().email().max(200),
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(40).optional(),
};

const Body = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("slot"),
    tenantSlug: z.string().min(2).max(50),
    serviceKey: z.string().min(1).max(40),
    startsAt: z.string().datetime({ offset: true }),
    resourcePrefs: z.array(z.string().uuid()).max(5).default([]),
    ...Customer,
  }),
  z.object({
    kind: z.literal("class"),
    tenantSlug: z.string().min(2).max(50),
    sessionId: z.string().uuid(),
    spot: z.string().uuid().nullable().default(null),
    ...Customer,
  }),
]);

/** Customer creates a 31-minute hold. Prices are decided inside Postgres from the stored config. */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const sb = admin();

    const { data: tenant, error } = await sb.from("tenants").select("id, published").eq("slug", body.tenantSlug).maybeSingle();
    if (error) throw new HttpError(500, "internal error");
    if (!tenant || !tenant.published) throw new HttpError(404, "business not found");

    const bookingId =
      body.kind === "slot"
        ? rpcData<string>(
            await sb.rpc("create_booking_hold", {
              p_tenant: tenant.id,
              p_service_key: body.serviceKey,
              p_starts_at: body.startsAt,
              p_email: body.email,
              p_name: body.name,
              p_phone: body.phone ?? null,
              p_resource_prefs: body.resourcePrefs,
              p_source: "online",
              p_step_min: SLOT_STEP_MIN,
            }),
          )
        : rpcData<string>(
            await sb.rpc("book_class_spot", {
              p_tenant: tenant.id,
              p_session_id: body.sessionId,
              p_email: body.email,
              p_name: body.name,
              p_phone: body.phone ?? null,
              p_spot: body.spot,
              p_source: "online",
            }),
          );

    const { data: b } = await sb
      .from("bookings")
      .select("manage_token, amount_cents, deposit_cents, currency, hold_expires_at")
      .eq("id", bookingId)
      .single();
    if (!b) throw new HttpError(500, "internal error");

    return NextResponse.json(
      {
        bookingId,
        token: b.manage_token,
        dueNowCents: b.deposit_cents > 0 ? b.deposit_cents : b.amount_cents,
        totalCents: b.amount_cents,
        currency: b.currency,
        holdExpiresAt: b.hold_expires_at,
      },
      { status: 201 },
    );
  } catch (e) {
    return toResponse(e);
  }
}
