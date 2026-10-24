---
name: adapt-engine
description: Config contract, semantic rules and apply_config projection for the Adapt booking engine
triggers: [user, model]
---

# Adapt engine

## Config contract (`src/engine/schema.ts`)
`TenantConfig = { version: 1, business, resources[], services[], schedules, rules, ui }`.

- `resources[]`: `{ key, kind, label, position|null, skills[] }`. `kind` is free-form (`staff|room|court|bike|...`).
  `skills` = service keys; only allowed on `kind === "staff"`.
- `services[]` discriminated on `capacityType`:
  - `one_to_one` / `resource_rental`: exactly one `requires` entry.
  - `combination`: `requires.length >= 2` (spa = staff:1 + room:1).
  - `class_with_spots`: `capacity`, `spotKind|null`, optional single `requires` (instructor). `spotKind` set ⇒ customer
    picks a physical resource of that kind; null ⇒ anonymous counter on `class_sessions`.
- `bufferMin` is folded into the allocation range `[start, end + buffer)` so the gist constraint enforces it.
- `schedules.business` = opening hours; `schedules.resources[]` override per resource (absent ⇒ inherit);
  `schedules.classSessions[]` are weekly recurrences materialised by `apply_config` / cron.
- All time windows are `HH:MM` local to `business.timezone`; `start < end`; never overnight.

## Semantic checks (superRefine) — keep error `path` precise, the AI reads them to self-correct
1. unique keys (resources, services, classSessions, schedules.resources.resourceKey)
2. every `requires[].kind` satisfiable: count resources of that kind (staff must have the service in `skills`)
3. classSessions → class service; instructor is skilled staff; `spotKind` has ≥ capacity resources
4. picker `map` ⇒ `floorPlanImage`, positions present & unique on pickable kinds
5. windows ordered, non-overlapping; resource hours ⊆ business hours; breaks ⊆ resource hours; session fits in the day
6. sections consistent with modules present
7. skills resolve; only staff have skills

## Patch pipeline (`src/engine/patch.ts`)
RFC 6902 ops (fast-json-patch, `validate=true`) → `TenantConfig.safeParse` → on failure return
`{ ok: false, errors: [{ path, message }] }`. The AI turn retries exactly once with errors fed back.

## apply_config (Postgres)
`apply_config(p_tenant uuid, p_owner uuid, p_config jsonb, p_source text, p_prompt text)` SECURITY DEFINER:
1. assert `p_owner` owns `p_tenant` (raise 42501 otherwise)
2. insert `config_versions` (version = max+1), update `tenants.config`
3. upsert `resources` by `(tenant_id, key)`; deactivate missing (`active=false`), never delete
4. replace `resource_hours`, `resource_breaks` for the tenant
5. materialise `class_sessions` for the next 8 weeks (upsert by `(tenant_id, session_key, starts_at)`); deactivate removed
Always re-validate the config shape in SQL (`jsonb_typeof` checks) — the DB does not trust the app.
