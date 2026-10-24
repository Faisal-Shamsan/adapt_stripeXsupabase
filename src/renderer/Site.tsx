import Link from "next/link";
import type { TenantConfig } from "@/engine/schema";
import type { PublicResource } from "@/lib/tenant";
import { accentStyle } from "./theme";
import { Hero } from "./sections/Hero";
import { Services } from "./sections/Services";
import { Classes, type SessionView } from "./sections/Classes";
import { FloorPlan } from "./sections/FloorPlan";
import { Hours } from "./sections/Hours";
import { About } from "./sections/About";
import { Contact } from "./sections/Contact";

export type SiteProps = {
  slug: string;
  config: TenantConfig;
  currency: string;
  timezone: string;
  resources: PublicResource[];
  sessions: SessionView[];
  canPay: boolean;
};

/** The one generic renderer: composes sections in the order the config asks for. No per-tenant code. */
export function Site(p: SiteProps) {
  const { config } = p;
  const sections = config.ui.sections.map((s, i) => {
    const key = `${s}-${i}`;
    switch (s) {
      case "hero":
        return <Hero key={key} config={config} slug={p.slug} />;
      case "services":
        return <Services key={key} config={config} slug={p.slug} currency={p.currency} />;
      case "classes":
        return <Classes key={key} config={config} slug={p.slug} currency={p.currency} timezone={p.timezone} sessions={p.sessions} />;
      case "floorPlan":
        return <FloorPlan key={key} config={config} resources={p.resources} />;
      case "hours":
        return <Hours key={key} config={config} />;
      case "about":
        return <About key={key} config={config} />;
      case "contact":
        return <Contact key={key} config={config} />;
    }
  });

  return (
    <div style={accentStyle(config)} className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 md:px-10">
        <Link href={`/${p.slug}`} className="font-display text-2xl font-semibold tracking-tight">
          {config.business.name}
        </Link>
        <Link href={`/${p.slug}/book`} className="tactile rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink shadow-soft hover:shadow-lift">
          Book now
        </Link>
      </header>
      <main className="mx-auto max-w-6xl space-y-24 px-6 pb-32 md:px-10">
        {!p.canPay && (
          <p className="glass rounded-2xl px-5 py-3 text-sm text-stone">Online payments are being set up. Bookings will open shortly.</p>
        )}
        {sections}
      </main>
      <footer className="mx-auto max-w-6xl px-6 pb-12 text-xs text-stone-2 md:px-10">
        {config.business.name} · Bookings powered by Adapt
      </footer>
    </div>
  );
}
