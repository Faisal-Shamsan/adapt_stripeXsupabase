# Adapt

**Describe your business to an AI. Get a working booking system.**

Adapt is a multi-tenant SaaS for small businesses: gyms, salons, spas, padel clubs, studios. The owner chats
with an AI assistant (text, or photos of a price list, timetable or floor plan) and gets a configured
booking system: an owner portal to run the business and a customer-facing booking site with online payments.

One engine serves every business type. Nothing is generated per tenant except a JSON config.

## How it works

```
owner chat (text + images)
        │  Anthropic: ask_owner / apply_patch (RFC 6902)
        ▼
   TenantConfig (JSON)  ──Zod + semantic checks──▶  apply_config()  ──▶  Postgres projection
   business · resources · services                   versioned        resources, hours, breaks,
   schedules · rules · ui                                              class_sessions (8 weeks ahead)
                                                                              │
                              customer site /[slug]  ◀── available_slots() ◀──┘
                              pick service → who/where → slot → pay (Stripe Checkout)
```

- **Config is the source of truth.** Every change — AI, manual form, rollback — goes through `apply_config()`,
  which stores a new version and projects it into relational tables. Removed things are deactivated, never deleted.
- **Correctness lives in the database.** Double booking is impossible by construction:
  `booking_allocations` has `EXCLUDE USING gist (resource_id WITH =, during WITH &&) WHERE (active)`.
  Class capacity uses `SELECT ... FOR UPDATE`. Composite `(id, tenant_id)` foreign keys make cross-tenant
  references unrepresentable. Availability is a SQL function; booking re-validates through the same function.
- **Timezone-correct.** All local-time maths goes through `AT TIME ZONE`; tested across both DST changes.
- **Payments via Stripe Connect.** We are the platform; each tenant is an Express-dashboard connected account.
  Customers pay with Stripe Checkout as a direct charge with an application fee. Bookings start as 31-minute
  holds; the Connect webhook confirms, releases or refunds. `pg_cron` expires stale holds.
- **AI only on owner actions.** Customer browsing and checkout never touch the model. The model receives the
  current config plus the last six messages and may only emit config data, never code.
- **Security.** RLS on every table (select-only for owners and customers). All writes go through server routes
  or `SECURITY DEFINER` functions after explicit ownership checks; those functions are revoked from `anon`
  and `authenticated`. The service-role key never reaches the browser.

## Service model

| `capacityType`     | Example                | `requires`               | Allocation                                    |
| ------------------ | ---------------------- | ------------------------ | --------------------------------------------- |
| `one_to_one`       | Haircut                | `staff:1`                | one skilled staff member                      |
| `resource_rental`  | Padel court hire       | `court:1`                | one court                                     |
| `combination`      | Spa massage            | `staff:1` + `room:1`     | one of each kind, in one transaction          |
| `class_with_spots` | Spin class, 12 bikes   | optional `staff:1`       | a seat; with `spotKind` the customer picks a bike on the floor plan |

Staff carry `skills` (service keys). Resources may have per-resource hours and breaks; those without inherit
business hours. Owners add `time_off` outside the config.

## Stack

Next.js (App Router) · TypeScript strict (`noUncheckedIndexedAccess`) · Supabase (Postgres, Auth, Realtime,
Storage, `pg_cron`, `btree_gist`) · Stripe Connect · Anthropic API · Zod · Tailwind · Vitest

## Repository layout

```
src/engine/        Zod config contract, semantic validation, presets (gym, salon, spa, padel), pricing
supabase/          migrations (schema, apply_config, availability, booking functions, RLS) and local config
tests/unit/        schema + pricing tests
tests/db/          tests against local Postgres: projection, RLS, FKs, availability, DST, 20-way races
.devin/            agent skills and rules used while building
```

## Running locally

Requires Node 22 and Docker (for local Supabase).

```bash
npm install
cp .env.example .env.local        # fill in Stripe + Anthropic keys when needed
npx supabase start                # first run pulls images
npx supabase db reset             # applies migrations
npm run typecheck && npm test     # unit tests
npm run test:db                   # database tests (needs supabase running)
npm run dev
```

Supabase Studio is at http://127.0.0.1:54323 when running.

## Milestones

| #  | Scope                                                                  | Status |
| -- | ---------------------------------------------------------------------- | ------ |
| M1 | Config contract (Zod + semantic checks), presets, unit tests           | done   |
| M2 | Migrations, `apply_config` projection, RLS, tenant-isolation tests     | done   |
| M3 | Availability engine, booking functions, DST and concurrency tests      | done   |
| M4 | Stripe Connect onboarding, Checkout, webhook, hold lifecycle           |        |
| M5 | AI chat with `ask_owner` / `apply_patch`, validation retry             |        |
| M6 | Owner portal and customer booking site                                 |        |

## Error codes

Postgres functions raise stable codes that the API maps to HTTP:

| Code    | Meaning                        | HTTP |
| ------- | ------------------------------ | ---- |
| `42501` | not the tenant owner           | 403  |
| `P0002` | tenant / service / session missing | 404 |
| `22023` | invalid input                  | 422  |
| `AD001` | class full                     | 409  |
| `AD002` | slot unavailable / outside booking window | 409 |
| `AD003` | spot required or invalid       | 422  |
| `23P01` | lost a race for a resource     | 409  |
