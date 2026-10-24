import type { TenantConfig } from "@/engine/schema";
import type { PublicResource } from "@/lib/tenant";
import { Display, Eyebrow } from "@/components/ui";
import { FloorPlanMap } from "@/components/booking/FloorPlanMap";

export function FloorPlan({ config, resources }: { config: TenantConfig; resources: PublicResource[] }) {
  if (!config.ui.floorPlanImage) return null;
  const pickable = new Set<string>();
  for (const s of config.services) {
    if (s.capacityType === "class_with_spots") {
      if (s.spotKind) pickable.add(s.spotKind);
    } else for (const r of s.requires) pickable.add(r.kind);
  }
  const spots = resources.filter((r) => pickable.has(r.kind) && r.position);
  return (
    <section id="floor-plan">
      <Eyebrow>The space</Eyebrow>
      <Display as="h2" className="mt-3 text-4xl md:text-5xl">
        Pick your exact spot
      </Display>
      <div className="mt-10">
        <FloorPlanMap image={config.ui.floorPlanImage} spots={spots.map((s) => ({ id: s.id, label: s.label, position: s.position!, state: "free" }))} readOnly />
      </div>
    </section>
  );
}
