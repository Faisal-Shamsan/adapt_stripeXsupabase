import { z } from "zod";
import type { TenantConfig, Weekday, WeekHours, Window } from "./schema";
import { WEEKDAYS } from "./constants";

type Ctx = z.RefinementCtx;

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const issue = (ctx: Ctx, path: (string | number)[], message: string) =>
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

function checkUnique<T>(ctx: Ctx, items: T[], pick: (t: T) => string, basePath: string[], field: string) {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const k = pick(item);
    if (seen.has(k)) issue(ctx, [...basePath, i, field], `duplicate ${field} "${k}"`);
    seen.add(k);
  });
}

function checkWindows(ctx: Ctx, windows: Window[], path: (string | number)[]) {
  const sorted = windows
    .map((w, i) => ({ ...w, i, s: toMin(w.start), e: toMin(w.end) }))
    .sort((a, b) => a.s - b.s);
  for (const w of sorted) {
    if (w.s >= w.e) issue(ctx, [...path, w.i], `window ${w.start}-${w.end} must have start < end (no overnight windows)`);
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.s < prev.e) issue(ctx, [...path, cur.i], `window ${cur.start}-${cur.end} overlaps ${prev.start}-${prev.end}`);
  }
}

function checkWeekHours(ctx: Ctx, hours: WeekHours, path: (string | number)[]) {
  for (const day of WEEKDAYS) {
    const w = hours[day];
    if (w) checkWindows(ctx, w, [...path, day]);
  }
}

/** Every window of `inner` must lie fully inside some window of `outer`. */
function checkContained(ctx: Ctx, inner: Window[], outer: Window[], path: (string | number)[], what: string) {
  inner.forEach((w, i) => {
    const s = toMin(w.start);
    const e = toMin(w.end);
    const ok = outer.some((o) => toMin(o.start) <= s && e <= toMin(o.end));
    if (!ok) issue(ctx, [...path, i], `${what} ${w.start}-${w.end} falls outside ${outer.map((o) => `${o.start}-${o.end}`).join(", ") || "closed hours"}`);
  });
}

