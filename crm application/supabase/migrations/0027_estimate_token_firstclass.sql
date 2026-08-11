-- 0027 estimate_by_token: read first-class quote fields, fall back to legacy.
-- Composer quotes store one line item in estimates.line_item/description + the
-- price in estimates.total, and terms in payment_terms/additional_terms. Old
-- quotes still use estimate_items + payment_instructions/comments. This RPC
-- coalesces new -> legacy so the signing page renders BOTH with no client change.
-- 'notes' (internal) is intentionally never returned to the customer view.

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
