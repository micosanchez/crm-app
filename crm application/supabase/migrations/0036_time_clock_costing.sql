-- 0036 Time clock → job costing (P0 #12).
-- A completed clock entry tied to a job automatically creates the matching
-- labor entry at the worker's CURRENT default rate (stamped, per the rate
-- rules), linked via labor_entries.time_entry_id so it can never be created
-- twice. Editing the clock entry re-syncs the unpaid labor entry; clearing
-- the clock-out, unlinking the job, or soft-deleting the entry removes the
-- unpaid auto entry. Paid labor entries are never touched.
--
-- The link between a login (users) and the payroll roster (workers) is
-- workers.user_id (added in 0034). No link = no auto-costing; hours can
-- still be logged manually with log_hours.

create or replace function public.sync_clock_to_labor() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  w record;
  hrs numeric;
  existing uuid;
begin
  if new.ended_at is not null and new.job_id is not null and new.deleted_at is null then
    select id, default_rate into w from public.workers
      where user_id = new.user_id and active and deleted_at is null
      limit 1;
    if found then
      hrs := round(extract(epoch from (new.ended_at - new.started_at)) / 3600.0, 2);
      if hrs > 0 then
        select id into existing from public.labor_entries where time_entry_id = new.id;
        if existing is null then
          insert into public.labor_entries (worker_id, worked_on, hours, rate, job_id, note, time_entry_id, created_by)
          values (w.id,
                  (new.started_at at time zone 'America/Detroit')::date,
                  hrs, w.default_rate, new.job_id, 'Auto from time clock', new.id, new.user_id);
        else
          update public.labor_entries
            set hours = hrs,
                job_id = new.job_id,
                worked_on = (new.started_at at time zone 'America/Detroit')::date
            where id = existing and paid_at is null;
        end if;
      end if;
    end if;
    return new;
  end if;

  -- Reopened, unlinked, or removed: drop the unpaid auto-created labor entry.
  if tg_op = 'UPDATE'
     and (new.ended_at is null or new.job_id is null or new.deleted_at is not null) then
    delete from public.labor_entries where time_entry_id = new.id and paid_at is null;
  end if;
  return new;
end $$;

drop trigger if exists time_entries_costing on public.time_entries;
create trigger time_entries_costing after insert or update on public.time_entries
  for each row execute function public.sync_clock_to_labor();

-- Link the one existing roster worker (Jeremiah) to his login if the names line up.
update public.workers w set user_id = u.id
from public.users u
where w.user_id is null
  and u.email = 'martinjeremiah99@gmail.com'
  and lower(w.name) like 'jeremiah%';
