---
trigger: glob
globs: src/app/api/**
---
- Order inside every handler: parse body with Zod → resolve session → `assertOwnsTenant` / customer ownership → call DB function via
  the admin client → map Postgres error codes to HTTP status. No step may be skipped or deferred.
- The admin (service role) client is imported only from `@/lib/supabase/admin` and only in files under `src/app/api` or `src/lib`.
- Prices, fees and hold durations are computed server-side from stored config; request bodies never carry amounts.
- AI calls happen only in `src/app/api/chat`; rate-limit before calling the model.
