import { notFound, redirect } from "next/navigation";
import { admin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { Dashboard } from "@/components/owner/Dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect(`/sign-in?next=/dashboard/${id}`);

  const sb = admin();
  const { data: t } = await sb
    .from("tenants")
    .select("id, slug, name, owner_id, published, config_version, stripe_account_id, charges_enabled, payouts_enabled, details_submitted, config")
    .eq("id", id)
    .maybeSingle();
  if (!t || t.owner_id !== user.id) notFound();

  const { data: chat } = await sb.rpc("recent_chat", { p_tenant: t.id, p_limit: 40 });

  return (
    <Dashboard
      tenant={{
        id: t.id,
        slug: t.slug,
        name: t.name,
        published: t.published,
        configVersion: t.config_version,
        hasConfig: t.config !== null,
        stripe: { connected: !!t.stripe_account_id, chargesEnabled: t.charges_enabled, payoutsEnabled: t.payouts_enabled, detailsSubmitted: t.details_submitted },
      }}
      ownerEmail={user.email}
      initialChat={((chat ?? []) as { role: "user" | "assistant"; content: { text: string; kind?: string; chips?: string[]; images?: number } }[]).map((m) => ({ role: m.role, ...m.content }))}
      connectReturned={sp["connect"] === "return"}
    />
  );
}
