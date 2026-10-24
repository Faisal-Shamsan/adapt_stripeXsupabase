import { describe, expect, it } from "vitest";
import { applyConfigPatch } from "@/engine/patch";
import { TenantConfig } from "@/engine/schema";
import { presets } from "@/engine/presets";

const padel = TenantConfig.parse(presets.padel);

describe("applyConfigPatch", () => {
  it("applies a valid patch and returns a validated config without mutating the base", () => {
    const r = applyConfigPatch(padel, [
      { op: "add", path: "/resources/-", value: { key: "court-5", kind: "court", label: "Court 5" } },
      { op: "replace", path: "/services/0/priceCents", value: 3500 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.resources).toHaveLength(5);
    expect(r.config.services[0]!.priceCents).toBe(3500);
    expect(r.config.resources[4]!.position).toBeNull(); // defaults applied
    expect(padel.resources).toHaveLength(4);
  });

  it("bootstraps from null with a root replace", () => {
    const r = applyConfigPatch(null, [{ op: "replace", path: "", value: presets.salon }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.business.name).toBe("Fringe & Co");
  });

  it("reports semantic failures with paths", () => {
    const r = applyConfigPatch(padel, [{ op: "replace", path: "/services/0/requires/0/count", value: 9 }]);
    expect(r).toMatchObject({ ok: false, stage: "validate" });
    if (r.ok) return;
    expect(r.errors[0]).toMatchObject({ path: "services.0.requires.0", message: expect.stringMatching(/needs 9/) });
  });

  it("reports structural patch failures (bad path, bad test)", () => {
    const bad = applyConfigPatch(padel, [{ op: "replace", path: "/services/9/priceCents", value: 1 }]);
    expect(bad).toMatchObject({ ok: false, stage: "patch" });
    const test = applyConfigPatch(padel, [{ op: "test", path: "/business/name", value: "Wrong" }]);
    expect(test).toMatchObject({ ok: false, stage: "patch" });
  });

  it("rejects malformed operations before touching the document", () => {
    const r = applyConfigPatch(padel, [{ op: "explode", path: "/" }]);
    expect(r).toMatchObject({ ok: false, stage: "patch" });
    expect(applyConfigPatch(padel, [])).toMatchObject({ ok: false, stage: "patch" });
    expect(applyConfigPatch(padel, "nope")).toMatchObject({ ok: false, stage: "patch" });
  });

  it("strict schema catches unknown keys introduced by a patch", () => {
    const r = applyConfigPatch(padel, [{ op: "add", path: "/catalog", value: {} }]);
    expect(r).toMatchObject({ ok: false, stage: "validate" });
  });
});
