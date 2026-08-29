-- 0037 Technician job updates without jobs SELECT access.
-- Postgres applies SELECT policies to any UPDATE whose WHERE references the
-- row (which is every UPDATE the app makes), so removing technicians' SELECT
-- on jobs (0035) also silenced their Field-screen status changes and photo
-- uploads. This SECURITY DEFINER RPC is the sanctioned narrow path: an
-- assigned technician may change status (field statuses only) and photos —
-- nothing else, and never money.

create or replace function public.tech_update_job(p_job_id uuid, p_patch jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_status public.job_status;
  v_allowed boolean;
begin
  v_allowed := public.is_staff() or exists (
    select 1 from public.job_assignments a
    where a.job_id = p_job_id and a.user_id = auth.uid());
  if not v_allowed then
    raise exception 'You are not assigned to this job.';
  end if;

  if p_patch ? 'status' then
    v_status := (p_patch->>'status')::public.job_status;
    if not public.is_staff() and v_status not in ('scheduled','in_progress','completed') then
      raise exception 'Technicians can only move a job between scheduled, in progress, and completed.';
    end if;
  end if;

  update public.jobs set
    status = coalesce(v_status, status),
    photos = case when p_patch ? 'photos' then p_patch->'photos' else photos end
  where id = p_job_id and deleted_at is null;
  return found;
end $$;
grant execute on function public.tech_update_job(uuid, jsonb) to authenticated;
