import { notFound } from "next/navigation";
import Link from "next/link";
import { loadActiveResources, loadPublicTenant } from "@/lib/tenant";
import { accentStyle } from "@/renderer/theme";
import { BookingFlow } from "@/components/booking/BookingFlow";

export const dynamic = "force-dynamic";

export default async function BookPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = await loadPublicTenant(slug);
  if (!tenant) notFound();
  const resources = await loadActiveResources(tenant.id);

  return (
    <div style={accentStyle(tenant.config)} className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 md:px-10">
        <Link href={`/${slug}`} className="font-display text-2xl font-semibold tracking-tight">
          {tenant.name}
        </Link>
        <Link href={`/${slug}`} className="text-sm text-stone hover:text-charcoal">
          ← Back
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-32 md:px-10">
        <BookingFlow
          slug={slug}
          config={tenant.config}
          currency={tenant.currency}
          timezone={tenant.timezone}
          resources={resources}
          canPay={tenant.chargesEnabled}
          initialService={sp["service"] ?? null}
          initialSession={sp["session"] ?? null}
        />
      </main>
    </div>
  );
}
