import type { TenantConfigInput } from "../schema";

const open = { start: "07:00", end: "22:00" };

export const padel: TenantConfigInput = {
  version: 1,
  business: {
    name: "Harbourside Padel",
    tagline: "Four courts. Zero excuses.",
    timezone: "Europe/London",
    currency: "gbp",
    branding: { primary: "#2563eb", style: "clean" },
  },
  resources: [
    { key: "court-1", kind: "court", label: "Court 1 (indoor)" },
    { key: "court-2", kind: "court", label: "Court 2 (indoor)" },
    { key: "court-3", kind: "court", label: "Court 3" },
    { key: "court-4", kind: "court", label: "Court 4" },
  ],
  services: [
    { key: "court-60", name: "Court hire 60", capacityType: "resource_rental", durationMin: 60, priceCents: 3200, requires: [{ kind: "court", count: 1 }] },
    { key: "court-90", name: "Court hire 90", capacityType: "resource_rental", durationMin: 90, priceCents: 4500, requires: [{ kind: "court", count: 1 }] },
  ],
  schedules: { business: { mon: [open], tue: [open], wed: [open], thu: [open], fri: [open], sat: [open], sun: [open] } },
  rules: { cancellationDeadlineHours: 24, minNoticeMin: 60, maxAdvanceDays: 21, payment: { mode: "full" } },
  ui: { resourcePicker: "list", sections: ["hero", "services", "hours", "contact"] },
};
