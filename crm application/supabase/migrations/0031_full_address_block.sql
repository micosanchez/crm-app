-- 0031 Issue 4: the customer-facing document only printed the street line.
-- The token RPCs returned customer_address = c.address (street only). Compose the
-- full address from street + "city, state ZIP", dropping any missing part cleanly.
-- Everything else in these RPCs is identical to 0029 (estimate) / 0028 (invoice).
--
-- Address is returned as a single composed string (one line). The document template
-- renders it as-is; a two-line street / city-state-zip layout would be an app change.

create or replace function public.full_customer_address(
  p_street text, p_city text, p_state text, p_postal text
) returns text language sql immutable as $$
  select nullif(btrim(concat_ws(', ',
    nullif(btrim(p_street), ''),
    nullif(btrim(concat_ws(' ',
      nullif(btrim(concat_ws(', ', nullif(btrim(p_city), ''), nullif(btrim(p_state), ''))), ''),
      nullif(btrim(p_postal), '')
    )), '')
  )), '');
$$;

-- ---------- estimate_by_token (from 0029, only customer_address changed) ----------
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
    'customer_address', public.full_customer_address(c.address, c.city, c.state, c.postal_code),
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
