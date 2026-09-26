-- 0048 — Phase 6 historical cleanup (2026-09-26).
-- Runs AFTER 0041–0047. Two halves:
--   PART A (DRY RUN) is a SELECT that shows every row the cleanup would touch, before/after.
--   PART B (APPLY) is wrapped in a transaction and does the work; it is idempotent.
-- Items marked "OWNER CONFIRM" are left as commented statements — run them only after Mico confirms.

-- ===================================================================
-- PART A — DRY RUN (read only)
-- ===================================================================
with
draws(id, why) as (values
  ('b27ac783'::text, 'owner draw $390 9/8'), ('48eb4f74', 'owner draw $45 9/6'), ('fa3b867b', 'owner $25.92'),
  ('52cb4afc', 'owner $13.52 Schillinger'), ('2a154736', 'owner $45.58 Northern Wind'),
  ('aa7ed11d', 'Capital One $90 (Janiene)'), ('4a357d0b', 'Capital One $150 (Janiene)')),
personal(id, why) as (values
  ('b8f138a7'::text, 'Apple 9.99'), ('2abfed2c', 'Apple 3.17'), ('0b1f0729', 'Apple 9.99'), ('4b48a540', 'Apple 3.17'),
  ('751c0d25', 'Sonic'), ('3021d68e', 'Sonic'), ('5b58b99b', 'Major Tomato')),
reclass(id, new_cat, why) as (values
  ('2a5192e2'::text, 'dumpster_rental', 'W&D Dumpster $400'),
  ('28691edc', 'job_supplies', 'Home Depot Janiene $352.17'), ('f1d031c0', 'job_supplies', 'ice $16'),
  ('fc6817bb', 'crew_meals', 'Jimmy Johns $69.95'), ('bffd56ff', 'crew_meals', 'Samis $53.22')),
capital(id, asset_name, why) as (values
  ('74158331'::text, 'Trailer 6x12', 'trailer $927'), ('fa8c3d37', 'Trailer 6x12', 'trailer payment $200'), ('aea5b286', 'Trailer 6x12', 'trailer payment $200'),
  ('e77fe757', 'Sawzall', 'Sawzall $660.32'), ('4ac098e9', 'Hand tools', 'tools $27.43'), ('75f8d415', 'Hand tools', 'tools $45.41'))
select 'expense → owner_draw' as change, e.id, e.incurred_on, e.vendor, e.amount, e.category::text as before_cat, e.expense_class::text as before_class, 'owner_draw' as after_class, d.why
  from public.expenses e join draws d on left(e.id::text, 8) = d.id
union all
select 'expense → personal', e.id, e.incurred_on, e.vendor, e.amount, e.category::text, e.expense_class::text, 'personal', p.why
  from public.expenses e join personal p on left(e.id::text, 8) = p.id
union all
select 'expense recategorize', e.id, e.incurred_on, e.vendor, e.amount, e.category::text, e.expense_class::text, r.new_cat, r.why
  from public.expenses e join reclass r on left(e.id::text, 8) = r.id
union all
select 'expense → capital + asset', e.id, e.incurred_on, e.vendor, e.amount, e.category::text, e.expense_class::text, 'capital (' || c.asset_name || ')', c.why
  from public.expenses e join capital c on left(e.id::text, 8) = c.id
union all
select 'invoice #21 → is_test', i.id, i.issued_at::date, 'Justin Jackson', i.total, i.status::text, i.is_test::text, 'true', '$1 test invoice; job 8c97bb40 too'
  from public.invoices i where left(i.id::text, 8) = '1d420491'
union all
select 'jobs → job_kind internal', j.id, j.completed_on, j.title, j.final_price, j.job_kind::text, null, 'internal', 'internal customer 34d6ab7a (dump runs / shop)'
  from public.jobs j where left(j.customer_id::text, 8) = '34d6ab7a'
union all
select 'invoice #36 tip → invoice #35', i.id, i.paid_at::date, 'tip job 7b1db2c6', i.total, i.status::text, null, 'payment tip on 40ccce56; job cancelled', 'tip recorded as its own job'
  from public.invoices i where left(i.id::text, 8) = '1229f545'
union all
select 'legacy paid invoice, no payment row', i.id, i.paid_at::date, '#' || i.invoice_number, i.total, i.status::text, i.amount_paid::text, 'payment unknown_legacy + date_precision month', 'amount_paid 0 on a paid invoice'
  from public.invoices i where i.status = 'paid' and i.voided_at is null and i.deleted_at is null and coalesce(i.amount_paid, 0) = 0 and i.total > 0
    and not exists (select 1 from public.payments p where p.invoice_id = i.id)
