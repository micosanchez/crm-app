// src/tools/metrics.ts — business-metrics upgrade (2026-09-26).
// Every report is a Postgres function (migration 0046); these tools are thin
// wrappers so the numbers are identical in the app, in SQL and over MCP.
var DATE3 = external_exports.string().regex(/^\d{4}-\d{2}-\d{2}$/);
var LABOR_ACTIVITIES = ["on_job", "drive", "dump_run", "site_visit_quote", "quoting_admin", "marketing", "bookkeeping", "other"];
var SERVICE_TYPES = ["single_item", "furniture", "appliance", "mattress", "hot_tub", "garage_cleanout", "basement_cleanout", "estate_cleanout", "whole_home_cleanout", "yard_waste", "construction_debris", "demo", "commercial_cleanout", "property_turnover", "other"];
var HAULING_UNITS = ["truck_bed", "trailer_6x12", "dumpster", "multiple"];
var ACCESS_FLAGS = ["stairs", "basement", "long_carry", "tight_access", "second_floor", "no_driveway_access"];
var DUMP_MATERIALS = ["mixed_junk", "yard_waste", "concrete_brick", "metal", "mattresses", "tires", "other"];
var LEAD_SOURCES_V2 = ["google_business_profile", "google_search_organic", "google_ads", "website_direct", "facebook_organic_page", "facebook_group_post", "meta_ads", "facebook_marketplace", "instagram", "nextdoor", "referral", "repeat_customer", "commercial_account", "truck_trailer_signage", "yard_sign_flyer", "other", "unknown", "google", "facebook", "yard_sign", "website"];
var LEAD_CHANNELS = ["phone_call", "text", "web_form", "facebook_dm", "instagram_dm", "marketplace", "email", "in_person", "referral_intro"];
var LEAD_STATUSES2 = ["new", "contacted", "quoted", "booked", "lost", "spam", "not_a_fit"];
var LOSS_REASONS = ["price_too_high", "went_with_competitor", "did_it_themselves", "city_bulk_pickup", "timing_scheduling", "scope_changed", "no_response_ghosted", "hazmat_or_out_of_scope", "deposit_required", "other"];
var ACCOUNT_KINDS = ["property_manager", "landlord", "realtor", "apartment_complex", "business", "nonprofit_league", "contractor", "other"];
var ACCOUNT_STAGES = ["prospect", "contacted", "meeting", "trial_job", "active", "inactive"];
var CADENCES = ["none", "weekly", "biweekly", "monthly", "per_turnover"];
var REVIEW_PLATFORMS = ["google", "facebook", "nextdoor", "yelp"];

async function rpc(dbc, fn, args) {
  const { data, error } = await dbc.rpc(fn, args ?? {});
  if (error) return fail("db_error", `${fn}: ${error.message}`);
  return ok(data);
}
__name(rpc, "rpc");

