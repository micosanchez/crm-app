# Fieldtrack CRM — Architecture

## System overview

```
┌────────────────────────────────────────────────────────────┐
│  Clients                                                   │
│  • Web dashboard (desktop)   • PWA field app (mobile)      │
│  • Service worker: shell cache, sync trigger               │
│  • IndexedDB: offline action queue (idempotency keys)      │
└──────────────┬─────────────────────────────────────────────┘
               │ HTTPS
┌──────────────▼─────────────────────────────────────────────┐
│  Next.js 14 on Netlify (SSR + serverless functions)        │
│  • Server components: reads via Supabase (RLS enforced)    │
│  • /api/sync: idempotent batch mutation endpoint           │
│  • /api/invoices: invoice generation workflow              │
│  • middleware.ts: session refresh + auth guard             │
└──────────────┬─────────────────────────────────────────────┘
               │ Postgres protocol / PostgREST
┌──────────────▼─────────────────────────────────────────────┐
│  Supabase                                                  │
│  • Postgres: all entities + RLS role policies              │
│  • Triggers: activity_log (memory), status history,        │
│    invoice totals, updated_at, user provisioning           │
│  • Auth: email/password sessions (cookies via @supabase/ssr)│
│  • Storage: job-photos bucket                              │
└────────────────────────────────────────────────────────────┘
```

## Memory layer (persistence backbone)

`activity_log(entity_type, entity_id, action_type, user_id, metadata jsonb, created_at)`

Written by **database triggers**, not application code — so every insert/update/delete on customers, jobs, invoices, notes, and schedule_events is logged regardless of which client (web, mobile, sync endpoint, SQL editor) performed it. Update entries store `{before, after}` snapshots in `metadata`. RLS allows staff to read but never modify it. This powers the dashboard activity feed and per-customer timelines.

`job_status_history` is the same pattern specialized for the job lifecycle: Lead → Scheduled → In Progress → Completed → Invoiced → Paid.

## Data flow rules

1. **Reads** happen in server components via the cookie-scoped Supabase client; RLS applies per user.
2. **Writes from interactive UI** go through `mutate()` (src/lib/offline/sync.ts): enqueue to IndexedDB → immediate flush attempt → `/api/sync`.
3. **Back-office writes** (invoice items, status flips) that require connectivity use the Supabase browser client directly.
4. **No client ever writes activity_log or job_status_history** — triggers only.

## Offline sync strategy

- Every queued action carries `idempotency_key` (client uuid) + `client_ts`.
- `/api/sync` checks `idempotency_keys` table; replays are skipped (`duplicate_skipped`).
- Update conflicts: if the server row's `updated_at` > action's `client_ts`, the action is rejected as `conflict_server_newer` (timestamp priority, last-write-wins).
- Flush triggers: `online` event, service-worker `sync` message, 30s interval, and on every mutation.
- The amber banner (SwRegister component) shows offline state / pending count.

## Auth & roles

- Supabase Auth (email/password). `handle_new_user` trigger creates a `users` profile row (default role: technician).
- Roles: **admin** (everything incl. user management), **dispatcher** (scheduling + invoicing), **technician** (jobs, customers, notes; invoices read-only).
- Enforced in Postgres RLS via `app_role()` — the API cannot bypass it (no service-role key in request paths).

## API surface

| Route | Method | Purpose |
|---|---|---|
| `/api/sync` | POST | Batch idempotent mutations from offline queue |
| `/api/invoices` | POST | Generate draft invoice from job, advance job to invoiced |
| PostgREST (via supabase-js) | — | All RLS-guarded reads and online CRUD |

## Communication layer placeholders

`messages` table stores sms/email/internal with `status` + `provider_id` columns. To wire real SMS: add a Twilio webhook route at `/api/messages/send` that inserts into `messages`, calls Twilio, and updates `status` from delivery callbacks. Schema requires no changes.

## Build order (how this was assembled / how to extend)

1. Schema + triggers + RLS (`supabase/migrations`) — the contract everything obeys
2. Auth plumbing (middleware, Supabase clients)
3. Offline queue + sync endpoint
4. CRM + jobs + kanban
5. Scheduling + invoicing + PDF (print pipeline)
6. Field PWA + service worker
7. Deploy configs + docs

## Future hardening (post-MVP)

- Photo upload UI → `job-photos` bucket (schema/storage already provisioned)
- Twilio/SendGrid integration on `messages`
- Drag-to-reschedule on the calendar (jobs already update by date)
- Background Sync API registration for guaranteed flush on Android
- Per-technician job filtering on /field via `job_assignments`
