import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPublicTenant } from "@/lib/tenant";
import { loadBookingByToken } from "@/lib/bookings";
import { HttpError } from "@/lib/errors";
import { accentStyle } from "@/renderer/theme";
import { BookingStatus } from "@/components/booking/BookingStatus";

export const dynamic = "force-dynamic";

export default async function BookingPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const token = sp["token"];
  const tenant = await loadPublicTenant(slug);
  if (!tenant) notFound();

  let booking = null;
  if (token && token.length === 48) {
    try {
      booking = await loadBookingByToken(id, token);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
  }

  return (
    <div style={accentStyle(tenant.config)} className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 md:px-10">
        <Link href={`/${slug}`} className="font-display text-2xl font-semibold tracking-tight">
          {tenant.name}
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-6 pb-32 pt-6 md:px-10 md:pt-12">
        {booking && token ? (
          <BookingStatus initial={booking} token={token} timezone={tenant.timezone} slug={slug} justPaid={sp["paid"] === "1"} />
        ) : (
          <div className="glass rounded-3xl p-8 text-center">
            <p className="font-display text-3xl">We couldn&apos;t find that booking.</p>
            <p className="mt-2 text-stone">Use the link from your confirmation, or make a new booking.</p>
            <Link href={`/${slug}/book`} className="mt-6 inline-block text-sm text-charcoal underline-offset-4 hover:underline">
              Book again
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
