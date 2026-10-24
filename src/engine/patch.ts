import { applyPatch, type Operation } from "fast-json-patch";
import { z } from "zod";
import { validateConfig, type ConfigIssue, type TenantConfig } from "./schema";

const Op = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: z.string(), value: z.unknown() }),
  z.object({ op: z.literal("remove"), path: z.string() }),
  z.object({ op: z.literal("replace"), path: z.string(), value: z.unknown() }),
  z.object({ op: z.literal("move"), path: z.string(), from: z.string() }),
  z.object({ op: z.literal("copy"), path: z.string(), from: z.string() }),
  z.object({ op: z.literal("test"), path: z.string(), value: z.unknown() }),
]);
export const JsonPatch = z.array(Op).min(1).max(200);
export type JsonPatch = z.infer<typeof JsonPatch>;

export type PatchResult =
  | { ok: true; config: TenantConfig }
  | { ok: false; stage: "patch" | "validate"; errors: ConfigIssue[] };

/**
 * Apply an RFC 6902 patch to the current config (or `{}` when the tenant has none yet) and validate the result.
 * Never mutates `base`. Errors are path-addressed so the model can self-correct.
 */
export function applyConfigPatch(base: TenantConfig | null, patch: unknown): PatchResult {
  const ops = JsonPatch.safeParse(patch);
  if (!ops.success) {
    return { ok: false, stage: "patch", errors: ops.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const doc: unknown = base ? structuredClone(base) : {};
  let patched: unknown;
  try {
    patched = applyPatch(doc, ops.data as Operation[], true, false).newDocument;
  } catch (e) {
    const err = e as { name?: string; message?: string; operation?: Operation; index?: number };
    const idx = err.index ?? 0;
    return { ok: false, stage: "patch", errors: [{ path: String(idx), message: `${err.name ?? "PatchError"} at ${err.operation?.path ?? "?"}: ${err.message ?? "invalid operation"}` }] };
  }
  const v = validateConfig(patched);
  return v.ok ? { ok: true, config: v.config } : { ok: false, stage: "validate", errors: v.errors };
}
