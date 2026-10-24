import { describe, expect, it } from "vitest";
import { TenantConfig, validateConfig, type TenantConfigInput } from "@/engine/schema";
import { presets } from "@/engine/presets";

type Mutator = (c: TenantConfigInput) => void;

const clone = <T>(v: T): T => structuredClone(v);

/** Deep-clone a preset, mutate it, validate, and return the issue paths/messages. */
function invalid(base: TenantConfigInput, mutate: Mutator) {
  const c = clone(base);
  mutate(c);
  const r = validateConfig(c);
  expect(r.ok, "expected validation to fail").toBe(false);
  return r.ok ? [] : r.errors;
}

const expectIssue = (errors: { path: string; message: string }[], path: string | RegExp, message?: RegExp) => {
  const hit = errors.find((e) => (typeof path === "string" ? e.path === path : path.test(e.path)));
  expect(hit, `no issue at ${path}; got ${JSON.stringify(errors)}`).toBeDefined();
  if (message) expect(hit!.message).toMatch(message);
};

describe("valid presets", () => {
  for (const [name, cfg] of Object.entries(presets)) {
    it(`${name} parses`, () => {
      const r = validateConfig(cfg);
      expect(r.ok, JSON.stringify(!r.ok && r.errors)).toBe(true);
    });
  }

  it("applies defaults and normalises currency", () => {
    const c = clone(presets.padel);
    c.business.currency = "GBP";
    const r = TenantConfig.parse(c);
    expect(r.business.currency).toBe("gbp");
    expect(r.services[0]?.bufferMin).toBe(0);
    expect(r.schedules.resources).toEqual([]);
    expect(r.rules.cancellationDeadlineHours).toBe(24);
    expect(r.resources[0]?.position).toBeNull();
  });

  it("rejects unknown top-level keys (strict)", () => {
    const errors = invalid(presets.padel, (c) => ((c as Record<string, unknown>)["catalog"] = {}));
    expectIssue(errors, "", /unrecognized/i);
  });
});

describe("structural", () => {
  it("rejects a bad key", () => {
    const errors = invalid(presets.padel, (c) => (c.resources[0]!.key = "Court One"));
    expectIssue(errors, "resources.0.key");
  });

  it("rejects an invalid timezone", () => {
    const errors = invalid(presets.salon, (c) => (c.business.timezone = "Europe/Bristol"));
    expectIssue(errors, "business.timezone", /timezone/);
  });

  it("rejects malformed HH:MM", () => {
    const errors = invalid(presets.padel, (c) => (c.schedules.business.mon = [{ start: "7:00", end: "22:00" }]));
    expectIssue(errors, "schedules.business.mon.0.start");
  });

  it("rejects deposit mode without percent", () => {
    const errors = invalid(presets.salon, (c) => (c.rules.payment = { mode: "deposit" } as never));
    expectIssue(errors, /^rules\.payment/);
  });

  it("rejects an unknown section", () => {
    const errors = invalid(presets.padel, (c) => c.ui.sections.push("shop" as never));
    expectIssue(errors, /^ui\.sections\.\d+$/);
  });

  it("one_to_one must have exactly one requirement", () => {
    const errors = invalid(presets.salon, (c) => (c.services[0]!.requires = [{ kind: "staff", count: 1 }, { kind: "room", count: 1 }]));
    expectIssue(errors, "services.0.requires");
  });

  it("combination must have at least two requirements", () => {
    const errors = invalid(presets.spa, (c) => (c.services[0]!.requires = [{ kind: "staff", count: 1 }]));
    expectIssue(errors, "services.0.requires");
  });
});