union all
select 'job lead_source facebook_ad → meta_ads', j.id, j.completed_on, j.title, j.final_price, j.lead_source::text, null, 'meta_ads', 'Andrea Miller'
  from public.jobs j where left(j.id::text, 8) = 'b71bf033'
union all
select 'OWNER CONFIRM: job paid with $0 collected', j.id, j.completed_on, j.title, j.final_price, j.status::text, null, 'completed (or add the payment)', 'Michael Little 08896d67 / Lynn Steffensky dae0faeb'
  from public.jobs j where left(j.id::text, 8) in ('08896d67', 'dae0faeb')
union all
select 'OWNER CONFIRM: dump ticket not yet paid', e.id, e.incurred_on, e.vendor, e.amount, e.description, null, 'confirm paid; clear the note', 'Cervelli 7bde0f0a'
  from public.expenses e where left(e.id::text, 8) = '7bde0f0a'
union all
select 'OWNER CONFIRM: labor $15 vs payroll $40', e.id, e.incurred_on, e.vendor, e.amount, e.category::text, null, 'delete the $40 or fix the hours', 'Justin Mayes job 1bd613e1'
  from public.expenses e where left(e.id::text, 8) = '964d4a3d'
order by 1, 3;

-- ===================================================================
-- PART B — APPLY (idempotent). Run after reviewing PART A.
-- ===================================================================
begin;

-- Owner draws and personal spend: keep the rows, take them out of profit.
update public.expenses set category = 'owner_draw', expense_class = 'owner_draw', is_tax_deductible = false, job_id = null
  where left(id::text, 8) in ('b27ac783','48eb4f74','fa3b867b','52cb4afc','2a154736','aa7ed11d','4a357d0b') and expense_class is distinct from 'owner_draw';
update public.expenses set category = 'personal', expense_class = 'personal', is_tax_deductible = false, job_id = null
  where left(id::text, 8) in ('b8f138a7','2abfed2c','0b1f0729','4b48a540','751c0d25','3021d68e','5b58b99b') and expense_class is distinct from 'personal';

-- Small "equipment" that was really supplies / meals / a dumpster.
update public.expenses set category = 'dumpster_rental', expense_class = 'direct_job_cost' where left(id::text, 8) = '2a5192e2';
update public.expenses set category = 'job_supplies',    expense_class = 'direct_job_cost' where left(id::text, 8) in ('28691edc','f1d031c0');
update public.expenses set category = 'crew_meals',      expense_class = 'direct_job_cost' where left(id::text, 8) in ('fc6817bb','bffd56ff');

-- Capital: one asset row per thing, expenses point at it.
insert into public.assets (name, kind, acquired_on, cost, notes)
select v.name, v.kind, min(e.incurred_on), sum(e.amount), 'Created by 0048 cleanup'
from (values ('Trailer 6x12', 'trailer', array['74158331','fa8c3d37','aea5b286']), ('Sawzall', 'tool', array['e77fe757']), ('Hand tools', 'tool', array['4ac098e9','75f8d415'])) v(name, kind, ids)
join public.expenses e on left(e.id::text, 8) = any(v.ids)
where not exists (select 1 from public.assets a where a.name = v.name)
group by v.name, v.kind;
update public.expenses e set expense_class = 'capital', asset_id = a.id
from public.assets a
where a.name = case when left(e.id::text, 8) in ('74158331','fa8c3d37','aea5b286') then 'Trailer 6x12' when left(e.id::text, 8) = 'e77fe757' then 'Sawzall' when left(e.id::text, 8) in ('4ac098e9','75f8d415') then 'Hand tools' end
  and e.asset_id is null;

-- Test record: $1 invoice #21 + its job + customer stay, flagged out of every report.
update public.invoices set is_test = true where left(id::text, 8) = '1d420491';
update public.jobs set is_test = true where left(id::text, 8) = '8c97bb40';

-- Internal customer: jobs carry costs, never count as customer jobs.
update public.jobs set job_kind = 'internal' where left(customer_id::text, 8) = '34d6ab7a' and job_kind <> 'internal';

