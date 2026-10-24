import Link from "next/link";
import type { TenantConfig } from "@/engine/schema";
import { Button, Display, Eyebrow } from "@/components/ui";

export function Hero({ config, slug }: { config: TenantConfig; slug: string }) {
  const kinds = new Set(config.services.map((s) => s.capacityType));
  const eyebrow = kinds.has("class_with_spots") ? "Classes & sessions" : kinds.has("resource_rental") ? "Court & space hire" : "Appointments";
  return (
    <section className="grid items-end gap-10 pt-10 md:grid-cols-[1.2fr_1fr] md:pt-20">
      <div>
        <Eyebrow className="rise">{eyebrow}</Eyebrow>
        <Display className="rise rise-1 mt-5 text-6xl md:text-7xl lg:text-[5.5rem]">{config.business.name}</Display>
        {config.business.tagline && <p className="rise rise-2 mt-6 max-w-lg text-lg leading-relaxed text-stone">{config.business.tagline}</p>}
        <div className="rise rise-3 mt-10 flex gap-3">
          <Link href={`/${slug}/book`}>
            <Button size="lg">Book now</Button>
          </Link>
          {config.ui.sections.includes("hours") && (
            <a href="#hours">
              <Button size="lg" variant="ghost">
                Opening hours
              </Button>
            </a>
          )}
        </div>
      </div>
      <div className="rise rise-2 glass relative aspect-[4/3] overflow-hidden rounded-3xl">
        {config.ui.floorPlanImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={config.ui.floorPlanImage} alt="" className="h-full w-full object-cover opacity-90" />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_30%_20%,color-mix(in_oklab,var(--accent)_28%,transparent),transparent_70%)]" />
        )}
        <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between">
          <span className="font-display text-3xl italic text-charcoal/80">{config.services.length} ways to book</span>
          <span className="glass-strong rounded-full px-3 py-1 text-xs text-charcoal-2">{config.business.timezone.split("/").pop()?.replace("_", " ")}</span>
        </div>
      </div>
    </section>
  );
}
