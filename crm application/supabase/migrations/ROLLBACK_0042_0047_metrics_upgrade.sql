-- ROLLBACK for the 2026-09-26 metrics upgrade (0042–0047). Run only to fully revert.
-- 0041 enum values cannot be dropped in Postgres; they are harmless left in place.
-- Dropping the added columns DELETES the data captured in them — export first if in doubt.
-- Afterwards re-run the pre-existing definitions this batch replaced:
--   job_profitability view (0033), sign_estimate (0035), the invoice amount_paid trigger (0010).
begin;
-- triggers
drop trigger if exists accounts_crm_touch on public.accounts_crm;
drop trigger if exists customers_normalize on public.customers;
drop trigger if exists dump_tickets_expense on public.dump_tickets;
drop trigger if exists estimate_requests_status_to_lead on public.estimate_requests;
drop trigger if exists estimate_requests_to_lead on public.estimate_requests;
drop trigger if exists estimates_linked_to_job on public.estimates;
drop trigger if exists estimates_outcome_rules on public.estimates;
drop trigger if exists estimates_status_to_lead on public.estimates;
drop trigger if exists expenses_block_double_payroll on public.expenses;
drop trigger if exists expenses_classify on public.expenses;
drop trigger if exists expenses_default_campaign on public.expenses;
drop trigger if exists invoices_amount_paid_derived on public.invoices;
drop trigger if exists jobs_block_paid_without_money on public.jobs;
drop trigger if exists jobs_cancel_cascade on public.jobs;
drop trigger if exists jobs_completed_auto_invoice on public.jobs;
drop trigger if exists jobs_derive_cy on public.jobs;
drop trigger if exists jobs_reopened_invoice_sync on public.jobs;
drop trigger if exists jobs_require_fields on public.jobs;
drop trigger if exists labor_entries_paid_expense on public.labor_entries;
drop trigger if exists payments_fee_expense on public.payments;
-- views
drop view if exists public.customer_stats;
drop view if exists public.job_dump_cost;
drop view if exists public.real_jobs;
drop view if exists public.job_profitability;
-- functions
drop function if exists public.allocate_dump_ticket;
drop function if exists public.channel_roi;
drop function if exists public.customer_metrics;
drop function if exists public.customers_normalize;
drop function if exists public.data_health_check;
drop function if exists public.default_expense_class;
drop function if exists public.detroit_today;
drop function if exists public.dump_ticket_expense;
drop function if exists public.estimate_linked_to_job;
drop function if exists public.estimate_request_status_to_lead;
drop function if exists public.estimate_request_to_lead;
drop function if exists public.estimate_status_to_lead;
drop function if exists public.estimates_outcome_rules;
drop function if exists public.expenses_block_double_payroll;
drop function if exists public.expenses_classify;
drop function if exists public.expenses_default_campaign;
drop function if exists public.full_time_readiness;
drop function if exists public.invoices_amount_paid_derived;
drop function if exists public.is_lead_source;
drop function if exists public.job_close_out;
drop function if exists public.job_completed_auto_invoice;
drop function if exists public.job_reopened_invoice_sync;
drop function if exists public.jobs_block_paid_without_money;
drop function if exists public.jobs_cancel_cascade;
drop function if exists public.jobs_derive_cy;
drop function if exists public.jobs_require_fields;
drop function if exists public.labor_paid_to_expense;
drop function if exists public.log_dump_ticket;
drop function if exists public.log_owner_time;
drop function if exists public.mark_lead_responded;
drop function if exists public.monthly_close;
drop function if exists public.owner_hourly;
drop function if exists public.owner_hours;
drop function if exists public.payment_fee_to_expense;
drop function if exists public.pct;
drop function if exists public.pipeline_report;
drop function if exists public.pnl_report;
drop function if exists public.quote_win_rate;
drop function if exists public.r2;
drop function if exists public.service_line_profitability;
drop function if exists public.setting_num;
drop function if exists public.suggest_service_type;
drop function if exists public.to_e164;
drop function if exists public.unit_economics;
drop function if exists public.upsert_lead_from_message;
drop function if exists public.vehicle_cost;
drop function if exists public.weekly_scorecard;
-- tables
drop table if exists public.dump_ticket_allocations cascade;
drop table if exists public.dump_tickets cascade;
drop table if exists public.disposal_sites cascade;
drop table if exists public.marketing_daily_spend cascade;
drop table if exists public.referrals cascade;
drop table if exists public.review_snapshots cascade;
drop table if exists public.monthly_snapshots cascade;
drop table if exists public.integration_runs cascade;
drop table if exists public.job_photos cascade;
drop table if exists public.mileage_log cascade;
drop table if exists public.assets cascade;
drop table if exists public.marketing_campaigns cascade;
drop table if exists public.accounts_crm cascade;
drop table if exists public.app_settings cascade;
-- columns
alter table public.bank_transactions drop column if exists matched_expense_id, drop column if exists matched_payment_id;
alter table public.customers drop column if exists account_id, drop column if exists campaign_id, drop column if exists do_not_contact, drop column if exists is_test, drop column if exists lead_source_detail, drop column if exists phone_e164, drop column if exists referral_code, drop column if exists referral_credit_balance, drop column if exists referred_by_customer_id, drop column if exists segment;
alter table public.estimate_requests drop column if exists heard_about_us, drop column if exists lead_id, drop column if exists utm_campaign, drop column if exists utm_medium, drop column if exists utm_source;
alter table public.estimates drop column if exists accepted_option, drop column if exists access_flags, drop column if exists account_id, drop column if exists competitor_name, drop column if exists competitor_price, drop column if exists crew_size, drop column if exists date_precision, drop column if exists decided_at, drop column if exists deposit_amount, drop column if exists deposit_required, drop column if exists est_cubic_yards, drop column if exists est_weight_lbs, drop column if exists follow_up_count, drop column if exists hauling_unit, drop column if exists heavy_item_count, drop column if exists is_test, drop column if exists last_follow_up_at, drop column if exists lead_id, drop column if exists load_fraction, drop column if exists loss_reason, drop column if exists mattress_count, drop column if exists next_follow_up_at, drop column if exists options, drop column if exists quote_size_bucket, drop column if exists sent_at, drop column if exists service_type;
alter table public.expenses drop column if exists asset_id, drop column if exists bank_txn_ref, drop column if exists campaign_id, drop column if exists expense_class, drop column if exists external_id, drop column if exists external_source, drop column if exists is_pending, drop column if exists is_tax_deductible, drop column if exists labor_entry_id, drop column if exists override_reason;
alter table public.invoices drop column if exists is_test, drop column if exists date_precision, drop column if exists internal_notes;
alter table public.jobs drop column if exists access_flags, drop column if exists box_spring_count, drop column if exists calendar_event_id, drop column if exists campaign_id, drop column if exists cancel_reason, drop column if exists cancelled_at, drop column if exists crew_size, drop column if exists disposed_at, drop column if exists est_cubic_yards, drop column if exists est_weight_lbs, drop column if exists hauling_unit, drop column if exists heavy_item_count, drop column if exists lead_source_detail, drop column if exists load_fraction, drop column if exists mattress_count, drop column if exists on_site_minutes, drop column if exists picked_up_at, drop column if exists quoted_price, drop column if exists referred_by_customer_id, drop column if exists review_platform, drop column if exists review_rating, drop column if exists review_received, drop column if exists review_requested_at, drop column if exists review_url, drop column if exists secondary_service_types, drop column if exists service_type, drop column if exists staged, drop column if exists is_test, drop column if exists job_kind, drop column if exists date_precision, drop column if exists internal_notes;
alter table public.labor_entries drop column if exists activity;
alter table public.leads drop column if exists campaign_id, drop column if exists channel_in, drop column if exists deleted_at, drop column if exists estimate_request_id, drop column if exists external_id, drop column if exists external_source, drop column if exists first_response_at, drop column if exists inbound_count, drop column if exists is_test, drop column if exists last_contact_at, drop column if exists lead_source_detail, drop column if exists lost_reason, drop column if exists not_a_fit_reason, drop column if exists outbound_count, drop column if exists quote_id, drop column if exists referred_by_customer_id, drop column if exists utm_campaign, drop column if exists utm_medium, drop column if exists utm_source;
alter table public.payments drop column if exists external_id, drop column if exists external_source, drop column if exists processing_fee, drop column if exists is_test;
alter table public.workers drop column if exists is_owner, drop column if exists target_hourly_value;
commit;
