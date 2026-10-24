import type { TenantConfigInput } from "../schema";

const bikes = Array.from({ length: 12 }, (_, i) => ({
  key: `bike-${i + 1}`,
  kind: "bike",
  label: `Bike ${i + 1}`,
  position: { x: 0.15 + (i % 4) * 0.23, y: 0.3 + Math.floor(i / 4) * 0.25 },
}));

const weekdays = { start: "06:30", end: "21:00" };
const weekend = { start: "08:00", end: "14:00" };

export const gym: TenantConfigInput = {
  version: 1,
  business: {
    name: "Pulse Spin Studio",
    tagline: "45 minutes. Full send.",
    timezone: "Europe/London",
    currency: "gbp",
    branding: { primary: "#e11d48", style: "bold" },
  },
  resources: [
    { key: "maya", kind: "staff", label: "Maya", skills: ["spin-45", "spin-60"] },
    { key: "theo", kind: "staff", label: "Theo", skills: ["spin-45"] },
    ...bikes,
  ],
  services: [
    {
      key: "spin-45",
      name: "Spin 45",
      capacityType: "class_with_spots",
      durationMin: 45,
      priceCents: 1400,
      requires: [{ kind: "staff", count: 1 }],
      capacity: 12,
      spotKind: "bike",
    },
    {
      key: "spin-60",
      name: "Endurance 60",
      capacityType: "class_with_spots",
      durationMin: 60,
      priceCents: 1800,
      requires: [{ kind: "staff", count: 1 }],
      capacity: 10,
      spotKind: "bike",
    },
  ],
  schedules: {
    business: { mon: [weekdays], tue: [weekdays], wed: [weekdays], thu: [weekdays], fri: [weekdays], sat: [weekend], sun: [weekend] },
    classSessions: [
      { key: "mon-0700", serviceKey: "spin-45", weekday: "mon", start: "07:00", instructorKey: "maya" },
      { key: "mon-1830", serviceKey: "spin-60", weekday: "mon", start: "18:30", instructorKey: "maya" },
      { key: "wed-0700", serviceKey: "spin-45", weekday: "wed", start: "07:00", instructorKey: "theo" },
      { key: "sat-0900", serviceKey: "spin-45", weekday: "sat", start: "09:00", instructorKey: "theo" },
    ],
  },
  rules: { cancellationDeadlineHours: 12, minNoticeMin: 30, maxAdvanceDays: 14, payment: { mode: "full" } },
  ui: {
    resourcePicker: "map",
    sections: ["hero", "classes", "floorPlan", "hours", "contact"],
    floorPlanImage: "https://placehold.co/1200x800/png?text=Studio+floor+plan",
    contact: { address: "12 Market St, Bristol" },
  },
};