-- Tip that was booked as its own job (#36, $112.50) → tip on Nolan O'Connor's payment (#35).
do $$
declare v_pay uuid;
begin
  if exists (select 1 from public.invoices where left(id::text,8) = '1229f545' and status = 'paid' and not is_test) then
    select id into v_pay from public.payments where left(invoice_id::text, 8) = '40ccce56' order by paid_at limit 1;
    if v_pay is not null then
      update public.payments set tip = coalesce(tip, 0) + 112.50 where id = v_pay and coalesce(tip, 0) < 112.50;
    else
      insert into public.payments (invoice_id, amount, tip, method, kind, paid_at, reference)
      select id, 0, 112.50, 'unknown_legacy', 'payment', paid_at, '0048: tip moved from invoice #36' from public.invoices where left(id::text, 8) = '40ccce56';
    end if;
    update public.invoices set status = 'void', voided_at = now(), void_reason = 'Tip; moved onto invoice #35 by 0048' where left(id::text, 8) = '1229f545';
    update public.jobs set status = 'cancelled', cancel_reason = 'other', internal_notes = concat_ws(E'\n', internal_notes, 'Was a tip, not a job — see invoice #35 (0048)') where left(id::text, 8) = '7b1db2c6';
  end if;
end $$;

-- Legacy paid invoices with no payment row: one unknown_legacy payment dated paid_at, month precision.
insert into public.payments (invoice_id, amount, method, kind, paid_at, reference)
select i.id, i.total, 'unknown_legacy', 'payment', coalesce(i.paid_at, i.issued_at, i.created_at), '0048: legacy backfill'
from public.invoices i
where i.status = 'paid' and i.voided_at is null and i.deleted_at is null and coalesce(i.amount_paid, 0) = 0 and i.total > 0 and not i.is_test
  and not exists (select 1 from public.payments p where p.invoice_id = i.id);
update public.invoices i set date_precision = 'month'
  where exists (select 1 from public.payments p where p.invoice_id = i.id and p.reference = '0048: legacy backfill');
update public.jobs j set date_precision = 'month'
  where exists (select 1 from public.invoices i join public.payments p on p.invoice_id = i.id where i.job_id = j.id and p.reference = '0048: legacy backfill');

-- Lead source normalisation on the one job that had the old value.
update public.jobs set lead_source = 'meta_ads' where left(id::text, 8) = 'b71bf033' and lead_source::text = 'facebook_ad';

-- Quote #51 (Kimberly) was accepted but its job was cancelled → quote cancelled.
update public.estimates e set status = 'cancelled' from public.jobs j
  where j.id = e.job_id and e.status = 'accepted' and j.status = 'cancelled' and e.estimate_number = 51;

-- Andrea Miller: invoice #46 is paid, job still says invoiced → paid.
update public.jobs j set status = 'paid' from public.invoices i
  where i.job_id = j.id and i.status = 'paid' and j.status = 'invoiced' and left(j.id::text, 8) = 'b71bf033';

commit;

-- ===================================================================
-- OWNER CONFIRM — run individually once Mico answers.
-- ===================================================================
-- Michael Little (08896d67) and Lynn Steffensky (dae0faeb): paid with $0 collected.
--   Option 1 (they did pay, cash, amount unknown → record it):
--     insert into public.payments (invoice_id, amount, method, kind, paid_at, reference) select id, total, 'cash', 'payment', paid_at, 'owner confirmed 2026-09' from public.invoices where left(job_id::text,8) in ('08896d67','dae0faeb');
--   Option 2 (never paid): update public.invoices set status = 'sent', paid_at = null where left(job_id::text,8) in ('08896d67','dae0faeb'); update public.jobs set status = 'completed' where left(id::text,8) in ('08896d67','dae0faeb');
-- Cervelli dump ticket (7bde0f0a, $60 "NOT YET PAID"):
--     update public.expenses set description = regexp_replace(description, '\s*\(?NOT YET PAID\)?', '', 'i'), is_pending = false where left(id::text,8) = '7bde0f0a';
-- Justin Mayes job 1bd613e1: labor entry 25f36fae says $15, payroll expense 964d4a3d says $40.
--   If $40 is right: update public.labor_entries set hours = 40.0 / nullif(rate,0) where left(id::text,8) = '25f36fae'; then update public.expenses set deleted_at = now() where left(id::text,8) = '964d4a3d' and mark the labor entry paid (mark_hours_paid) so the expense regenerates.
--   If $15 is right: update public.expenses set deleted_at = now() where left(id::text,8) = '964d4a3d';
-- Capital One $350 on 7/16 and Goldobin $361.98 + $12.70 were not found by id — search: select id, incurred_on, vendor, amount from public.expenses where amount in (350, 361.98, 12.70) and deleted_at is null;
