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
`applyConfigPatch(base | null, ops)`: Zod-check the ops → fast-json-patch (`validate=true`, on a clone) → `validateConfig` →
`{ ok, config } | { ok: false, stage: "patch" | "validate", errors: [{ path, message }] }`. A null base is `{}`; the model
bootstraps with one `{ op: "replace", path: "", value: <full config> }`.

## AI turn (`src/ai/turn.ts`, pure; `CallModel` is the only network seam)
- Tools: exactly `ask_owner(question, chips[])` and `apply_patch(patch, summary)` (`src/ai/tools.ts`). Unknown tools → plain message.
- Sends `systemPrompt(config)` (contract + current config JSON) + last `HISTORY_LIMIT = 6` history messages (text only) + the
  new message (images as base64 blocks before the text).
- On invalid patch: push the assistant turn + a `tool_result` with `is_error` and the path-addressed errors, call the model again
  once (`MAX_ATTEMPTS = 2`). Second failure → `{ type: "invalid" }`, config untouched.
- `/api/chat` is the only place the model runs: `requireOwner` → `consume_ai_turn` (30/h sliding window) → `recent_chat` →
  `runTurn` → on patch `apply_config(source='ai', prompt=message)` → `append_chat` both turns.
- Tests script the model with `script([...responses])` (`tests/unit/turn.test.ts`) and assert the exact request contents.

## apply_config (Postgres)
`apply_config(p_tenant uuid, p_owner uuid, p_config jsonb, p_source text, p_prompt text)` SECURITY DEFINER:
1. assert `p_owner` owns `p_tenant` (raise 42501 otherwise)
2. insert `config_versions` (version = max+1), update `tenants.config`
3. upsert `resources` by `(tenant_id, key)`; deactivate missing (`active=false`), never delete
4. replace `resource_hours`, `resource_breaks` for the tenant
5. materialise `class_sessions` for the next 8 weeks (upsert by `(tenant_id, session_key, starts_at)`); deactivate removed
Always re-validate the config shape in SQL (`jsonb_typeof` checks) — the DB does not trust the app.
