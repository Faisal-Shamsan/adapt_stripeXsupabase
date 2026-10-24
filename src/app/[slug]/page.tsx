import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { admin } from "@/lib/supabase/admin";
import { loadActiveResources, loadPublicTenant } from "@/lib/tenant";
import { Site } from "@/renderer/Site";
import type { SessionView } from "@/renderer/sections/Classes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await loadPublicTenant((await params).slug);
  return t ? { title: t.name, description: t.config.business.tagline } : {};
}

export default async function TenantPage({ params }: Params) {
  const { slug } = await params;
  const tenant = await loadPublicTenant(slug);
  if (!tenant) notFound();

  const resources = await loadActiveResources(tenant.id);
  let sessions: SessionView[] = [];
  if (tenant.config.ui.sections.includes("classes")) {
    const from = new Date();
    const { data } = await admin().rpc("available_sessions", { p_tenant: tenant.id, p_from: from.toISOString(), p_to: new Date(from.getTime() + 14 * 86_400_000).toISOString() });
    const byId = new Map(resources.map((r) => [r.id, r.label]));
    sessions = ((data ?? []) as { session_id: string; service_key: string; starts_at: string; ends_at: string; instructor_id: string | null; capacity: number; spots_left: number; spot_kind: string | null }[]).map((r) => ({
      id: r.session_id,
      serviceKey: r.service_key,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      instructor: r.instructor_id ? (byId.get(r.instructor_id) ?? null) : null,
      capacity: r.capacity,
      spotsLeft: r.spots_left,
      spotKind: r.spot_kind,
    }));
  }

  return <Site slug={slug} config={tenant.config} currency={tenant.currency} timezone={tenant.timezone} resources={resources} sessions={sessions} canPay={tenant.chargesEnabled} />;
}
