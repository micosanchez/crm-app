-- 0053 — fix: the rentals audit trigger ran BEFORE INSERT and wrote rental_events for a row that did not exist yet
-- (FK violation on every new booking). updated_at stays in a BEFORE trigger; the event log moves to AFTER.
create or replace function public.rentals_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.rentals_audit() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.rental_events (rental_id, event, detail) values (new.id, 'created', jsonb_build_object('status', new.status, 'total', new.total));
  elsif new.status is distinct from old.status then
    insert into public.rental_events (rental_id, event, detail) values (new.id, 'status:' || new.status, jsonb_build_object('from', old.status));
  end if;
  return null;
end $$;

drop trigger if exists rentals_audit on public.rentals;
drop trigger if exists rentals_touch on public.rentals;
create trigger rentals_touch before insert or update on public.rentals for each row execute function public.rentals_touch();
create trigger rentals_audit after insert or update on public.rentals for each row execute function public.rentals_audit();

select tgname, tgtype from pg_trigger where tgrelid = 'public.rentals'::regclass and not tgisinternal;
