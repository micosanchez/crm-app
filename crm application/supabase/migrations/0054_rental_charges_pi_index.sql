-- 0054 — the partial unique index on rental_charges.stripe_payment_intent_id cannot be used by PostgREST upsert
-- (on_conflict needs a plain unique index); make it a plain unique index (NULLs stay allowed). Applied 2026-10-13.
drop index if exists public.idx_rental_charges_pi;
create unique index if not exists idx_rental_charges_pi on public.rental_charges (stripe_payment_intent_id);
