import { notFound, redirect } from "next/navigation";
import { admin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { loadActiveResources } from "@/lib/tenant";
import { TenantConfig } from "@/engine/schema";
import { Site } from "@/renderer/Site";
import { Display, Eyebrow } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Owner-only render of the current (possibly unpublished) config. Same renderer as the public site. */
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/auth/start?next=/preview/${id}`);

  const { data } = await admin().from("tenants").select("id, slug, owner_id, currency, timezone, charges_enabled, config").eq("id", id).maybeSingle();
  if (!data || data.owner_id !== user.id) notFound();

  if (!data.config) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6 text-center">
        <div className="rise">
          <Eyebrow>Live preview</Eyebrow>
          <Display className="mt-4 text-4xl">Your site will appear here</Display>
          <p className="mt-3 text-stone">Describe your business in the chat to get started.</p>
        </div>
      </main>
    );
  }

  const config = TenantConfig.parse(data.config);
  const resources = await loadActiveResources(data.id);
  const { data: sess } = await admin().rpc("available_sessions", { p_tenant: data.id, p_from: new Date().toISOString(), p_to: new Date(Date.now() + 14 * 86_400_000).toISOString() });
  const byId = new Map(resources.map((r) => [r.id, r.label]));
  const sessions = ((sess ?? []) as { session_id: string; service_key: string; starts_at: string; ends_at: string; instructor_id: string | null; capacity: number; spots_left: number; spot_kind: string | null }[]).map((r) => ({
    id: r.session_id,
    serviceKey: r.service_key,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    instructor: r.instructor_id ? (byId.get(r.instructor_id) ?? null) : null,
    capacity: r.capacity,
    spotsLeft: r.spots_left,
    spotKind: r.spot_kind,
  }));

  return <Site slug={data.slug} config={config} currency={data.currency} timezone={data.timezone} resources={resources} sessions={sessions} canPay={data.charges_enabled} />;
}
