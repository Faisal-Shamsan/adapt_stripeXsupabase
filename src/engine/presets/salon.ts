import type { TenantConfigInput } from "../schema";

const open = { start: "09:00", end: "18:00" };
const lunch = { start: "13:00", end: "13:30" };

export const salon: TenantConfigInput = {
  version: 1,
  business: {
    name: "Fringe & Co",
    tagline: "Cuts, colour, calm.",
    timezone: "Europe/London",
    currency: "gbp",
    branding: { primary: "#0f766e", style: "clean" },
  },
  resources: [
    { key: "amira", kind: "staff", label: "Amira", skills: ["cut", "colour"] },
    { key: "jules", kind: "staff", label: "Jules", skills: ["cut", "beard"] },
    { key: "sam", kind: "staff", label: "Sam", skills: ["beard"] },
  ],
  services: [
    { key: "cut", name: "Cut & finish", capacityType: "one_to_one", durationMin: 45, priceCents: 4200, bufferMin: 10, requires: [{ kind: "staff", count: 1 }] },
    { key: "colour", name: "Full colour", capacityType: "one_to_one", durationMin: 120, priceCents: 11000, bufferMin: 15, requires: [{ kind: "staff", count: 1 }] },
    { key: "beard", name: "Beard trim", capacityType: "one_to_one", durationMin: 20, priceCents: 1800, requires: [{ kind: "staff", count: 1 }] },
  ],
  schedules: {
    business: { tue: [open], wed: [open], thu: [{ start: "09:00", end: "20:00" }], fri: [open], sat: [{ start: "09:00", end: "16:00" }] },
    resources: [
      { resourceKey: "amira", hours: { tue: [open], wed: [open], thu: [open], fri: [open] }, breaks: { tue: [lunch], wed: [lunch], thu: [lunch], fri: [lunch] } },
      { resourceKey: "jules", hours: { thu: [{ start: "12:00", end: "20:00" }], fri: [open], sat: [{ start: "09:00", end: "16:00" }] } },
    ],
  },
  rules: { cancellationDeadlineHours: 24, noShowFeeCents: 1500, minNoticeMin: 120, maxAdvanceDays: 60, payment: { mode: "deposit", depositPercent: 25 } },
  ui: { resourcePicker: "list", sections: ["hero", "services", "hours", "about", "contact"], about: "Independent salon in Stokes Croft since 2014." },
};
