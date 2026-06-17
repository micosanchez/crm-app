-- ============================================================
-- Payments + deposits — closes the money loop (audit gap #1).
-- STAGED: run at batch release. Feature-flagged via NEXT_PUBLIC_FF_PAYMENTS.
-- Works with cash/Venmo/check today; Stripe online-pay layers on top later.
-- ============================================================

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  method text not null check (method in ('cash','venmo','card','check','other')),
  kind text not null default 'payment' check (kind in ('deposit','payment')),
  reference text,                              -- e.g. Venmo note, check #, Stripe id
  paid_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists payments_invoice_idx on public.payments(invoice_id);

alter table public.invoices add column if not exists amount_paid numeric(10,2) not null default 0;

-- Keep amount_paid in sync and auto-mark paid when fully collected (cash basis).
create or replace function public.recompute_invoice_paid() returns trigger as $$
declare v_invoice uuid; v_paid numeric; v_total numeric;
begin
  v_invoice := coalesce(new.invoice_id, old.invoice_id);
  select coalesce(sum(amount),0) into v_paid from public.payments where invoice_id = v_invoice;
  select total into v_total from public.invoices where id = v_invoice;
  update public.invoices
    set amount_paid = v_paid,
        status   = case when v_paid >= v_total and v_total > 0 then 'paid' else status end,
        paid_at  = case when v_paid >= v_total and v_total > 0 then coalesce(paid_at, now()) else paid_at end
    where id = v_invoice;
  return coalesce(new, old);
end; $$ language plpgsql security definer;

create trigger payments_recompute after insert or update or delete on public.payments
  for each row execute function public.recompute_invoice_paid();

alter table public.payments enable row level security;
create policy payments_read  on public.payments for select to authenticated
  using (public.app_role() in ('admin','dispatcher'));
create policy payments_write on public.payments for all to authenticated
  using (public.app_role() in ('admin','dispatcher'))
  with check (public.app_role() in ('admin','dispatcher'));

create trigger payments_log after insert or update or delete on public.payments
  for each row execute function public.log_activity();
