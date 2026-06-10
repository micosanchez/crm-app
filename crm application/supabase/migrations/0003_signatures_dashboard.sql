-- ============================================================
-- SJHC Phase 3: customer share links + signatures
-- Run in Supabase SQL Editor after 0002
-- ============================================================

-- Share tokens + signature storage on estimates and invoices
alter table public.estimates
  add column public_token uuid not null default gen_random_uuid(),
  add column signed_name text,
  add column signature_data text,          -- data-URL PNG of the signature
  add column signed_at timestamptz;
create unique index estimates_token_idx on public.estimates(public_token);

alter table public.invoices
  add column public_token uuid not null default gen_random_uuid(),
  add column signed_name text,
  add column signature_data text,
  add column signed_at timestamptz;
create unique index invoices_token_idx on public.invoices(public_token);

-- ---------- PUBLIC (anon) READ VIA TOKEN — security definer RPCs ----------
-- Customers open share links without logging in. These functions expose only
-- the single document matching the unguessable token.

create or replace function public.estimate_by_token(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'kind','estimate',
    'number', e.estimate_number,
    'status', e.status,
    'notes', e.notes,
    'total', e.total,
    'created_at', e.created_at,
    'valid_until', e.valid_until,
    'signed_name', e.signed_name,
    'signed_at', e.signed_at,
    'customer_name', c.name,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'description', i.description, 'quantity', i.quantity,
        'unit_price', i.unit_price, 'amount', i.amount))
      from public.estimate_items i where i.estimate_id = e.id), '[]'::jsonb)
  )
  from public.estimates e
  left join public.customers c on c.id = e.customer_id
  where e.public_token = p_token;
$$;

create or replace function public.invoice_by_token(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'kind','invoice',
    'number', v.invoice_number,
    'status', v.status,
    'total', v.total,
    'created_at', v.created_at,
    'due_at', v.due_at,
    'signed_name', v.signed_name,
    'signed_at', v.signed_at,
    'customer_name', c.name,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'description', i.description, 'quantity', i.quantity,
        'unit_price', i.unit_price, 'amount', i.amount))
      from public.invoice_items i where i.invoice_id = v.id), '[]'::jsonb)
  )
  from public.invoices v
  left join public.customers c on c.id = v.customer_id
  where v.public_token = p_token;
$$;

-- Signing: one-shot, only if not already signed. Signing an estimate accepts it.
create or replace function public.sign_estimate(p_token uuid, p_name text, p_signature text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.estimates
    set signed_name = p_name, signature_data = p_signature, signed_at = now(),
        status = 'accepted', accepted_at = coalesce(accepted_at, now())
    where public_token = p_token and signed_at is null;
  return found;
end;
$$;

create or replace function public.sign_invoice(p_token uuid, p_name text, p_signature text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.invoices
    set signed_name = p_name, signature_data = p_signature, signed_at = now()
    where public_token = p_token and signed_at is null;
  return found;
end;
$$;

grant execute on function public.estimate_by_token(uuid) to anon, authenticated;
grant execute on function public.invoice_by_token(uuid) to anon, authenticated;
grant execute on function public.sign_estimate(uuid, text, text) to anon, authenticated;
grant execute on function public.sign_invoice(uuid, text, text) to anon, authenticated;
