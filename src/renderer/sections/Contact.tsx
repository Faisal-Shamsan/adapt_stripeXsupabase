import type { TenantConfig } from "@/engine/schema";
import { Display, Eyebrow } from "@/components/ui";

export function Contact({ config }: { config: TenantConfig }) {
  const c = config.ui.contact;
  const rows = [
    c.address && ["Find us", c.address],
    c.phone && ["Call", c.phone],
    c.email && ["Email", c.email],
  ].filter(Boolean) as [string, string][];
  return (
    <section id="contact" className="glass rounded-3xl p-8 md:p-12">
      <Eyebrow>Contact</Eyebrow>
      <Display as="h2" className="mt-3 text-4xl md:text-5xl">
        Say hello
      </Display>
      {rows.length ? (
        <dl className="mt-8 grid gap-6 sm:grid-cols-3">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs uppercase tracking-[0.14em] text-stone">{k}</dt>
              <dd className="mt-1.5 text-lg text-charcoal">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-6 text-stone">Book online any time.</p>
      )}
    </section>
  );
}
