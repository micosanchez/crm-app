0032_schedule_to_job.sql-- 0032 Issue 6 (DB side): an estimate's scheduled_start must reach the job.
-- Two paths create/own the job:
--   (a) customer signs -> sign_estimate() [0008]  -> patched here to carry the
--       schedule + a clean title (was using the raw "title || paragraph" item).
--   (b) connector marks accepted (Worker creates/links the job) -> a trigger keeps
--       the linked job's scheduled_start in sync with the estimate, and promotes a
--       'lead' job to 'scheduled' once it has a time. The trigger only ENRICHES an
--       existing linked job — it never creates one, so it can't double-create.
-- (Adding scheduled_start as an INPUT to create_quote is a connector/Worker change,
--  out of scope here.)

-- ---------- (a) sign path ----------
create or replace function public.sign_estimate(p_token uuid, p_name text, p_signature text)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare
  v_est public.estimates%rowtype;
  v_job_id uuid;
  v_title text;
begin
  select * into v_est from public.estimates
    where public_token = p_token and signed_at is null;
  if not found then
    return false;
  end if;

  update public.estimates
    set signed_name = p_name, signature_data = p_signature, signed_at = now(),
        status = 'accepted', accepted_at = coalesce(accepted_at, now())
    where id = v_est.id;

  if v_est.job_id is null and v_est.customer_id is not null then
    -- Clean title: prefer the first-class line_item, then the item, then a fallback.
    v_title := coalesce(
      nullif(btrim(v_est.line_item), ''),
      (select i.description from public.estimate_items i
        where i.estimate_id = v_est.id order by i.amount desc nulls last limit 1),
      'Estimate #' || v_est.estimate_number || ' job'
    );

    insert into public.jobs (customer_id, title, status, estimated_value, address, scheduled_start)
    select v_est.customer_id, v_title,
           case when v_est.scheduled_start is not null then 'scheduled' else 'lead' end,
           v_est.total, c.address, v_est.scheduled_start
    from public.customers c where c.id = v_est.customer_id
    returning id into v_job_id;

    update public.estimates set job_id = v_job_id where id = v_est.id;
  end if;

  return true;
end;
$fn$;

-- ---------- (b) accept path: keep the linked job's schedule in sync ----------
create or replace function public.sync_estimate_schedule_to_job() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.job_id is not null and new.scheduled_start is not null
     and (new.scheduled_start is distinct from old.scheduled_start
          or new.job_id is distinct from old.job_id) then
    update public.jobs
      set scheduled_start = new.scheduled_start,
          status = case when status = 'lead' then 'scheduled' else status end
      where id = new.job_id
        and (scheduled_start is distinct from new.scheduled_start or status = 'lead');
  end if;
  return new;
end;
$fn$;

drop trigger if exists estimates_sync_schedule on public.estimates;
create trigger estimates_sync_schedule after update on public.estimates
  for each row execute function public.sync_estimate_schedule_to_job();