describe("semantic: keys and references", () => {
  it("duplicate resource key", () => {
    const errors = invalid(presets.padel, (c) => (c.resources[1]!.key = "court-1"));
    expectIssue(errors, "resources.1.key", /duplicate/);
  });

  it("duplicate service key", () => {
    const errors = invalid(presets.padel, (c) => (c.services[1]!.key = "court-60"));
    expectIssue(errors, "services.1.key", /duplicate/);
  });

  it("duplicate class session key", () => {
    const errors = invalid(presets.gym, (c) => (c.schedules.classSessions![1]!.key = "mon-0700"));
    expectIssue(errors, "schedules.classSessions.1.key", /duplicate/);
  });

  it("duplicate resource schedule", () => {
    const errors = invalid(presets.salon, (c) => (c.schedules.resources![1]!.resourceKey = "amira"));
    expectIssue(errors, "schedules.resources.1.resourceKey", /duplicate/);
  });

  it("skill referencing unknown service", () => {
    const errors = invalid(presets.salon, (c) => c.resources[0]!.skills!.push("perm"));
    expectIssue(errors, "resources.0.skills.2", /unknown service/);
  });

  it("non-staff resource with skills", () => {
    const errors = invalid(presets.spa, (c) => (c.resources[2]!.skills = ["swedish-60"]));
    expectIssue(errors, "resources.2.skills", /only kind "staff"/);
  });

  it("resource schedule for unknown resource", () => {
    const errors = invalid(presets.salon, (c) => (c.schedules.resources![0]!.resourceKey = "ghost"));
    expectIssue(errors, "schedules.resources.0.resourceKey", /unknown resource/);
  });
});

describe("semantic: requirements", () => {
  it("staff without the required skill do not count", () => {
    // Only Sam can do beard; remove beard from Jules and Sam -> nobody can
    const errors = invalid(presets.salon, (c) => {
      c.resources[1]!.skills = ["cut"];
      c.resources[2]!.skills = [];
    });
    expectIssue(errors, "services.2.requires.0", /needs 1 staff with skill "beard", found 0/);
  });

  it("too few resources of a required kind", () => {
    const errors = invalid(presets.spa, (c) => (c.services[0]!.requires = [{ kind: "staff", count: 1 }, { kind: "room", count: 3 }]));
    expectIssue(errors, "services.0.requires.1", /needs 3 resources of kind "room", found 2/);
  });

  it("unknown kind in requires", () => {
    const errors = invalid(presets.padel, (c) => (c.services[0]!.requires = [{ kind: "pitch", count: 1 }]));
    expectIssue(errors, "services.0.requires.0", /found 0/);
  });

  it("class capacity exceeds physical spots", () => {
    const errors = invalid(presets.gym, (c) => ((c.services[0] as { capacity: number }).capacity = 13));
    expectIssue(errors, "services.0.capacity", /exceeds 12/);
  });

  it("anonymous class capacity is not bound to resources", () => {
    const c = clone(presets.gym);
    (c.services[0] as { capacity: number; spotKind: string | null }).capacity = 40;
    (c.services[0] as { capacity: number; spotKind: string | null }).spotKind = null;
    c.ui.resourcePicker = "list";
    c.ui.sections = ["hero", "classes", "hours"];
    c.ui.floorPlanImage = null;
    expect(validateConfig(c).ok).toBe(true);
  });
});

describe("semantic: class sessions", () => {
  it("session referencing a one_to_one service", () => {
    const errors = invalid(presets.salon, (c) => {
      c.schedules.classSessions = [{ key: "x", serviceKey: "cut", weekday: "tue", start: "10:00", instructorKey: "amira" }];
    });
    expectIssue(errors, "schedules.classSessions.0.serviceKey", /class_with_spots/);
  });

  it("instructor lacking the skill", () => {
    // theo only has spin-45; assign him to a spin-60 session
    const errors = invalid(presets.gym, (c) => (c.schedules.classSessions![1]!.instructorKey = "theo"));
    expectIssue(errors, "schedules.classSessions.1.instructorKey", /lacks skill/);
  });

  it("instructor that is not staff", () => {
    const errors = invalid(presets.gym, (c) => (c.schedules.classSessions![0]!.instructorKey = "bike-1"));
    expectIssue(errors, "schedules.classSessions.0.instructorKey", /not staff/);
  });

  it("missing instructor when service requires staff", () => {
    const errors = invalid(presets.gym, (c) => (c.schedules.classSessions![0]!.instructorKey = null));
    expectIssue(errors, "schedules.classSessions.0.instructorKey", /required/);
  });

  it("session outside business hours", () => {
    const errors = invalid(presets.gym, (c) => (c.schedules.classSessions![3]!.start = "13:30")); // sat closes 14:00, 45min class
    expectIssue(errors, "schedules.classSessions.3.start", /outside business hours/);
  });
});

