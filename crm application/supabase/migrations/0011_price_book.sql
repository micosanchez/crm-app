-- ============================================================
-- Price book — saved service items for fast estimating (audit quick-win).
-- STAGED: run at batch release. Flagged via NEXT_PUBLIC_FF_PRICE_BOOK.
-- ============================================================

create table if not exists public.service_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  default_price numeric(10,2) not null default 0,
  kind text not null default 'labor' check (kind in ('labor','disposal','materials','other')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists service_items_active_idx on public.service_items(active);

alter table public.service_items enable row level security;
create policy service_items_all on public.service_items for all to authenticated
  using (true) with check (true);

-- Optional seed (commented; uncomment at release if desired)
-- insert into public.service_items (name, default_price, kind, description) values
--   ('Single item haul', 75, 'labor', 'One bulky item removed and disposed'),
--   ('Half load', 250, 'labor', 'Up to half a truck bed'),
--   ('Full load', 450, 'labor', 'Full truck load removed'),
--   ('Tire disposal (each)', 8, 'disposal', 'Per-tire licensed disposal'),
--   ('Yard / brush cleanup', 200, 'labor', 'Brush, branches, yard debris');
