import Link from "next/link";
import { Button, Display, Eyebrow } from "@/components/ui";

export default async function Landing({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-6 py-10 md:px-10">
      <header className="flex items-center justify-between">
        <span className="font-display text-2xl font-semibold tracking-tight">Adapt</span>
        <Link href="/new" className="tactile rounded-full px-4 py-2 text-sm text-charcoal-2 hover:text-charcoal">
          Your businesses
        </Link>
      </header>

      <section className="flex flex-1 flex-col items-start justify-center py-24">
        <Eyebrow className="rise">For gyms, salons, spas, studios and clubs</Eyebrow>
        <Display className="rise rise-1 mt-6 max-w-3xl text-6xl md:text-7xl lg:text-8xl">
          Describe your business.
          <br />
          <span className="italic text-charcoal-2">Get a booking system.</span>
        </Display>
        <p className="rise rise-2 mt-8 max-w-xl text-lg leading-relaxed text-stone">
          Talk to Adapt — or send a photo of your price list and floor plan. In minutes your customers can book, pick their spot and pay.
          No templates, no code, no sign-up.
        </p>
        <div className="rise rise-3 mt-10 flex items-center gap-3">
          {/* Full navigation on purpose: the route sets the session cookie before redirecting. */}
          <form action="/auth/start" method="get">
            <input type="hidden" name="next" value="/new" />
            <Button size="lg" type="submit">
              Get started
            </Button>
          </form>
          <Link href="/harbourside-padel">
            <Button size="lg" variant="ghost">
              See a live site
            </Button>
          </Link>
        </div>
        {sp["error"] === "start" && <p className="rise mt-6 rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">We couldn&apos;t start a session just now — please try again.</p>}
      </section>

      <footer className="flex items-center justify-between text-xs text-stone-2">
        <span>Payments by Stripe · Data in Supabase</span>
        <span>© {new Date().getFullYear()} Adapt</span>
      </footer>
    </main>
  );
}
