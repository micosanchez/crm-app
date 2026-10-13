-- 0052 — Tote rentals are paid in full at booking (no deposit), 2026-10-12.
-- rental_quote keeps its shape; deposit is always 0 and the balance (= total) is charged at booking.
alter table public.rental_settings alter column balance_charge_mode set default 'booking';
update public.rental_settings set balance_charge_mode = 'booking' where id;

create or replace function public.rental_quote(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.rental_settings; pk public.rental_packages; a record; v_weeks int := coalesce((p->>'extra_weeks')::int, 0);
        v_sub numeric := 0; v_add numeric := 0; v_del numeric := 0; v_disc numeric := 0; v_dep numeric := 0; v_total numeric; v_days int; v_lines jsonb := '[]';
        v_miles numeric; v_pmiles numeric; v_partner public.rental_partners; v_dollies int := 0;
begin
  select * into s from public.rental_settings where id;
  select * into pk from public.rental_packages where id = (p->>'package_id')::uuid and active;
  if pk.id is null then return jsonb_build_object('error', 'Pick a package.'); end if;
  if pk.price is null then return jsonb_build_object('error', 'That package has no price yet.'); end if;
  v_sub := pk.price + v_weeks * coalesce(pk.extra_week_price, 0);
  v_days := pk.rental_days_included + v_weeks * 7;
  for a in select (x->>'addon_id')::uuid as addon_id, (x->>'qty')::int as qty from jsonb_array_elements(coalesce(p->'addons','[]')) x loop
    declare ad public.rental_addons; begin
      select * into ad from public.rental_addons where id = a.addon_id and active;
      if ad.id is null or a.qty is null or a.qty <= 0 then continue; end if;
      if a.qty > ad.max_qty then return jsonb_build_object('error', format('Max %s of %s.', ad.max_qty, ad.name)); end if;
      v_add := v_add + ad.price * a.qty * case when ad.per = 'day' then v_days else 1 end;
      if ad.asset_type = 'dolly' then v_dollies := v_dollies + a.qty; end if;
      v_lines := v_lines || jsonb_build_object('addon_id', ad.id, 'name', ad.name, 'qty', a.qty, 'unit_price', ad.price, 'line', ad.price * a.qty * case when ad.per = 'day' then v_days else 1 end);
    end;
  end loop;
  v_miles := (p->>'delivery_miles')::numeric; v_pmiles := coalesce((p->>'pickup_miles')::numeric, v_miles);
  if v_miles is not null then
    if v_miles > s.max_service_radius_miles or v_pmiles > s.max_service_radius_miles then return jsonb_build_object('error', 'out_of_area'); end if;
    v_del := coalesce(s.delivery_fee_base, 0) + greatest(v_miles - coalesce(s.free_delivery_radius_miles, 0), 0) * coalesce(s.per_mile_fee, 0)
           + greatest(v_pmiles - coalesce(s.free_delivery_radius_miles, 0), 0) * coalesce(s.per_mile_fee, 0);
  end if;
  if nullif(p->>'promo_code','') is not null then
    select * into v_partner from public.rental_partners where upper(referral_code) = upper(p->>'promo_code') and active;
    if v_partner.id is null then return jsonb_build_object('error', 'That code is not valid.'); end if;
    v_disc := case when v_partner.discount_type = 'percent' then round((v_sub + v_add) * v_partner.discount_amount / 100, 2) else v_partner.discount_amount end;
    v_disc := least(v_disc, v_sub + v_add);
  end if;
  v_total := round(v_sub + v_add + v_del - v_disc, 2);
  v_dep := 0;   -- paid in full at booking; no deposit
  return jsonb_build_object('package', jsonb_build_object('id', pk.id, 'name', pk.name, 'tote_count', pk.tote_count, 'days', v_days, 'price', pk.price),
    'extra_weeks', v_weeks, 'subtotal', round(v_sub,2), 'addons', v_lines, 'addons_total', round(v_add,2), 'delivery_fee', round(v_del,2), 'delivery_miles', v_miles, 'pickup_miles', v_pmiles,
    'discount', round(v_disc,2), 'partner_id', v_partner.id, 'total', v_total, 'deposit', v_dep, 'balance', round(v_total - v_dep, 2), 'tote_count', pk.tote_count, 'dolly_count', v_dollies,
    'balance_charge_mode', s.balance_charge_mode, 'rental_days', v_days);
end $$;
grant execute on function public.rental_quote(jsonb) to anon, authenticated;

select balance_charge_mode from public.rental_settings;
