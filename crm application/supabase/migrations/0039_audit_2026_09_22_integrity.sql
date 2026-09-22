-- ============================================================
-- 0039 — Engineering audit 2026-09-22: integrity + security fixes
--
-- ADDITIVE / IDEMPOTENT. Safe to run on production in one go from the
-- Supabase SQL editor. Nothing here changes accounting methodology.
-- Each block says what was wrong and what it fixes. Rollback at the bottom.
--
-- Run BEFORE or WITH the matching code deploy. The code works without it;
-- it just keeps showing the symptoms this file removes.
-- ============================================================

-- ------------------------------------------------------------
-- A. SECURITY: activity_log leaked every financial row to technicians.
--    log_activity() stores full before/after snapshots of invoices, payments,
--    expenses, estimates… and activity_read was `using (true)`, so the 0035
--    lockdown that hid those tables from technicians could be bypassed with
--    one PostgREST call on activity_log. Staff only from now on.
-- ------------------------------------------------------------
drop policy if exists activity_read on public.activity_log;
create policy activity_read on public.activity_log for select to authenticated
  using (public.is_staff());

-- ------------------------------------------------------------
-- B. SECURITY: price book and recurring plans were writable by any login
--    (using(true) from 0011/0012). Their pages are staff-only; the tables
--    now agree. Reads stay open so nothing in the app changes.
-- ------------------------------------------------------------
drop policy if exists service_items_all on public.service_items;
drop policy if exists service_items_read on public.service_items;
drop policy if exists service_items_write on public.service_items;
create policy service_items_read on public.service_items for select to authenticated using (true);
create policy service_items_write on public.service_items for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists job_recurrence_all on public.job_recurrence;
drop policy if exists job_recurrence_read on public.job_recurrence;
drop policy if exists job_recurrence_write on public.job_recurrence;
create policy job_recurrence_read on public.job_recurrence for select to authenticated using (true);
create policy job_recurrence_write on public.job_recurrence for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ------------------------------------------------------------
-- C. INTEGRITY REGRESSION: signing an estimate stopped archiving a snapshot.
--    0019 added `perform public.snapshot_estimate(...)` to sign_estimate().
--    0029_fix (2026-08-25) and 0032 each rewrote the whole function from an
--    older copy and dropped that line, so the "Signatures" archive has not
--    received a signed ESTIMATE since. (Invoices were unaffected.)
--    Also: snapshot_estimate() only knew legacy estimate_items; composer
--    quotes keep their one line in estimates.line_item/description, so their
--    snapshots had an empty items list. Fixed to mirror estimate_by_token.
--    This version keeps 0029_fix's ::job_status cast and 0032's job fields.
-- ------------------------------------------------------------
create or replace function public.snapshot_estimate(p_id uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.document_snapshots
    (kind, source_id, doc_number, customer_name, customer_address, total, signed_name, signed_at, signature_data, payload)
  select 'estimate', e.id, e.estimate_number, c.name,
    public.full_customer_address(c.address, c.city, c.state, c.postal_code),
    e.total, e.signed_name, e.signed_at, e.signature_data,
    jsonb_build_object(
      'created_at', e.created_at, 'valid_until', e.valid_until,
      'payment_instructions', coalesce(e.payment_terms, e.payment_instructions),
      'comments', coalesce(e.additional_terms, e.comments),
      'items', case
        when e.line_item is not null then
          jsonb_build_array(jsonb_build_object(
            'description', e.line_item, 'details', e.description,
            'quantity', 1, 'unit_price', e.total, 'amount', e.total))
        else coalesce((select jsonb_agg(jsonb_build_object(
            'description', i.description, 'details', i.details, 'quantity', i.quantity,
            'unit_price', i.unit_price, 'amount', i.amount))
          from public.estimate_items i where i.estimate_id = e.id), '[]'::jsonb)
      end)
  from public.estimates e
  left join public.customers c on c.id = e.customer_id
  where e.id = p_id and e.signed_at is not null
    and not exists (select 1 from public.document_snapshots s where s.kind = 'estimate' and s.source_id = e.id);
end;
$fn$;

create or replace function public.sign_estimate(p_token uuid, p_name text, p_signature text)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare
  v_est public.estimates%rowtype;
  v_job_id uuid;
  v_title text;
begin
  select * into v_est from public.estimates
    where public_token = p_token and signed_at is null and deleted_at is null;
  if not found then
    return false;
  end if;

  update public.estimates
    set signed_name = p_name, signature_data = p_signature, signed_at = now(),
        status = 'accepted', accepted_at = coalesce(accepted_at, now())
    where id = v_est.id;

  -- The immutable copy the Signatures screen shows (restored — see header).
  perform public.snapshot_estimate(v_est.id);

  if v_est.job_id is null and v_est.customer_id is not null then
    v_title := coalesce(
      nullif(btrim(v_est.line_item), ''),
      (select i.description from public.estimate_items i
        where i.estimate_id = v_est.id order by i.amount desc nulls last limit 1),
      'Estimate #' || v_est.estimate_number || ' job'
    );

    insert into public.jobs (customer_id, title, status, estimated_value, address, scheduled_start)
    select v_est.customer_id, v_title,
           (case when v_est.scheduled_start is not null then 'scheduled' else 'lead' end)::public.job_status,
           v_est.total, c.address, v_est.scheduled_start
    from public.customers c where c.id = v_est.customer_id
    returning id into v_job_id;

    update public.estimates set job_id = v_job_id where id = v_est.id;
  end if;

  return true;
end;
$fn$;

-- Backfill the archive for estimates signed while the call was missing.
do $$
declare r record;
begin
  for r in select id from public.estimates where signed_at is not null
    and not exists (select 1 from public.document_snapshots s where s.kind = 'estimate' and s.source_id = estimates.id)
  loop
    perform public.snapshot_estimate(r.id);
  end loop;
end $$;

-- ------------------------------------------------------------
-- D. CUSTOMER-FACING REGRESSION: the token RPCs lost fields the sign page reads.
--    0019 returned signature_data (both) and amount_paid (invoice); 0027–0031
--    rewrote the functions from older copies without them. Effects: a signed
--    document shows a typed name instead of the drawn signature, and a
--    partially-paid invoice's Pay button shows the full total instead of the
--    balance (checkout itself was always right — invoice_payment_info).
--    These are the 0031/0028 bodies with the two keys added back. Additive.
-- ------------------------------------------------------------
create or replace function public.estimate_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare result jsonb;
begin
  update public.estimates set viewed_at = coalesce(viewed_at, now()), view_count = view_count + 1
    where public_token = p_token;
  select jsonb_build_object(
    'kind','estimate','number', e.estimate_number,'status', e.status,
    'total', e.total,'created_at', e.created_at,'valid_until', e.valid_until,
    'signed_name', e.signed_name,'signed_at', e.signed_at,'signature_data', e.signature_data,
    'customer_name', c.name,
    'customer_address', public.full_customer_address(c.address, c.city, c.state, c.postal_code),
    'payment_instructions', coalesce(e.payment_terms, e.payment_instructions, bs.default_payment_terms),
    'comments', coalesce(e.additional_terms, e.comments, bs.default_additional_terms),
    'view_count', e.view_count,
    'biz', (select jsonb_build_object(
        'name', business_name,'tagline', tagline,'phone', phone,'email', email,
        'website', website,'area', service_area,'licensed_insured', licensed_insured,'ein', ein)
      from public.business_settings where id),
    'items', case
      when e.line_item is not null then
        jsonb_build_array(jsonb_build_object(
          'description', e.line_item, 'details', e.description,
          'quantity', 1, 'unit_price', e.total, 'amount', e.total))
      else coalesce((select jsonb_agg(jsonb_build_object(
          'description', case when position(' || ' in i.description) > 0
                              then btrim(split_part(i.description, ' || ', 1)) else i.description end,
          'details', case when position(' || ' in i.description) > 0
                          then coalesce(i.details, btrim(substr(i.description, position(' || ' in i.description) + 4)))
                          else i.details end,
          'quantity', i.quantity,'unit_price', i.unit_price,'amount', i.amount))
        from public.estimate_items i where i.estimate_id = e.id), '[]'::jsonb)
    end
  ) into result
  from public.estimates e
  left join public.customers c on c.id = e.customer_id
  left join public.business_settings bs on bs.id
  where e.public_token = p_token and e.deleted_at is null;
  return result;
end;
$fn$;

create or replace function public.invoice_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare result jsonb;
begin
  update public.invoices set viewed_at = coalesce(viewed_at, now()), view_count = view_count + 1
    where public_token = p_token;
  select jsonb_build_object(
    'kind','invoice','number', v.invoice_number,'status', v.status,
    'total', v.total,'tip', v.tip,'amount_paid', v.amount_paid,
    'created_at', v.created_at,'due_at', v.due_at,
    'signed_name', v.signed_name,'signed_at', v.signed_at,'signature_data', v.signature_data,
    'customer_name', c.name,
    'customer_address', public.full_customer_address(c.address, c.city, c.state, c.postal_code),
    'payment_instructions', v.payment_instructions,'comments', v.comments,
    'view_count', v.view_count,
    'biz', (select jsonb_build_object(
        'name', business_name,'tagline', tagline,'phone', phone,'email', email,
        'website', website,'area', service_area,'licensed_insured', licensed_insured,'ein', ein)
      from public.business_settings where id),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'description', i.description,'details', i.details,'quantity', i.quantity,
        'unit_price', i.unit_price,'amount', i.amount))
      from public.invoice_items i where i.invoice_id = v.id), '[]'::jsonb)
  ) into result
  from public.invoices v left join public.customers c on c.id = v.customer_id
  where v.public_token = p_token and v.deleted_at is null;
  return result;
