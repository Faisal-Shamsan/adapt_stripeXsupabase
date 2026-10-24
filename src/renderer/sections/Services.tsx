import Link from "next/link";
import type { TenantConfig } from "@/engine/schema";
import { Display, Eyebrow, Money } from "@/components/ui";

export function Services({ config, slug, currency }: { config: TenantConfig; slug: string; currency: string }) {
  const services = config.services.filter((s) => s.capacityType !== "class_with_spots");
  if (!services.length) return null;
  return (
    <section id="services">
      <Eyebrow>Services</Eyebrow>
      <Display as="h2" className="mt-3 text-4xl md:text-5xl">
        Choose what you need
      </Display>
      <ul className="mt-10 grid gap-4 md:grid-cols-2">
        {services.map((s, i) => (
          <li key={s.key} className={`rise rise-${Math.min(i, 4)}`}>
            <Link href={`/${slug}/book?service=${s.key}`} className="tactile glass group flex h-full flex-col justify-between rounded-3xl p-6 hover:bg-white/70 md:p-7">
              <div>
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-display text-3xl font-medium leading-tight">{s.name}</h3>
                  <span className="shrink-0 rounded-full bg-accent/10 px-3 py-1 text-sm font-medium text-charcoal">
                    <Money cents={s.priceCents} currency={currency} />
                  </span>
                </div>
                {s.description && <p className="mt-3 text-[15px] leading-relaxed text-stone">{s.description}</p>}
              </div>
              <div className="mt-6 flex items-center justify-between text-sm text-stone">
                <span>{s.durationMin} min</span>
                <span className="text-charcoal-2 transition-transform duration-300 group-hover:translate-x-1">Book →</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
