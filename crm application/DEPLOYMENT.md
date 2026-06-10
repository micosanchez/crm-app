# Deployment Guide

## Prerequisites (all hosts)

1. Supabase project created, migration `supabase/migrations/0001_initial.sql` run in the SQL Editor.
2. In Supabase → Authentication → URL Configuration, set **Site URL** to your production domain (and add it to redirect URLs).
3. Have these values ready (Supabase → Settings → API):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only; not currently required by any route, but reserved for admin jobs)

---

## Option A — Netlify (primary)

### One-time setup

1. Push this repo to GitHub/GitLab.
2. Netlify → **Add new site → Import an existing project** → pick the repo.
3. Netlify auto-detects Next.js; `netlify.toml` pins:
   - build command `npm run build`, publish `.next`, Node 20
   - `@netlify/plugin-nextjs` runtime (SSR + API routes run as Netlify Functions; middleware runs on the edge)
4. **Site settings → Environment variables** → add the three vars above.
5. Deploy. Every push to the default branch triggers CI/CD; PRs get deploy previews.

### CLI alternative

```bash
npm i -g netlify-cli
netlify init          # link repo + site
netlify env:set NEXT_PUBLIC_SUPABASE_URL "https://YOUR-PROJECT.supabase.co"
netlify env:set NEXT_PUBLIC_SUPABASE_ANON_KEY "..."
netlify env:set SUPABASE_SERVICE_ROLE_KEY "..."
netlify deploy --build --prod
```

### Notes

- API routes (`/api/sync`, `/api/invoices`) deploy automatically as serverless functions — no extra config.
- The service worker (`public/sw.js`) is served from the site root with correct cache headers (set in `next.config.mjs`).
- Custom domain: Site settings → Domain management; then update the Supabase Site URL.

---

## Option B — Vercel

1. vercel.com → Import repo (zero config for Next.js).
2. Add the same three environment variables.
3. Deploy.

---

## Post-deploy checklist

- [ ] Sign up the first account, then set its `role` to `admin` in Supabase Table Editor → `users`.
- [ ] Visit `/field` on a phone → browser menu → **Add to Home Screen** (PWA install).
- [ ] Airplane-mode test: add a note offline → reconnect → confirm it appears and `activity_log` recorded it.
- [ ] Confirm a technician account cannot create invoice items (RLS check).
