-- 0065: 2026-11-25. Accepting, declining or spamming any estimate request failed with
-- "CASE types lead_status and text cannot be matched": the 0044 trigger's CASE mixed text literals with the
-- lead_status column (else status). Same logic, literals cast to the enum.
create or replace function public.estimate_request_status_to_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is not null and (new.status is distinct from old.status or new.quote_id is distinct from old.quote_id or new.customer_id is distinct from old.customer_id) then
    update public.leads set
      status = case new.status when 'accepted' then (case when new.quote_id is not null then 'quoted' else 'contacted' end)::public.lead_status
                               when 'declined' then 'not_a_fit'::public.lead_status
                               when 'spam' then 'spam'::public.lead_status
                               else status end,
      quote_id = coalesce(new.quote_id, quote_id),
      customer_id = coalesce(new.customer_id, customer_id),
      first_response_at = coalesce(first_response_at, case when new.status <> 'new' then now() end),
      not_a_fit_reason = case when new.status = 'declined' then coalesce(not_a_fit_reason, 'other'::public.not_a_fit_reason) else not_a_fit_reason end,
      lost_reason = case when new.status = 'declined' then coalesce(new.decline_reason, lost_reason) else lost_reason end
    where id = new.lead_id;
  end if;
  return new;
end $$;
