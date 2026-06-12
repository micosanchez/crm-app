-- ============================================================
-- SJHC fix: customer signing an estimate must auto-create the job
-- (previously only in-app acceptance created it)
-- ============================================================

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

  -- Auto-create the job (same as in-app acceptance)
  if v_est.job_id is null and v_est.customer_id is not null then
    select coalesce(
      (select i.description from public.estimate_items i
        where i.estimate_id = v_est.id order by i.amount desc nulls last limit 1),
      'Estimate #' || v_est.estimate_number || ' job'
    ) into v_title;

    insert into public.jobs (customer_id, title, status, estimated_value, address)
    select v_est.customer_id, v_title, 'lead', v_est.total, c.address
    from public.customers c where c.id = v_est.customer_id
    returning id into v_job_id;

    update public.estimates set job_id = v_job_id where id = v_est.id;
  end if;

  return true;
end;
$fn$;

-- Backfill: create jobs for estimates already signed without one
do $$
declare r record; v_job_id uuid; v_title text;
begin
  for r in
    select e.* from public.estimates e
    where e.signed_at is not null and e.job_id is null and e.customer_id is not null
  loop
    select coalesce(
      (select i.description from public.estimate_items i
        where i.estimate_id = r.id order by i.amount desc nulls last limit 1),
      'Estimate #' || r.estimate_number || ' job'
    ) into v_title;

    insert into public.jobs (customer_id, title, status, estimated_value, address)
    select r.customer_id, v_title, 'lead', r.total, c.address
    from public.customers c where c.id = r.customer_id
    returning id into v_job_id;

    update public.estimates set job_id = v_job_id where id = r.id;
  end loop;
end $$;
