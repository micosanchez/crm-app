# Fieldtrack CRM

Production-ready field service CRM for junk removal & landscaping operations. A lightweight Jobber alternative: customers, jobs, scheduling, invoicing, mobile field app, offline sync, and a permanent activity-log memory layer.

**Stack:** Next.js 14 (App Router) · Supabase (Postgres + Auth + Storage) · Tailwind · PWA with IndexedDB offline queue · Netlify (primary host).

## Quick start

1. **Create a Supabase project** (free tier works): https://supabase.com/dashboard → New project.
2. **Run the migration:** open SQL Editor in your project, paste the contents of `supabase/migrations/0001_initial.sql`, run it once.
3. **Configure env:** `cp .env.example .env.local` and fill in the URL + keys from Settings → API.
4. **Install & run:**
   ```bash
   npm install
   npm run dev
   ```
5. Open http://localhost:3000 → sign up. The first user is created as `technician`; promote yourself to admin in Supabase Table Editor (`users` table → `role` → `admin`).

## Deploy

See [DEPLOYMENT.md](./DEPLOYMENT.md) — Netlify (primary) and Vercel covered. Architecture and build order in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Key guarantees

- **Persistent memory:** every create/update/delete on core tables is written to `activity_log` by database triggers — even direct DB edits are captured. Nothing lives only in browser memory.
- **Immutable history:** job status transitions append to `job_status_history`; the activity log has no update/delete policies.
- **Offline-first field work:** mutations queue in IndexedDB with client-generated idempotency keys and flush to `/api/sync` on reconnect. Duplicates are dropped server-side; update conflicts resolve by timestamp (server-newer wins).
- **Role-based access:** admin / dispatcher / technician enforced via Postgres RLS (technicians can't write invoices).

## Project map

```
supabase/migrations/   Database schema, triggers, RLS (the source of truth)
src/lib/supabase/      Browser + server Supabase clients
src/lib/offline/       IndexedDB queue + sync engine
src/app/api/sync/      Idempotent batch sync endpoint
src/app/api/invoices/  Invoice auto-generation from jobs
src/app/               Dashboard, customers, jobs (kanban), schedule, invoices, field (mobile)
public/sw.js           Service worker: offline shell + sync trigger
netlify.toml           Netlify build config
```