export function semantic(cfg: TenantConfig, ctx: Ctx): void {
  const { resources, services, schedules, ui } = cfg;

  // 1. Unique keys
  checkUnique(ctx, resources, (r) => r.key, ["resources"], "key");
  checkUnique(ctx, services, (s) => s.key, ["services"], "key");
  checkUnique(ctx, schedules.classSessions, (s) => s.key, ["schedules", "classSessions"], "key");
  checkUnique(ctx, schedules.resources, (s) => s.resourceKey, ["schedules", "resources"], "resourceKey");

  const resourceByKey = new Map(resources.map((r) => [r.key, r]));
  const serviceByKey = new Map(services.map((s) => [s.key, s]));
  const byKind = (kind: string) => resources.filter((r) => r.kind === kind);

  // 7. Skills resolve; only staff have skills
  resources.forEach((r, i) => {
    if (r.kind !== "staff" && r.skills.length > 0) issue(ctx, ["resources", i, "skills"], `only kind "staff" may declare skills`);
    r.skills.forEach((sk, j) => {
      if (!serviceByKey.has(sk)) issue(ctx, ["resources", i, "skills", j], `unknown service "${sk}"`);
    });
  });

  // 2. Every requirement is satisfiable
  services.forEach((svc, i) => {
    svc.requires.forEach((req, j) => {
      const pool = byKind(req.kind);
      const eligible = req.kind === "staff" ? pool.filter((r) => r.skills.includes(svc.key)) : pool;
      if (eligible.length < req.count) {
        const why = req.kind === "staff" ? `staff with skill "${svc.key}"` : `resources of kind "${req.kind}"`;
        issue(ctx, ["services", i, "requires", j], `service "${svc.key}" needs ${req.count} ${why}, found ${eligible.length}`);
      }
    });
    if (svc.capacityType === "class_with_spots" && svc.spotKind !== null) {
      const spots = byKind(svc.spotKind);
      if (spots.length < svc.capacity)
        issue(ctx, ["services", i, "capacity"], `capacity ${svc.capacity} exceeds ${spots.length} resources of spotKind "${svc.spotKind}"`);
    }
  });

  // 3. Class sessions reference class services and skilled instructors
  schedules.classSessions.forEach((cs, i) => {
    const path = ["schedules", "classSessions", i];
    const svc = serviceByKey.get(cs.serviceKey);
    if (!svc) {
      issue(ctx, [...path, "serviceKey"], `unknown service "${cs.serviceKey}"`);
      return;
    }
    if (svc.capacityType !== "class_with_spots")
      issue(ctx, [...path, "serviceKey"], `service "${cs.serviceKey}" is ${svc.capacityType}, class sessions need class_with_spots`);
    if (cs.instructorKey !== null) {
      const inst = resourceByKey.get(cs.instructorKey);
      if (!inst) issue(ctx, [...path, "instructorKey"], `unknown resource "${cs.instructorKey}"`);
      else if (inst.kind !== "staff") issue(ctx, [...path, "instructorKey"], `"${cs.instructorKey}" is not staff`);
      else if (!inst.skills.includes(cs.serviceKey))
        issue(ctx, [...path, "instructorKey"], `"${cs.instructorKey}" lacks skill "${cs.serviceKey}"`);
    } else if (svc.requires.some((r) => r.kind === "staff")) {
      issue(ctx, [...path, "instructorKey"], `service "${cs.serviceKey}" requires staff; instructorKey is required`);
    }
    // 5. Session fits inside business hours that day
    const day = schedules.business[cs.weekday] ?? [];
    const s = toMin(cs.start);
    const e = s + svc.durationMin;
    if (!day.some((w) => toMin(w.start) <= s && e <= toMin(w.end)))
      issue(ctx, [...path, "start"], `session ${cs.start} (+${svc.durationMin}min) is outside business hours on ${cs.weekday}`);
  });

  // 4. Map picker constraints
  if (ui.resourcePicker === "map") {
    if (!ui.floorPlanImage) issue(ctx, ["ui", "floorPlanImage"], `floorPlanImage is required when resourcePicker is "map"`);
    const pickableKinds = new Set<string>();
    for (const svc of services) {
      if (svc.capacityType === "class_with_spots") {
        if (svc.spotKind) pickableKinds.add(svc.spotKind);
      } else {
        for (const r of svc.requires) pickableKinds.add(r.kind);
      }
    }
    const seen = new Map<string, string>();
    resources.forEach((r, i) => {
      if (!pickableKinds.has(r.kind)) return;
      if (!r.position) {
        issue(ctx, ["resources", i, "position"], `position required for "${r.key}" when resourcePicker is "map"`);
        return;
      }
      const k = `${r.position.x.toFixed(4)},${r.position.y.toFixed(4)}`;
      const other = seen.get(k);
      if (other) issue(ctx, ["resources", i, "position"], `"${r.key}" shares a position with "${other}"`);
      seen.set(k, r.key);
    });
  }

  // 5. Hours: ordered, non-overlapping, contained
  checkWeekHours(ctx, schedules.business, ["schedules", "business"]);
  schedules.resources.forEach((rs, i) => {
    const path = ["schedules", "resources", i];
    if (!resourceByKey.has(rs.resourceKey)) issue(ctx, [...path, "resourceKey"], `unknown resource "${rs.resourceKey}"`);
    checkWeekHours(ctx, rs.hours, [...path, "hours"]);
    for (const day of WEEKDAYS as readonly Weekday[]) {
      const hrs = rs.hours[day];
      if (hrs) checkContained(ctx, hrs, schedules.business[day] ?? [], [...path, "hours", day], "working hours");
      const brk = rs.breaks[day];
      if (brk) {
        checkWindows(ctx, brk, [...path, "breaks", day]);
        checkContained(ctx, brk, hrs ?? schedules.business[day] ?? [], [...path, "breaks", day], "break");
      }
    }
  });

  // 6. Sections consistent with modules
  const hasClasses = services.some((s) => s.capacityType === "class_with_spots");
  const hasNonClass = services.some((s) => s.capacityType !== "class_with_spots");
  ui.sections.forEach((sec, i) => {
    if (sec === "classes" && !hasClasses) issue(ctx, ["ui", "sections", i], `"classes" section requires a class_with_spots service`);
    if (sec === "services" && !hasNonClass) issue(ctx, ["ui", "sections", i], `"services" section requires a non-class service`);
    if (sec === "floorPlan" && ui.resourcePicker !== "map") issue(ctx, ["ui", "sections", i], `"floorPlan" section requires resourcePicker "map"`);
  });
}
