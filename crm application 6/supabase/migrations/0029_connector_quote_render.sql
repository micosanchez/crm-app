-- 0029 Make connector-written quotes render like composer quotes.
-- The sjhc-connector create_quote tool has only ONE customer-facing field
-- (`description`) and cannot set terms. So connector quotes land as a single
-- estimate_item with everything in its description, line_item/description/terms NULL.
--
-- Fix at the render layer (this RPC), no connector change needed:
--   1. Terms: fall back to business_settings defaults when a quote has none, so
--      every quote shows the prefilled Payment / Additional Terms.
--   2. Line item: in the estimate_items fallback branch (connector quotes), split
--      the item description on ' || ' into a short title + a paragraph, matching
--      the composer's "THE JOB" title + description box. The skill writes the
--      field as "<short title> || <paragraph>". No delimiter = title only.
--   The line_item branch (composer/app quotes, already split) is untouched.

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
    'payment_instructions', coalesce(e.payment_terms, e.payment_instructions, bs.default_payment_terms),
    'comments', coalesce(e.additional_terms, e.comments, bs.default_additional_terms),
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
          'description', case when position(' || ' in i.description) > 0
                              then btrim(split_part(i.description, ' || ', 1)) else i.description end,
          'details', case when position(' || ' in i.description) > 0
                          then coalesce(i.details, btrim(substr(i.description, position(' || ' in i.description) + 4)))
                          else i.details end,
          'quantity', i.quantity,'unit_price', i.unit_price,'amount', i.amount))
        from public.estimate_items i where i.estimate_id = e.id), '[]'::jsonb)
    end
  ) into result
  from public.estimates e
  left join public.customers c on c.id = e.customer_id
  left join public.business_settings bs on bs.id
  where e.public_token = p_token;
  return result;
end;
$fn$;
