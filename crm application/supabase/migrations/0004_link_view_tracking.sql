-- ============================================================
-- SJHC Phase 3b: track when customer share links are opened
-- ============================================================

alter table public.estimates
  add column viewed_at timestamptz,
  add column view_count int not null default 0;

alter table public.invoices
  add column viewed_at timestamptz,
  add column view_count int not null default 0;

-- Recreate the token readers as volatile so they can record the view.
create or replace function public.estimate_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  update public.estimates
    set viewed_at = coalesce(viewed_at, now()), view_count = view_count + 1
    where public_token = p_token;

  select jsonb_build_object(
    'kind','estimate','number', e.estimate_number,'status', e.status,'notes', e.notes,
    'total', e.total,'created_at', e.created_at,'valid_until', e.valid_until,
    'signed_name', e.signed_name,'signed_at', e.signed_at,'customer_name', c.name,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'description', i.description,'quantity', i.quantity,
        'unit_price', i.unit_price,'amount', i.amount))
      from public.estimate_items i where i.estimate_id = e.id), '[]'::jsonb)
  ) into result
  from public.estimates e
  left join public.customers c on c.id = e.customer_id
  where e.public_token = p_token;

  return result;
end;
$$;

create or replace function public.invoice_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  update public.invoices
    set viewed_at = coalesce(viewed_at, now()), view_count = view_count + 1
    where public_token = p_token;

  select jsonb_build_object(
    'kind','invoice','number', v.invoice_number,'status', v.status,
    'total', v.total,'created_at', v.created_at,'due_at', v.due_at,
    'signed_name', v.signed_name,'signed_at', v.signed_at,'customer_name', c.name,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'description', i.description,'quantity', i.quantity,
        'unit_price', i.unit_price,'amount', i.amount))
      from public.invoice_items i where i.invoice_id = v.id), '[]'::jsonb)
  ) into result
  from public.invoices v
  left join public.customers c on c.id = v.customer_id
  where v.public_token = p_token;

  return result;
end;
$$;
