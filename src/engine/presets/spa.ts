import type { TenantConfigInput } from "../schema";

const open = { start: "10:00", end: "20:00" };

export const spa: TenantConfigInput = {
  version: 1,
  business: {
    name: "Stillwater Spa",
    tagline: "Slow down.",
    timezone: "Europe/London",
    currency: "gbp",
    branding: { primary: "#7c3aed", style: "luxe" },
  },
  resources: [
    { key: "lena", kind: "staff", label: "Lena", skills: ["swedish-60", "deep-90"] },
    { key: "kai", kind: "staff", label: "Kai", skills: ["swedish-60"] },
    { key: "room-1", kind: "room", label: "Lotus room" },
    { key: "room-2", kind: "room", label: "Cedar room" },
  ],
  services: [
    {
      key: "swedish-60",
      name: "Swedish massage",
      capacityType: "combination",
      durationMin: 60,
      priceCents: 7500,
      bufferMin: 15,
      requires: [{ kind: "staff", count: 1 }, { kind: "room", count: 1 }],
    },
    {
      key: "deep-90",
      name: "Deep tissue 90",
      capacityType: "combination",
      durationMin: 90,
      priceCents: 11000,
      bufferMin: 15,
      requires: [{ kind: "staff", count: 1 }, { kind: "room", count: 1 }],
    },
  ],
  schedules: {
    business: { mon: [open], tue: [open], wed: [open], thu: [open], fri: [open], sat: [open], sun: [{ start: "10:00", end: "16:00" }] },
    resources: [{ resourceKey: "kai", hours: { fri: [open], sat: [open], sun: [{ start: "10:00", end: "16:00" }] } }],
  },
  rules: { cancellationDeadlineHours: 48, minNoticeMin: 180, maxAdvanceDays: 90, payment: { mode: "deposit", depositPercent: 50 } },
  ui: { resourcePicker: "auto", sections: ["hero", "services", "about", "hours", "contact"] },
};
