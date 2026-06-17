-- ============================================================
-- ROLLBACK for the staged batch (0010 payments, 0011 price book, 0012 recurring).
-- Run only to fully revert. Safe order: dependents first.
-- ============================================================
drop function if exists public.generate_due_recurring_jobs();
drop table if exists public.job_recurrence cascade;

drop table if exists public.service_items cascade;

drop trigger if exists payments_recompute on public.payments;
drop trigger if exists payments_log on public.payments;
drop function if exists public.recompute_invoice_paid();
drop table if exists public.payments cascade;
alter table public.invoices drop column if exists amount_paid;

-- 0013 time entries
drop table if exists public.time_entries cascade;

-- 0014 RBAC — restore the prior open read policies
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated using (true);
drop policy if exists invoice_items_read on public.invoice_items;
create policy invoice_items_read on public.invoice_items for select to authenticated using (true);
drop policy if exists estimates_read on public.estimates;
create policy estimates_read on public.estimates for select to authenticated using (true);
drop policy if exists estimate_items_read on public.estimate_items;
create policy estimate_items_read on public.estimate_items for select to authenticated using (true);

-- Optional pg_cron cleanup:
-- select cron.unschedule('recurring-jobs');