describe("semantic: hours", () => {
  it("overnight window", () => {
    const errors = invalid(presets.padel, (c) => (c.schedules.business.fri = [{ start: "20:00", end: "02:00" }]));
    expectIssue(errors, "schedules.business.fri.0", /start < end/);
  });

  it("overlapping windows in one day", () => {
    const errors = invalid(presets.padel, (c) => (c.schedules.business.mon = [{ start: "07:00", end: "12:00" }, { start: "11:00", end: "22:00" }]));
    expectIssue(errors, "schedules.business.mon.1", /overlaps/);
  });

  it("resource hours outside business hours", () => {
    const errors = invalid(presets.salon, (c) => (c.schedules.resources![0]!.hours.tue = [{ start: "08:00", end: "18:00" }]));
    expectIssue(errors, "schedules.resources.0.hours.tue.0", /outside/);
  });

  it("resource working on a closed day", () => {
    const errors = invalid(presets.salon, (c) => (c.schedules.resources![0]!.hours.mon = [{ start: "09:00", end: "12:00" }]));
    expectIssue(errors, "schedules.resources.0.hours.mon.0", /closed hours/);
  });

  it("break outside working hours", () => {
    const errors = invalid(presets.salon, (c) => (c.schedules.resources![0]!.breaks!.tue = [{ start: "18:00", end: "18:30" }]));
    expectIssue(errors, "schedules.resources.0.breaks.tue.0", /break .* outside/);
  });
});

describe("semantic: floor plan", () => {
  it("map picker without image", () => {
    const errors = invalid(presets.gym, (c) => (c.ui.floorPlanImage = null));
    expectIssue(errors, "ui.floorPlanImage");
  });

  it("map picker with a spot missing a position", () => {
    const errors = invalid(presets.gym, (c) => (c.resources[2]!.position = null));
    expectIssue(errors, "resources.2.position", /position required/);
  });

  it("map picker with duplicate positions", () => {
    const errors = invalid(presets.gym, (c) => (c.resources[3]!.position = { ...c.resources[2]!.position! }));
    expectIssue(errors, "resources.3.position", /shares a position/);
  });

  it("staff do not need positions on a map", () => {
    const c = clone(presets.gym);
    expect(c.resources[0]!.position).toBeUndefined();
    expect(validateConfig(c).ok).toBe(true);
  });

  it("list picker ignores positions", () => {
    const c = clone(presets.gym);
    c.ui.resourcePicker = "list";
    c.ui.sections = ["hero", "classes", "hours"];
    c.resources[2]!.position = null;
    expect(validateConfig(c).ok).toBe(true);
  });
});

describe("semantic: sections", () => {
  it("classes section without class services", () => {
    const errors = invalid(presets.padel, (c) => c.ui.sections.push("classes"));
    expectIssue(errors, "ui.sections.4", /class_with_spots/);
  });

  it("services section without non-class services", () => {
    const errors = invalid(presets.gym, (c) => c.ui.sections.push("services"));
    expectIssue(errors, "ui.sections.5", /non-class/);
  });

  it("floorPlan section without map picker", () => {
    const errors = invalid(presets.padel, (c) => c.ui.sections.push("floorPlan"));
    expectIssue(errors, "ui.sections.4", /"map"/);
  });
});
