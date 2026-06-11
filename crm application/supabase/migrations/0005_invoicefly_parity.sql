-- ============================================================
-- SJHC Phase 4: item details, payment instructions/comments,
-- invoice tips, payment methods
-- ============================================================

alter table public.estimate_items add column details text;
alter table public.invoice_items add column details text;

alter table public.estimates
  add column payment_instructions text,
  add column comments text;

alter table public.invoices
  add column payment_instructions text,
  add column comments text,
  add column tip numeric(10,2) not null default 0,
  add column payment_method text check (payment_method in ('cash','venmo','card','check','other'));

-- Recompute invoice totals including tip (replaces 0001 version)
create or replace function public.recompute_invoice_total() returns trigger as $$
declare v_invoice uuid; v_sub numeric;
begin
  v_invoice := coalesce(new.invoice_id, old.invoice_id);
  select coalesce(sum(amount),0) into v_sub from public.invoice_items where invoice_id = v_invoice;
  update public.invoices
    set subtotal = v_sub, total = round(v_sub * (1 + tax_rate), 2) + tip
    where id = v_invoice;
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

-- Keep total in sync when tip or tax change directly on the invoice
create or replace function public.sync_invoice_total() returns trigger as $$
begin
  new.total := round(new.subtotal * (1 + new.tax_rate), 2) + new.tip;
  return new;
end;
$$ language plpgsql;

create trigger invoices_total_sync before update of tip, tax_rate on public.invoices
  for each row execute function public.sync_invoice_total();

-- Refresh token RPCs: include details, payment info, comments, tip, view_count
create or replace function public.estimate_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare result jsonb;
begin
  update public.estimates set viewed_at = coalesce(viewed_at, now()), view_count = view_count + 1
    where public_token = p_token;
  select jsonb_build_object(
    'kind','estimate','number', e.estimate_number,'status', e.status,'notes', e.notes,
    'total', e.total,'created_at', e.created_at,'valid_until', e.valid_until,
    'signed_name', e.signed_name,'signed_at', e.signed_at,'customer_name', c.name,
    'payment_instructions', e.payment_instructions,'comments', e.comments,
    'view_count', e.view_count,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'description', i.description,'details', i.details,'quantity', i.quantity,
        'unit_price', i.unit_price,'amount', i.amount))
      from public.estimate_items i where i.estimate_id = e.id), '[]'::jsonb)
  ) into result
  from public.estimates e left join public.customers c on c.id = e.customer_id
  where e.public_token = p_token;
  return result;
end;
$fn$;

create or replace function public.invoice_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare result jsonb;
begin
  update public.invoices set viewed_at = coalesce(viewed_at, now()), view_count = view_count + 1
    where public_token = p_token;
  select jsonb_build_object(
    'kind','invoice','number', v.invoice_number,'status', v.status,
    'total', v.total,'tip', v.tip,'created_at', v.created_at,'due_at', v.due_at,
    'signed_name', v.signed_name,'signed_at', v.signed_at,'customer_name', c.name,
    'payment_instructions', v.payment_instructions,'comments', v.comments,
    'view_count', v.view_count,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'description', i.description,'details', i.details,'quantity', i.quantity,
        'unit_price', i.unit_price,'amount', i.amount))
      from public.invoice_items i where i.invoice_id = v.id), '[]'::jsonb)
  ) into result
  from public.invoices v left join public.customers c on c.id = v.customer_id
  where v.public_token = p_token;
  return result;
end;
$fn$;
