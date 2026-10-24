import { z } from "zod";
import { semantic } from "./semantic";
import { SECTIONS, WEEKDAYS } from "./constants";

export { SECTIONS, WEEKDAYS };

export const Key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "key must be lowercase a-z, 0-9, _ or -");
export const Cents = z.number().int().nonnegative();
export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb");

export const Weekday = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof Weekday>;

export const Timezone = z.string().refine(
  (tz) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "invalid IANA timezone" },
);

export const Window = z.object({ start: HHMM, end: HHMM });
export type Window = z.infer<typeof Window>;
export const DayHours = z.array(Window).max(3);
export const WeekHours = z.record(Weekday, DayHours);
export type WeekHours = z.infer<typeof WeekHours>;

export const Business = z.object({
  name: z.string().min(1).max(60),
  tagline: z.string().max(140).default(""),
  timezone: Timezone,
  currency: z
    .string()
    .length(3)
    .transform((s) => s.toLowerCase()),
  branding: z.object({ primary: Hex, style: z.enum(["clean", "bold", "warm", "luxe"]) }),
});

export const Position = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

export const Resource = z.object({
  key: Key,
  kind: Key,
  label: z.string().min(1).max(60),
  position: Position.nullable().default(null),
  skills: z.array(Key).default([]),
});
export type Resource = z.infer<typeof Resource>;

export const Requirement = z.object({ kind: Key, count: z.number().int().min(1).max(20) });
export type Requirement = z.infer<typeof Requirement>;

const ServiceBase = {
  key: Key,
  name: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  durationMin: z.number().int().min(5).max(720),
  priceCents: Cents,
  bufferMin: z.number().int().min(0).max(120).default(0),
};

export const Service = z.discriminatedUnion("capacityType", [
  z.object({ capacityType: z.literal("one_to_one"), ...ServiceBase, requires: z.array(Requirement).length(1) }),
  z.object({ capacityType: z.literal("resource_rental"), ...ServiceBase, requires: z.array(Requirement).length(1) }),
  z.object({ capacityType: z.literal("combination"), ...ServiceBase, requires: z.array(Requirement).min(2) }),
  z.object({
    capacityType: z.literal("class_with_spots"),
    ...ServiceBase,
    requires: z.array(Requirement).max(1).default([]),
    capacity: z.number().int().min(1).max(500),
    spotKind: Key.nullable(),
  }),
]);
export type Service = z.infer<typeof Service>;
export type CapacityType = Service["capacityType"];

export const ResourceSchedule = z.object({
  resourceKey: Key,
  hours: WeekHours,
  breaks: z.record(Weekday, z.array(Window)).default({}),
});
export type ResourceSchedule = z.infer<typeof ResourceSchedule>;

export const ClassSession = z.object({
  key: Key,
  serviceKey: Key,
  weekday: Weekday,
  start: HHMM,
  instructorKey: Key.nullable(),
});
export type ClassSession = z.infer<typeof ClassSession>;

export const Schedules = z.object({
  business: WeekHours,
  resources: z.array(ResourceSchedule).default([]),
  classSessions: z.array(ClassSession).default([]),
});

export const Payment = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("full") }),
  z.object({ mode: z.literal("deposit"), depositPercent: z.number().int().min(1).max(99) }),
]);

export const Rules = z.object({
  cancellationDeadlineHours: z.number().int().min(0).max(720).default(24),
  noShowFeeCents: Cents.default(0),
  minNoticeMin: z.number().int().min(0).max(10080).default(60),
  maxAdvanceDays: z.number().int().min(1).max(365).default(30),
  payment: Payment,
});
export type Rules = z.infer<typeof Rules>;

export const Section = z.enum(SECTIONS);

export const Ui = z.object({
  resourcePicker: z.enum(["map", "list", "auto"]),
  sections: z.array(Section).min(1),
  floorPlanImage: z.string().url().nullable().default(null),
  about: z.string().max(1000).optional(),
  contact: z
    .object({
      phone: z.string().max(40).optional(),
      email: z.string().email().optional(),
      address: z.string().max(200).optional(),
    })
    .default({}),
});

export const TenantConfigShape = z
  .object({
    version: z.literal(1),
    business: Business,
    resources: z.array(Resource).min(1),
    services: z.array(Service).min(1),
    schedules: Schedules,
    rules: Rules,
    ui: Ui,
  })
  .strict();

export type TenantConfig = z.infer<typeof TenantConfigShape>;
export type TenantConfigInput = z.input<typeof TenantConfigShape>;

export const TenantConfig = TenantConfigShape.superRefine(semantic);

export type ConfigIssue = { path: string; message: string };

export function formatIssues(error: z.ZodError): ConfigIssue[] {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export type ValidationResult = { ok: true; config: TenantConfig } | { ok: false; errors: ConfigIssue[] };

export function validateConfig(input: unknown): ValidationResult {
  const r = TenantConfig.safeParse(input);
  return r.success ? { ok: true, config: r.data } : { ok: false, errors: formatIssues(r.error) };
}
