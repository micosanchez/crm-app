-- 0028 Return business identity on the public token RPCs so the customer-facing
-- document letterhead is driven by business_settings (editable in the app),
-- not a hardcoded constant. Public signers aren't authenticated, so they can't
-- read business_settings directly — these security-definer RPCs carry it out.
-- Keys match the client's default identity object so it merges field-by-field.

create or replace function public.estimate_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare result jsonb;
begin
  update public.estimates set viewed_at = coalesce(viewed_at, now()), view_count = view_count + 1
    where public_token = p_token;
  select jsonb_build_object(
    'kind','estimate','number', e.estimate_number,'status', e.status,
    'total', e.total,'created_at', e.created_at,'valid_until', e.valid_until,
    'signed_name', e.signed_name,'signed_at', e.signed_at,'customer_name', c.name,
    'customer_address', c.address,
    'payment_instructions', coalesce(e.payment_terms, e.payment_instructions),
    'comments', coalesce(e.additional_terms, e.comments),
    'view_count', e.view_count,
    'biz', (select jsonb_build_object(
        'name', business_name,'tagline', tagline,'phone', phone,'email', email,
        'website', website,'area', service_area,'licensed_insured', licensed_insured,'ein', ein)
      from public.business_settings where id),
    'items', case
      when e.line_item is not null then
        jsonb_build_array(jsonb_build_object(
          'description', e.line_item, 'details', e.description,
          'quantity', 1, 'unit_price', e.total, 'amount', e.total))
      else coalesce((select jsonb_agg(jsonb_build_object(
          'description', i.description,'details', i.details,'quantity', i.quantity,
          'unit_price', i.unit_price,'amount', i.amount))
        from public.estimate_items i where i.estimate_id = e.id), '[]'::jsonb)
    end
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
    'customer_address', c.address,
    'payment_instructions', v.payment_instructions,'comments', v.comments,
    'view_count', v.view_count,
    'biz', (select jsonb_build_object(
        'name', business_name,'tagline', tagline,'phone', phone,'email', email,
        'website', website,'area', service_area,'licensed_insured', licensed_insured,'ein', ein)
      from public.business_settings where id),
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
