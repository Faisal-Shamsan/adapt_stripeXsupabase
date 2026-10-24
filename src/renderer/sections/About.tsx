import type { TenantConfig } from "@/engine/schema";
import { Display, Eyebrow } from "@/components/ui";

export function About({ config }: { config: TenantConfig }) {
  if (!config.ui.about) return null;
  return (
    <section id="about" className="mx-auto max-w-3xl text-center">
      <Eyebrow>About</Eyebrow>
      <Display as="h2" className="mt-3 text-4xl italic md:text-5xl">
        &ldquo;{config.ui.about}&rdquo;
      </Display>
    </section>
  );
}
