-- 0057 — hotfix 2026-10-13: estimate_requests_to_lead (0046) ran BEFORE INSERT and inserted a leads row whose
-- estimate_request_id pointed at a request row that did not exist yet, so every website quote request (and every
-- tote cross-sell request) failed with an FK violation since 2026-09-27. Fires AFTER INSERT now and writes lead_id back.
create or replace function public.estimate_request_to_lead() returns trigger language plpgsql security definer set search_path = public as $$
declare v_lead uuid; v_src public.lead_source;
begin
  if new.lead_id is null then
    v_src := case lower(coalesce(new.utm_source, new.lead_source, ''))
      when 'facebook' then 'meta_ads' when 'meta' then 'meta_ads' when 'fb' then 'meta_ads' when 'instagram' then 'instagram'
      when 'google' then 'google_search_organic' when 'gbp' then 'google_business_profile' when 'nextdoor' then 'nextdoor'
      when 'text' then 'other' when 'yard_sign' then 'yard_sign_flyer' when 'website' then 'website_direct'
      else case when new.lead_source is not null and public.is_lead_source(new.lead_source) then new.lead_source::public.lead_source else 'website_direct' end end;
    insert into public.leads (name, phone, email, address, source, status, channel_in, notes, customer_id, lead_source_detail, utm_source, utm_medium, utm_campaign, estimate_request_id, created_by)
    values (btrim(new.first_name || ' ' || new.last_name), new.phone, new.email, new.address, v_src, 'new', 'web_form', new.description, new.customer_id, coalesce(new.heard_about_us, new.lead_source), new.utm_source, new.utm_medium, new.utm_campaign, new.id, null)
    returning id into v_lead;
    update public.estimate_requests set lead_id = v_lead where id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists estimate_requests_to_lead on public.estimate_requests;
create trigger estimate_requests_to_lead after insert on public.estimate_requests for each row execute function public.estimate_request_to_lead();
