import type { TenantConfig } from "@/engine/schema";
import { Display, Eyebrow } from "@/components/ui";
import { WEEKDAY_LABEL, WEEKDAY_ORDER } from "../theme";

export function Hours({ config }: { config: TenantConfig }) {
  const hours = config.schedules.business;
  return (
    <section id="hours" className="grid gap-10 md:grid-cols-[1fr_1.4fr]">
      <div>
        <Eyebrow>Hours</Eyebrow>
        <Display as="h2" className="mt-3 text-4xl md:text-5xl">
          When we&apos;re open
        </Display>
      </div>
      <dl className="glass divide-y divide-charcoal/8 rounded-3xl px-7 py-3">
        {WEEKDAY_ORDER.map((d) => {
          const w = hours[d];
          return (
            <div key={d} className="flex items-baseline justify-between py-3.5">
              <dt className="text-[15px] text-charcoal-2">{WEEKDAY_LABEL[d]}</dt>
              <dd className="font-display text-xl tabular-nums">{w && w.length ? w.map((x) => `${x.start} – ${x.end}`).join(", ") : <span className="text-stone-2">Closed</span>}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
