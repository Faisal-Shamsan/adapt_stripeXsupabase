# Adapt

**Describe your business. Get a booking system.**

Adapt turns a conversation — or a photo of your price list and floor plan — into a working, customer-facing
booking site with online payments. No templates, no settings screens, no sign-up. Built for the
**Stripe × Supabase Hackathon**.

**Live demo:** https://adapt-sshackathon.vercel.app

---

## What it does

A salon owner types *"Three stylists, cuts £42 for 45 minutes, open Tue–Sat 9–6, 25% deposit"* and, a few
seconds later, has a site where customers pick a stylist, choose a slot, pay a deposit through Stripe, and get a
calendar invite. Then she says *"Amira's off on Wednesdays now"* and the site updates. Every change is versioned and
can be restored with one click.

The same engine serves a spin studio where you pick your bike on the floor plan, a spa that needs a therapist **and**
a room at the same time, and a padel club renting courts by the hour. Nothing is generated per business except a
JSON config.

### Why it stands out

- **Chat is the only interface.** Text or photos in, a configured business out. The assistant lists every default it
  filled in as tap-to-correct chips ("Timezone · Europe/London", "Cancellation · 24 hours"), so owners never have to
  guess what was decided for them.
- **You can't break it.** Every change — by the AI or a rollback — is a new config version. History is append-only.
- **Double-booking is impossible, by construction.** A Postgres exclusion constraint refuses an overlapping
  allocation on the same resource; class capacity is enforced under a row lock. Our tests fire 20 concurrent bookings
  at one slot and exactly one wins.
- **Your Stripe, your money.** Each business is a Stripe Connect account (Express dashboard). Customers pay with
  Stripe Checkout as a direct charge; the platform takes a small application fee.
- **AI only costs when the owner talks.** Customer browsing, availability and checkout never touch a model.

---

## How it works

```
owner chat (text + photos)
        │  model tools: ask_owner · apply_patch (RFC 6902)
        ▼
   TenantConfig (JSON, Zod + semantic checks)
        │  apply_config()  — versioned, atomic
        ▼
   Postgres projection: resources, hours, breaks, class sessions (8 weeks ahead, pg_cron extends)
        │
        ▼
   customer site /[slug]  ← available_slots() / available_sessions()
   service → who/where → slot → details → Stripe Checkout → confirmation + .ics
```

**Config is the source of truth.** `apply_config()` stores a new version and projects it into relational tables;
removed resources and sessions are deactivated, never deleted. Rollback re-applies an older version as a new one.

**Correctness lives in the database.** Availability is a SQL function; booking re-validates through the same
function and allocates every required resource in one transaction. Composite `(id, tenant_id)` foreign keys make
cross-tenant references unrepresentable. All local-time maths goes through `AT TIME ZONE` and is tested across both
DST changes.

**Payments.** Bookings start as 31-minute holds. The Connect webhook confirms on `checkout.session.completed`,
releases on expiry, and refunds (fee included) if the hold was lost before payment landed. `pg_cron` expires stale
holds every minute. Cancellation inside the deadline refunds; after it, the slot is released without a refund.

**Security.** Row Level Security on every table, select-only for owners and customers. All writes go through
server routes or `SECURITY DEFINER` functions after explicit ownership checks; those functions are revoked from
`anon` and `authenticated`. The service-role key never reaches the browser. Every request body is Zod-validated.
Owners are anonymous Supabase users created on "Get started" — upgradable to a real account in place.

### Service model

| `capacityType`     | Example              | Requires                 | Customer picks                        |
| ------------------ | -------------------- | ------------------------ | ------------------------------------- |
| `one_to_one`       | Haircut              | `staff: 1`               | a stylist (or "anyone")               |
| `resource_rental`  | Padel court hire     | `court: 1`               | a court (or "any")                    |
| `combination`      | Spa massage          | `staff: 1` + `room: 1`   | a therapist; the room is auto-assigned |
| `class_with_spots` | Spin class, 12 bikes | optional `staff: 1`      | a bike on the floor plan              |

Staff carry `skills`; resources can have their own hours and breaks or inherit the business hours.

---

## Stack

Next.js 15 (App Router) · TypeScript strict · Supabase (Postgres, Auth, Realtime, pg_cron, btree_gist) ·
Stripe Connect (Accounts v2, Checkout, webhooks) · LLM via Anthropic or any OpenAI-compatible endpoint
(Nebius Token Factory for the demo) · Zod · Tailwind · Vitest

## Repository layout

```
src/engine/        config contract (Zod + semantic rules), RFC 6902 patch pipeline, presets, pricing
src/ai/            tools, system prompt, turn loop with validation retry, model adapters
src/renderer/      the one generic site renderer and its sections
src/components/    owner dashboard (chat, preview, bookings, history) and customer booking flow
src/app/           routes: landing, /new, /dashboard, /preview, /[slug], API
supabase/          13 migrations: schema, apply_config, availability, booking functions, payments, RLS
tests/             unit (schema, patch, turn, adapter) and database tests (projection, RLS, DST, races)
```

## Running locally

Requires Node 22 and Docker.

```bash
npm install
cp .env.example .env.local        # add Stripe + model keys
npx supabase start                # local Postgres, Auth, Realtime
npx supabase db reset             # apply migrations
npm run seed                      # four demo businesses
npm run dev                       # http://localhost:3000
```

Tests: `npm test` (unit) · `npm run test:db` (against local Supabase).

## Error codes

Database functions raise stable codes the API maps to HTTP:

| Code    | Meaning                                   | HTTP |
| ------- | ----------------------------------------- | ---- |
| `42501` | not the owner                             | 403  |
| `P0002` | tenant / service / booking not found      | 404  |
| `22023` | invalid input                             | 422  |
| `AD001` | class full                                | 409  |
| `AD002` | slot unavailable or outside booking window | 409 |
| `AD003` | spot required or invalid                  | 422  |
| `AD004` | booking not in a state that allows this   | 409  |
| `AD005` | business cannot take payments yet         | 409  |
| `23P01` | lost a race for a resource                | 409  |

---

Built in a day for the Stripe × Supabase Hackathon.