end;
$fn$;

-- ------------------------------------------------------------
-- E. FINANCE: job_profitability counted VOIDED paid invoices as revenue.
--    Every other revenue number in the app excludes voided invoices; the view
--    (0002) predates voiding (0034). Same formula otherwise — revenue is still
--    paid invoices, costs are still job-linked expenses. (Labor is a separate,
--    owner decision: see 0040.)
-- ------------------------------------------------------------
create or replace view public.job_profitability with (security_invoker = true) as
select
  j.id as job_id,
  j.title,
  j.service,
  j.customer_id,
  j.status,
  coalesce(rev.revenue, 0) as revenue,
  coalesce(cost.costs, 0) as costs,
  coalesce(rev.revenue, 0) - coalesce(cost.costs, 0) as profit
from public.jobs j
left join lateral (
  select sum(total) as revenue from public.invoices
  where job_id = j.id and status = 'paid' and voided_at is null and deleted_at is null
) rev on true
left join lateral (
  select sum(amount) as costs from public.expenses where job_id = j.id and deleted_at is null
) cost on true
where j.deleted_at is null;

-- ------------------------------------------------------------
-- F. PERFORMANCE: the technician RPCs (tech_my_jobs / tech_job / tech_update_job)
--    and the crew run-sheet look up assignments by user; the PK is (job_id, user_id)
--    so user-first lookups had no index.
-- ------------------------------------------------------------
create index if not exists idx_job_assignments_user_id on public.job_assignments (user_id);
create index if not exists idx_payments_invoice_id on public.payments (invoice_id);
create index if not exists idx_activity_log_entity on public.activity_log (entity_id, created_at desc);

-- ============================================================
-- ROLLBACK (only if something misbehaves)
-- ============================================================
-- A: drop policy activity_read on public.activity_log;
--    create policy activity_read on public.activity_log for select to authenticated using (true);
-- B: recreate the *_all policies from 0011 / 0012.
-- C/D: re-run the function bodies from 0032 (sign_estimate), 0031 (estimate_by_token), 0028 (invoice_by_token).
-- E: re-run the view from 0002.
-- F: drop index if exists idx_job_assignments_user_id, idx_payments_invoice_id, idx_activity_log_entity;
