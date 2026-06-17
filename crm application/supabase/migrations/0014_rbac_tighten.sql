-- ============================================================
-- RBAC tightening — restrict sales/finance reads to admin/dispatcher.
-- Technicians keep ops access (customers, jobs, schedule, field) and lose
-- visibility into invoices, estimates, and payments. Expenses are already
-- admin/dispatcher-only (expenses_admin, migration 0002). Customer sign pages
-- are unaffected (they use SECURITY DEFINER RPCs that bypass RLS).
-- STAGED: run at batch release.
-- ============================================================

drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated
  using (public.app_role() in ('admin','dispatcher'));

drop policy if exists invoice_items_read on public.invoice_items;
create policy invoice_items_read on public.invoice_items for select to authenticated
  using (public.app_role() in ('admin','dispatcher'));

drop policy if exists estimates_read on public.estimates;
create policy estimates_read on public.estimates for select to authenticated
  using (public.app_role() in ('admin','dispatcher'));

drop policy if exists estimate_items_read on public.estimate_items;
create policy estimate_items_read on public.estimate_items for select to authenticated
  using (public.app_role() in ('admin','dispatcher'));