function registerMetricsTools(server, dbc, env) {
  // ---------------- reports ----------------
  const range = { from: DATE3.optional().describe("Start date, YYYY-MM-DD (Detroit)"), to: DATE3.optional().describe("End date, YYYY-MM-DD (Detroit)") };
  server.registerTool("pnl_report", {
    title: "P&L report",
    description: "Cash-basis profit & loss by month (or one 'all' block): job revenue, tips (separate), direct job costs by category, gross profit and %, overhead, operating profit and %, capex, owner draws, personal (memo, excluded), vehicle cost, profit after vehicle, owner hours and owner $/hr. Partial months are flagged with a pace projection. Excludes test records and internal jobs. Defaults to this month.",
    inputSchema: { ...range, group_by: external_exports.enum(["month", "all"]).default("month") }, annotations: { readOnlyHint: true }
  }, guarded((a) => rpc(dbc, "pnl_report", { p_from: a.from ?? null, p_to: a.to ?? null, p_group_by: a.group_by ?? "month" })));

  server.registerTool("unit_economics", {
    title: "Unit economics per job",
    description: "Per real job in the window: revenue mean and MEDIAN, allocated disposal, helper labor, marketing, gross/operating profit per job, revenue per labor hour, and owner earnings per owner hour vs the target. Also counts jobs missing owner hours or disposal data (those understate costs).",
    inputSchema: range, annotations: { readOnlyHint: true }
  }, guarded((a) => rpc(dbc, "unit_economics", { p_from: a.from ?? null, p_to: a.to ?? null })));

  server.registerTool("owner_hourly", {
    title: "Owner earnings per hour",
    description: "Owner hours by activity, operating profit ÷ owner hours (before and after vehicle cost), share of hours that were billable, and the share of jobs with owner hours logged. Defaults to the last 90 days. If hours aren't logged this is meaningless — check jobs_with_owner_hours_pct first.",
    inputSchema: range, annotations: { readOnlyHint: true }
  }, guarded((a) => rpc(dbc, "owner_hourly", { p_from: a.from ?? null, p_to: a.to ?? null })));

  server.registerTool("quote_win_rate", {
    title: "Quote win rate",
    description: "Win rate by count and by dollar value, grouped by quote size bucket (<250, 250-499, 500-999, 1000-2499, 2500+), service type, lead source, month, deposit vs none, or single vs two-option quotes. Includes lost value and the top loss reasons, and how many losses have no reason recorded.",
    inputSchema: { ...range, by: external_exports.enum(["size_bucket", "service_type", "lead_source", "month", "deposit", "options"]).default("size_bucket") }, annotations: { readOnlyHint: true }
  }, guarded((a) => rpc(dbc, "quote_win_rate", { p_from: a.from ?? null, p_to: a.to ?? null, p_by: a.by ?? "size_bucket" })));

  server.registerTool("channel_roi", {
    title: "Marketing channel ROI",
    description: "Per lead source: leads, quotes, booked jobs, lead→job %, revenue, gross profit, spend, cost per lead, cost per booked job, ROAS and gross profit per $1 spent. Spend comes from marketing expenses via their campaign's channel (unmatched Meta charges sit on 'Meta — unassigned'). Shows the % of jobs with unknown source.",
    inputSchema: range, annotations: { readOnlyHint: true }
  }, guarded((a) => rpc(dbc, "channel_roi", { p_from: a.from ?? null, p_to: a.to ?? null })));

  server.registerTool("service_line_profitability", {
    title: "Profit by service type",
    description: "By service_type: jobs, revenue, average and median ticket, allocated costs, margin %, labor hours and revenue per labor hour.",
    inputSchema: range, annotations: { readOnlyHint: true }
  }, guarded((a) => rpc(dbc, "service_line_profitability", { p_from: a.from ?? null, p_to: a.to ?? null })));

  server.registerTool("customer_metrics", {
    title: "Customer metrics",
    description: "Unique customers, repeat rate, referral rate, segment mix, commercial %, recurring %, top customers, monthly revenue concentration (largest job's share), and customers due for reactivation.",
    inputSchema: range, annotations: { readOnlyHint: true }
  }, guarded((a) => rpc(dbc, "customer_metrics", { p_from: a.from ?? null, p_to: a.to ?? null })));

  server.registerTool("pipeline_report", {
    title: "Pipeline",
    description: "Open leads (with speed-to-lead), leaking leads (no quote after 48h), open quotes with value/age/next follow-up, quotes expiring within 3 days, and completed jobs still waiting on an invoice or payment.",
    inputSchema: {}, annotations: { readOnlyHint: true }
  }, guarded(() => rpc(dbc, "pipeline_report", {})));

  server.registerTool("data_health_check", {
    title: "Data health check",
    description: "Every integrity problem in the CRM with a record id and a suggested fix: paid jobs without payments/invoices, amount_paid mismatches, jobs missing lead source / service type / owner hours / dump allocation, quotes decided without a reason, accepted quotes on cancelled jobs, duplicate customers or expenses, payroll without labor entries, small equipment purchases, capital without an asset, unpaid dump tickets, test-looking records, leaking leads, stale integrations. Run before monthly_close and after a catch-up session.",
    inputSchema: {}, annotations: { readOnlyHint: true }
  }, guarded(() => rpc(dbc, "data_health_check", {})));

  server.registerTool("weekly_scorecard", {
    title: "Weekly scorecard",
    description: "For the week containing the date (Mon–Sun): quotes sent, won/lost by size, jobs completed, revenue collected, owner hours, median speed-to-lead, leads in, open pipeline $, ad spend.",
    inputSchema: { week: DATE3.optional().describe("Any date in the week; defaults to this week") }, annotations: { readOnlyHint: true }
  }, guarded((a) => rpc(dbc, "weekly_scorecard", { p_week: a.week ?? null })));

  server.registerTool("monthly_close", {
    title: "Close a month",
    description: "Runs data_health_check; if there are no critical issues (or override is true) writes a LOCKED snapshot of every KPI for the month to monthly_snapshots so history doesn't shift when old records are edited. Refuses to close a month twice.",
    inputSchema: { month: DATE3.describe("Any date in the month to close"), override: external_exports.boolean().default(false).describe("Close even with critical health issues") }
  }, guarded((a) => rpc(dbc, "monthly_close", { p_month: a.month, p_override: a.override ?? false })));

  server.registerTool("full_time_readiness", {
    title: "Full-time readiness",
    description: "Trailing-6-month pass/fail on the thresholds in app_settings.ft_thresholds: profit vs required income ×1.3, revenue concentration, job volume, seasonality, lead flow and free-channel share, recurring revenue share, paid-ad efficiency, owner $/hr with ≥90% of jobs having owner hours, and cash reserve vs target.",
    inputSchema: {}, annotations: { readOnlyHint: true }
  }, guarded(() => rpc(dbc, "full_time_readiness", {})));

  // ---------------- write tools ----------------
  server.registerTool("log_owner_time", {
    title: "Log owner time",
    description: "Log Mico's own hours (at $0 — owner draws are not wages, but the hours drive owner $/hr). activity defaults to on_job; drive/dump_run/on_job need a job_id. Use quoting_admin, marketing, bookkeeping for non-billable time so the billable share is honest.",
    inputSchema: {
      hours: external_exports.number().positive().describe("Hours, e.g. 2.5"),
      activity: external_exports.enum(LABOR_ACTIVITIES).default("on_job"),
      job_id: external_exports.string().uuid().optional(),
      worked_on: DATE3.optional().describe("Defaults to today (Detroit)"),
      note: external_exports.string().optional()
    }
  }, guarded((a) => rpc(dbc, "log_owner_time", { p_hours: a.hours, p_activity: a.activity ?? "on_job", p_job_id: a.job_id ?? null, p_worked_on: a.worked_on ?? null, p_note: a.note ?? null })));

  server.registerTool("log_dump_ticket", {
    title: "Log a dump ticket",
    description: "Record one dump/disposal ticket and split its cost across the jobs whose loads were on it (even split, or by each job's load_fraction when known). Creates the dump_fees expense automatically when paid. Site names: Taylor Hills, Carleton Farms, Woodland Meadows, WM 275 & Ecorse, JFON's, Hamtramck Recycling, or free text. Staged loads: list every job that was in the load.",
    inputSchema: {
      cost: external_exports.number().min(0),
      site: external_exports.string().min(1).describe("Facility name, e.g. 'Taylor Hills'"),
      job_ids: external_exports.array(external_exports.string().uuid()).default([]).describe("Jobs whose material was on this ticket"),
      dumped_on: DATE3.optional(),
      weight_tons: external_exports.number().min(0).optional(),
      material: external_exports.enum(DUMP_MATERIALS).default("mixed_junk"),
      paid: external_exports.boolean().default(true),
      paid_with: external_exports.string().default("bluevine"),
      receipt_url: external_exports.string().optional(),
      notes: external_exports.string().optional()
    }
  }, guarded((a) => rpc(dbc, "log_dump_ticket", { p_cost: a.cost, p_site: a.site, p_job_ids: a.job_ids ?? [], p_dumped_on: a.dumped_on ?? null, p_weight_tons: a.weight_tons ?? null, p_material: a.material ?? "mixed_junk", p_paid: a.paid ?? true, p_paid_with: a.paid_with ?? "bluevine", p_receipt_url: a.receipt_url ?? null, p_notes: a.notes ?? null, p_external_source: null, p_external_id: null })));

  server.registerTool("create_lead", {
    title: "Create lead",
    description: "Record an inquiry that isn't a quote yet — a call, text, DM, marketplace message. lead_source is required ('unknown' is allowed but shows up in reports). Match to an existing customer with customer_id when you know it. Set first_response_at if Mico already replied (speed-to-lead).",
    inputSchema: {
      name: external_exports.string().min(1), phone: external_exports.string().optional(), email: external_exports.string().optional(), address: external_exports.string().optional(),
      channel_in: external_exports.enum(LEAD_CHANNELS), lead_source: external_exports.enum(LEAD_SOURCES_V2), lead_source_detail: external_exports.string().optional().describe("e.g. which Facebook group"),
      referred_by_customer_id: external_exports.string().uuid().optional(), campaign_id: external_exports.string().uuid().optional(), customer_id: external_exports.string().uuid().optional(),
      notes: external_exports.string().optional(), first_response_at: external_exports.string().optional().describe("ISO timestamp of the first reply, if already sent")
    }
  }, guarded(async (a) => {
    const { data, error } = await dbc.from("leads").insert({
      name: a.name.trim(), phone: a.phone ?? null, email: a.email ?? null, address: a.address ?? null, channel_in: a.channel_in, source: a.lead_source,
      lead_source_detail: a.lead_source_detail ?? null, referred_by_customer_id: a.referred_by_customer_id ?? null, campaign_id: a.campaign_id ?? null,
      customer_id: a.customer_id ?? null, notes: a.notes ?? null, first_response_at: a.first_response_at ?? null, status: a.first_response_at ? "contacted" : "new", created_by: env.OWNER_USER_ID
    }).select("id,name,phone,source,status,channel_in,created_at").single();
    if (error) return fail("db_error", error.message);
    return ok({ lead_id: data.id, ...data });
  }));

  server.registerTool("update_lead", {
    title: "Update lead",
    description: "Change a lead's status or details. lost needs lost_reason; not_a_fit needs not_a_fit_reason (hazmat, labor_only, out_of_area, too_small, other). Setting responded: true stamps first_response_at now if empty. Link quote_id / job_id / customer_id when they exist.",
    inputSchema: {
      lead_id: external_exports.string().uuid(),
      status: external_exports.enum(LEAD_STATUSES2).optional(), lost_reason: external_exports.string().optional(), not_a_fit_reason: external_exports.enum(["hazmat", "labor_only", "out_of_area", "too_small", "other"]).optional(),
      responded: external_exports.boolean().optional(), lead_source: external_exports.enum(LEAD_SOURCES_V2).optional(), lead_source_detail: external_exports.string().optional(),
      quote_id: external_exports.string().uuid().optional(), job_id: external_exports.string().uuid().optional(), customer_id: external_exports.string().uuid().optional(), notes: external_exports.string().optional()
    }
  }, guarded(async (a) => {
    if (a.status === "lost" && !a.lost_reason) return fail("bad_input", "lost_reason is required when a lead is lost.");
    if (a.status === "not_a_fit" && !a.not_a_fit_reason) return fail("bad_input", "not_a_fit_reason is required (hazmat, labor_only, out_of_area, too_small, other).");
    const patch = {};
    for (const k of ["status", "lost_reason", "not_a_fit_reason", "lead_source_detail", "quote_id", "job_id", "customer_id", "notes"]) if (a[k] !== void 0) patch[k] = a[k];
    if (a.lead_source) patch.source = a.lead_source;
    if (a.responded) { patch.last_contact_at = new Date().toISOString(); patch.outbound_count_bump = true; }
    delete patch.outbound_count_bump;
    const { data: cur } = await dbc.from("leads").select("first_response_at,outbound_count").eq("id", a.lead_id).maybeSingle();
    if (!cur) return fail("not_found", `No lead ${a.lead_id}.`);
    if (a.responded) { if (!cur.first_response_at) patch.first_response_at = new Date().toISOString(); patch.outbound_count = (cur.outbound_count ?? 0) + 1; if (!patch.status) patch.status = "contacted"; }
    const { data, error } = await dbc.from("leads").update(patch).eq("id", a.lead_id).select("id,name,status,source,first_response_at,quote_id,job_id").single();
    if (error) return fail("db_error", error.message);
    return ok(data);
  }));

  server.registerTool("log_review", {
    title: "Log a review",
    description: "Record that a review was requested or received for a job (platform, rating, URL). Reviews received feed customer_metrics and the reviews trend.",
    inputSchema: { job_id: external_exports.string().uuid(), requested: external_exports.boolean().optional(), received: external_exports.boolean().optional(), platform: external_exports.enum(REVIEW_PLATFORMS).optional(), rating: external_exports.number().int().min(1).max(5).optional(), url: external_exports.string().optional() }
  }, guarded(async (a) => {
    const patch = {};
    if (a.requested) patch.review_requested_at = new Date().toISOString();
    if (a.received !== void 0) patch.review_received = a.received;
    if (a.platform) patch.review_platform = a.platform;
    if (a.rating) patch.review_rating = a.rating;
    if (a.url) patch.review_url = a.url;
    const { data, error } = await dbc.from("jobs").update(patch).eq("id", a.job_id).select("id,title,review_requested_at,review_received,review_platform,review_rating").single();
    if (error) return fail("db_error", error.message);
    return ok(data);
  }));

  server.registerTool("create_account", {
    title: "Create commercial account",
    description: "A property manager, landlord, realtor, apartment complex, business, league or contractor that can send repeat work. Link customers/jobs/quotes to it with account_id. stage tracks the relationship (prospect → active).",
    inputSchema: { name: external_exports.string().min(1), type: external_exports.enum(ACCOUNT_KINDS).default("other"), primary_contact_customer_id: external_exports.string().uuid().optional(), address: external_exports.string().optional(), units_managed: external_exports.number().int().optional(),
      stage: external_exports.enum(ACCOUNT_STAGES).default("prospect"), rate_card: external_exports.record(external_exports.any()).optional(), billing_terms: external_exports.string().optional(), recurring_cadence: external_exports.enum(CADENCES).default("none"), next_expected_job_at: DATE3.optional(), notes: external_exports.string().optional(), internal_notes: external_exports.string().optional() }
  }, guarded(async (a) => {
    const { data, error } = await dbc.from("accounts_crm").insert({ ...a, type: a.type ?? "other", stage: a.stage ?? "prospect", recurring_cadence: a.recurring_cadence ?? "none" }).select("*").single();
    if (error) return fail("db_error", error.message);
    if (a.primary_contact_customer_id) await dbc.from("customers").update({ account_id: data.id }).eq("id", a.primary_contact_customer_id);
    return ok({ account_id: data.id, ...data });
  }));

  server.registerTool("update_account", {
    title: "Update commercial account",
    description: "Patch any field on an account (stage, cadence, rate card, contact, notes).",
    inputSchema: { account_id: external_exports.string().uuid(), name: external_exports.string().optional(), type: external_exports.enum(ACCOUNT_KINDS).optional(), primary_contact_customer_id: external_exports.string().uuid().optional(), address: external_exports.string().optional(), units_managed: external_exports.number().int().optional(),
      stage: external_exports.enum(ACCOUNT_STAGES).optional(), rate_card: external_exports.record(external_exports.any()).optional(), billing_terms: external_exports.string().optional(), recurring_cadence: external_exports.enum(CADENCES).optional(), next_expected_job_at: DATE3.optional(), notes: external_exports.string().optional(), internal_notes: external_exports.string().optional() }
  }, guarded(async (a) => {
    const { account_id, ...patch } = a;
    if (Object.keys(patch).length === 0) return fail("bad_input", "Pass at least one field.");
    const { data, error } = await dbc.from("accounts_crm").update(patch).eq("id", account_id).select("*").single();
    if (error) return fail("db_error", error.message);
    return ok(data);
  }));

  server.registerTool("list_accounts", {
    title: "List commercial accounts",
    description: "Accounts with stage and cadence, optionally filtered by stage.",
    inputSchema: { stage: external_exports.enum(ACCOUNT_STAGES).optional() }, annotations: { readOnlyHint: true }
  }, guarded(async (a) => {
    let q = dbc.from("accounts_crm").select("id,name,type,stage,recurring_cadence,next_expected_job_at,units_managed,primary_contact_customer_id").order("name");
    if (a.stage) q = q.eq("stage", a.stage);
    const { data, error } = await q;
    if (error) return fail("db_error", error.message);
    return ok({ count: (data ?? []).length, accounts: data ?? [] });
  }));

  server.registerTool("record_referral", {
    title: "Record a referral",
    description: "Who referred whom, for which job, and any reward owed. Also sets the referred customer's referred_by and lead_source = referral when empty.",
    inputSchema: { referrer_customer_id: external_exports.string().uuid(), referred_customer_id: external_exports.string().uuid().optional(), referred_job_id: external_exports.string().uuid().optional(), reward_amount: external_exports.number().min(0).default(0), notes: external_exports.string().optional() }
  }, guarded(async (a) => {
    const { data, error } = await dbc.from("referrals").insert({ ...a, reward_amount: a.reward_amount ?? 0 }).select("*").single();
    if (error) return fail("db_error", error.message);
    if (a.referred_customer_id) await dbc.from("customers").update({ referred_by_customer_id: a.referrer_customer_id }).eq("id", a.referred_customer_id).is("referred_by_customer_id", null);
    if (a.referred_job_id) await dbc.from("jobs").update({ referred_by_customer_id: a.referrer_customer_id, lead_source: "referral" }).eq("id", a.referred_job_id);
    return ok(data);
  }));

  server.registerTool("log_mileage", {
    title: "Log mileage",
    description: "Record miles driven (base → job → dump → base) for a job or a purpose. amount = miles × the rate in app_settings.mileage_rate_per_mile. Reports show profit before and after vehicle cost.",
    inputSchema: { miles: external_exports.number().min(0), job_id: external_exports.string().uuid().optional(), purpose: external_exports.string().optional(), logged_on: DATE3.optional(), start_odometer: external_exports.number().int().optional(), end_odometer: external_exports.number().int().optional() }
  }, guarded(async (a) => {
    const { data, error } = await dbc.from("mileage_log").insert({ miles: a.miles, job_id: a.job_id ?? null, purpose: a.purpose ?? null, ...a.logged_on ? { logged_on: a.logged_on } : {}, start_odometer: a.start_odometer ?? null, end_odometer: a.end_odometer ?? null, created_by: env.OWNER_USER_ID }).select("id,logged_on,miles,rate_per_mile,amount,job_id").single();
    if (error) return fail("db_error", error.message);
    return ok(data);
  }));

  server.registerTool("close_out_job_details", {
    title: "Add close-out details to a job",
    description: "Capture what complete_job doesn't already know: service_type, hauling_unit, load_fraction (trailer loads, e.g. 0.5 or 2), est_weight_lbs, mattress/box spring/heavy item counts, access flags, crew_size, on_site_minutes, owner hours (and drive hours), a dump ticket to log+allocate to this job, existing ticket ids to allocate, review_requested. Returns still_missing — the fields a fully costed job needs. Idempotent; safe to call again with more detail.",
    inputSchema: {
      job_id: external_exports.string().uuid(),
      service_type: external_exports.enum(SERVICE_TYPES).optional(), hauling_unit: external_exports.enum(HAULING_UNITS).optional(), load_fraction: external_exports.number().min(0).optional(),
      est_weight_lbs: external_exports.number().min(0).optional(), mattress_count: external_exports.number().int().min(0).optional(), box_spring_count: external_exports.number().int().min(0).optional(), heavy_item_count: external_exports.number().int().min(0).optional(),
      access_flags: external_exports.array(external_exports.enum(ACCESS_FLAGS)).optional(), crew_size: external_exports.number().int().min(1).optional(), on_site_minutes: external_exports.number().int().min(0).optional(),
      owner_hours: external_exports.number().min(0).optional().describe("Mico's hours on this job"), owner_drive_hours: external_exports.number().min(0).optional(),
      picked_up_at: external_exports.string().optional(), disposed_at: external_exports.string().optional(), staged: external_exports.boolean().optional(),
      dump_ticket: external_exports.object({ cost: external_exports.number().min(0), site: external_exports.string().optional(), dumped_on: DATE3.optional(), weight_tons: external_exports.number().optional(), material: external_exports.enum(DUMP_MATERIALS).optional(), paid: external_exports.boolean().optional(), paid_with: external_exports.string().optional() }).optional(),
      allocate_ticket_ids: external_exports.array(external_exports.string().uuid()).optional().describe("Existing dump tickets this job's load was part of"),
      review_requested: external_exports.boolean().optional(), completed_on: DATE3.optional(), internal_notes: external_exports.string().optional()
    }
  }, guarded(async (a) => { const { job_id, ...p } = a; return rpc(dbc, "job_close_out", { p_job_id: job_id, p }); }));

  server.registerTool("get_settings", {
    title: "Business settings & thresholds",
    description: "Read app_settings: vehicle_cost_mode, mileage_rate_per_mile, trailer_capacity_cy, owner_target_hourly, capital_threshold, cash_reserve, reserve_target, required_owner_income, ft_thresholds, day_job_hours.",
    inputSchema: {}, annotations: { readOnlyHint: true }
  }, guarded(async () => { const { data, error } = await dbc.from("app_settings").select("key,value,note"); if (error) return fail("db_error", error.message); return ok(Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))); }));

  server.registerTool("update_setting", {
    title: "Update a business setting",
    description: "Set one app_settings key (e.g. cash_reserve: 4200, mileage_rate_per_mile: 0.70, vehicle_cost_mode: 'actual').",
    inputSchema: { key: external_exports.string(), value: external_exports.any() }
  }, guarded(async (a) => { const { error } = await dbc.from("app_settings").upsert({ key: a.key, value: a.value, updated_at: new Date().toISOString() }); if (error) return fail("db_error", error.message); return ok({ key: a.key, value: a.value }); }));

  server.registerTool("sync_status", {
    title: "Integration sync status",
    description: "Last run per integration source (quo, stripe, meta, gbp, maps, bank_csv, calendar): status, rows, errors, and whether it's stale (>48h).",
    inputSchema: {}, annotations: { readOnlyHint: true }
  }, guarded(async () => {
    const { data, error } = await dbc.from("integration_runs").select("source,started_at,finished_at,status,rows_in,rows_matched,errors").order("started_at", { ascending: false }).limit(200);
    if (error) return fail("db_error", error.message);
    const latest = {};
    for (const r of data ?? []) if (!latest[r.source]) latest[r.source] = { ...r, stale: Date.now() - new Date(r.started_at).getTime() > 48 * 36e5 };
    return ok(latest);
  }));

  server.registerTool("review_unmatched_transactions", {
    title: "Unmatched bank transactions",
    description: "Bank rows (CSV import or feed) not yet matched to an expense or payment, oldest first.",
    inputSchema: { limit: external_exports.number().int().min(1).max(200).default(50) }, annotations: { readOnlyHint: true }
  }, guarded(async (a) => {
    const { data, error } = await dbc.from("bank_transactions").select("id,posted_date,description,amount,direction,status").eq("status", "unmatched").order("posted_date").limit(a.limit ?? 50);
    if (error) return fail("db_error", error.message);
    return ok({ count: (data ?? []).length, transactions: data ?? [] });
  }));

  server.registerTool("match_transaction", {
    title: "Match a bank transaction",
    description: "Link a bank transaction to an existing expense or payment (or mark it ignored).",
    inputSchema: { txn_id: external_exports.string().uuid(), expense_id: external_exports.string().uuid().optional(), payment_id: external_exports.string().uuid().optional(), ignore: external_exports.boolean().default(false) }
  }, guarded(async (a) => {
    if (!a.expense_id && !a.payment_id && !a.ignore) return fail("bad_input", "Give expense_id, payment_id, or ignore: true.");
    const patch = a.ignore ? { status: "ignored" } : { status: "matched", matched_expense_id: a.expense_id ?? null, matched_payment_id: a.payment_id ?? null };
    const { data, error } = await dbc.from("bank_transactions").update(patch).eq("id", a.txn_id).select("id,status,matched_expense_id,matched_payment_id").single();
    if (error) return fail("db_error", error.message);
    if (a.expense_id) await dbc.from("expenses").update({ is_pending: false }).eq("id", a.expense_id);
    return ok(data);
  }));
}
__name(registerMetricsTools, "registerMetricsTools");
