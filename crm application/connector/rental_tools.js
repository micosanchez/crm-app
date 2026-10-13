// src/tools/rentals.ts — moving tote rentals (2026-10-12).
// Reads go straight to Supabase (service role). Every write goes through the CRM's
// /api/rentals ops endpoint with the service-role bearer so Stripe, texts, events and
// balance math live in exactly one place (src/lib/rentals/ops.ts).
var RENTAL_APP = "https://crmsjh.netlify.app";
var RENTAL_STATUSES = ["pending_payment", "booked", "delivered", "out", "pickup_scheduled", "returned", "inspected", "closed", "cancelled"];
var RENTAL_CHARGE_TYPES = ["late_fee", "missing_item", "damage", "cleaning", "extension", "adjustment", "failed_trip"];
var RENTAL_TEMPLATES = ["booking_confirmed", "delivery_reminder", "on_my_way", "delivered", "pickup_reminder_2d", "pickup_day", "overdue_1", "overdue_3", "receipt", "payment_failed", "card_expiring", "closed", "reschedule", "failed_trip"];
var RENTAL_CONDITIONS = ["good", "dirty", "damaged", "missing"];
var RENTAL_SELECT = "id, rental_number, status, delivery_address, pickup_address, delivery_date, delivery_window, pickup_date, pickup_window, tote_count, dolly_count, extra_weeks, subtotal, delivery_fee, addons_total, discount_amount, total, deposit_amount, deposit_status, deposit_applied, balance_due, card_brand, card_last4, card_exp, lead_source, promo_code, sms_consent_at, disputed_at, junk_request_id, notes_customer, notes_internal, created_at, public_token, customers(id, name, phone, email)";

async function rentalOp(env, action, args) {
  const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${RENTAL_APP}/api/rentals`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ action, ...args }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) return fail("rental_error", j.error ?? `${action}: HTTP ${res.status}`);
  return ok(j);
}
__name(rentalOp, "rentalOp");

async function findRental(dbc, ref) {
  const q = dbc.from("rentals").select(RENTAL_SELECT);
  const { data, error } = /^[0-9a-f-]{36}$/i.test(ref) ? await q.eq("id", ref).maybeSingle() : await q.eq("rental_number", ref.toUpperCase().startsWith("R-") ? ref.toUpperCase() : `R-${ref}`).maybeSingle();
  if (error) return fail("db_error", error.message);
  if (!data) return fail("not_found", `No rental ${ref}`);
  return ok(data);
}
__name(findRental, "findRental");

function registerRentalTools(server, dbc, env) {
  const ref = external_exports.string().describe("Rental id or number, e.g. R-1004");

  server.registerTool("list_rentals", {
    title: "List tote rentals",
    description: "Tote rentals, newest delivery first. Filter by status, a date window on delivery_date, or customer name/phone. Flags: overdue (past pickup and not returned), payment_failed, dispute.",
    inputSchema: { status: external_exports.enum(RENTAL_STATUSES).optional(), from: DATE3.optional(), to: DATE3.optional(), customer: external_exports.string().optional().describe("Name or phone fragment"), limit: external_exports.number().int().min(1).max(200).default(50) },
    annotations: { readOnlyHint: true }
  }, guarded(async (a) => {
    let q = dbc.from("rentals").select(RENTAL_SELECT).order("delivery_date", { ascending: false }).limit(a.limit ?? 50);
    if (a.status) q = q.eq("status", a.status); else q = q.neq("status", "pending_payment");
    if (a.from) q = q.gte("delivery_date", a.from);
    if (a.to) q = q.lte("delivery_date", a.to);
    const { data, error } = await q;
    if (error) return fail("db_error", error.message);
    let rows = data ?? [];
    if (a.customer) { const t = a.customer.toLowerCase().replace(/\D/g, "") || a.customer.toLowerCase(); rows = rows.filter((r) => (r.customers?.name ?? "").toLowerCase().includes(a.customer.toLowerCase()) || (r.customers?.phone ?? "").replace(/\D/g, "").includes(t)); }
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Detroit" });
    const { data: failed } = await dbc.from("rental_charges").select("rental_id").in("status", ["failed", "requires_action"]);
    const failedSet = new Set((failed ?? []).map((c) => c.rental_id));
    return ok({ count: rows.length, rentals: rows.map((r) => ({ ...r, public_token: void 0, customer_link: `${RENTAL_APP}/rental/${r.public_token}`, flags: [r.pickup_date < today && ["delivered", "out", "pickup_scheduled"].includes(r.status) ? "overdue" : null, failedSet.has(r.id) ? "payment_failed" : null, r.disputed_at ? "dispute" : null].filter(Boolean) })) });
  }));

  server.registerTool("get_rental", {
    title: "Get a tote rental",
    description: "Everything about one rental: customer, dates, items (tags and conditions), charges, agreement, events and the customer link.",
    inputSchema: { rental: ref }, annotations: { readOnlyHint: true }
  }, guarded(async (a) => {
    const r = await findRental(dbc, a.rental); if (r.isError) return r;
    const row = JSON.parse(r.content[0].text);
    const [{ data: items }, { data: charges }, { data: agreement }, { data: events }] = await Promise.all([
      dbc.from("rental_items").select("checked_out_at, checked_in_at, return_condition, rental_assets(asset_tag, asset_type)").eq("rental_id", row.id),
      dbc.from("rental_charges").select("id, type, amount, description, status, stripe_payment_intent_id, payment_link_url, created_at").eq("rental_id", row.id).order("created_at"),
      dbc.from("rental_agreements").select("signer_name, signed_at, terms_version, pdf_url").eq("rental_id", row.id).maybeSingle(),
      dbc.from("rental_events").select("event, detail, created_at").eq("rental_id", row.id).order("created_at", { ascending: false }).limit(40)
    ]);
    return ok({ ...row, customer_link: `${RENTAL_APP}/rental/${row.public_token}`, staff_link: `${RENTAL_APP}/rentals/${row.id}`, public_token: void 0, items: (items ?? []).map((i) => ({ tag: i.rental_assets?.asset_tag, type: i.rental_assets?.asset_type, out: i.checked_out_at, in: i.checked_in_at, condition: i.return_condition })), charges, agreement, events });
  }));

  server.registerTool("check_tote_availability", {
    title: "Check tote availability",
    description: "Totes and dollies free on each day between two dates (pool minus rentals out, holds, and the turnaround buffer). Use before booking by phone.",
    inputSchema: { from: DATE3, to: DATE3 }, annotations: { readOnlyHint: true }
  }, guarded((a) => rpc(dbc, "get_tote_availability", { start_date: a.from, end_date: a.to })));

  server.registerTool("rental_schedule", {
    title: "Tote deliveries and pickups",
    description: "Deliveries and pickups between two dates (default: today), sorted by window, for route planning. Merge mentally with get_schedule for junk jobs.",
    inputSchema: { from: DATE3.optional(), to: DATE3.optional() }, annotations: { readOnlyHint: true }
  }, guarded(async (a) => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Detroit" });
    const from = a.from ?? today, to = a.to ?? from;
    const { data, error } = await dbc.from("rentals").select(RENTAL_SELECT).in("status", ["booked", "delivered", "out", "pickup_scheduled"]).or(`and(delivery_date.gte.${from},delivery_date.lte.${to}),and(pickup_date.gte.${from},pickup_date.lte.${to})`);
    if (error) return fail("db_error", error.message);
    const stops = [];
    for (const r of data ?? []) {
      if (r.delivery_date >= from && r.delivery_date <= to && r.status === "booked") stops.push({ date: r.delivery_date, window: r.delivery_window, kind: "delivery", rental: r.rental_number, customer: r.customers?.name, phone: r.customers?.phone, address: r.delivery_address, totes: r.tote_count, dollies: r.dolly_count, notes: r.notes_customer });
      if (r.pickup_date >= from && r.pickup_date <= to && r.status !== "booked") stops.push({ date: r.pickup_date, window: r.pickup_window, kind: "pickup", rental: r.rental_number, customer: r.customers?.name, phone: r.customers?.phone, address: r.pickup_address ?? r.delivery_address, totes: r.tote_count, dollies: r.dolly_count, notes: r.notes_customer });
    }
    stops.sort((x, y) => (x.date + x.window).localeCompare(y.date + y.window));
    return ok({ from, to, stops });
  }));

  server.registerTool("create_rental", {
    title: "Book a tote rental by phone",
    description: "Creates the hold exactly like the website (availability, lead time, slot cap and pricing are all checked in the database) and texts the customer a link to sign the agreement and pay the deposit. The hold lasts 30 minutes; if they miss it the same link lets them rebook with everything prefilled. Ask for name, phone, delivery address, date and window first. Nothing is charged until the customer pays.",
    inputSchema: {
      name: external_exports.string().min(1), phone: external_exports.string().min(10), email: external_exports.string().email().optional(),
      package_id: external_exports.string().uuid().optional().describe("Omit to use the only active package"),
      delivery_address: external_exports.string().min(5), pickup_address: external_exports.string().optional().describe("Only if different"),
      delivery_date: DATE3, delivery_window: external_exports.string().describe("One of the slot windows, e.g. 5-7pm"), pickup_window: external_exports.string().optional(),
      extra_weeks: external_exports.number().int().min(0).max(8).default(0), dollies: external_exports.number().int().min(0).max(4).default(0),
      promo_code: external_exports.string().optional(), notes: external_exports.string().optional(), sms_consent: external_exports.boolean().default(true).describe("Did they agree to texts about the rental?"),
      lead_source: external_exports.enum(LEAD_SOURCES_V2).default("other"), send_link: external_exports.boolean().default(true)
    }
  }, guarded(async (a) => {
    const { data: cat, error: ce } = await dbc.rpc("rental_public_catalog");
    if (ce) return fail("db_error", ce.message);
    const pkg = a.package_id ? cat.packages.find((p) => p.id === a.package_id) : cat.packages[0];
    if (!pkg) return fail("no_package", "No active package with a price. Set one at /rentals/packages.");
    const dolly = cat.addons.find((x) => x.asset_type === "dolly");
    const body = { package_id: pkg.id, extra_weeks: a.extra_weeks ?? 0, addons: a.dollies && dolly ? [{ addon_id: dolly.id, qty: a.dollies }] : [], delivery_address: a.delivery_address, pickup_address: a.pickup_address ?? null, promo_code: a.promo_code ?? null, delivery_date: a.delivery_date, delivery_window: a.delivery_window, pickup_window: a.pickup_window ?? a.delivery_window, name: a.name, phone: a.phone, email: a.email ?? "", lead_source: a.lead_source ?? "other", notes_customer: a.notes ?? null, sms_consent: a.sms_consent ?? true, website: "" };
    const res = await fetch(`${RENTAL_APP}/api/public/rentals/hold`, { method: "POST", headers: { "content-type": "application/json", "user-agent": "sjhc-connector" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (j.error) return fail("hold_failed", j.error === "sold_out" ? "Not enough totes free for those dates." : j.error === "slot_full" ? "That delivery window is full." : j.error);
    const link = `${RENTAL_APP}/rent?resume=${j.public_token}`;
    let texted = null;
    if (a.send_link !== false) {
      const t = await rentalOp(env, "send_text", { rental_id: j.rental_id, content: `Hi ${a.name.split(" ")[0]}, this is Sanchez Junk & Haul Co. Your moving totes are reserved for ${a.delivery_date}. Sign the agreement and pay the deposit here to lock it in: ${link}` });
      texted = !t.isError;
    }
    return ok({ rental_id: j.rental_id, rental_number: j.rental_number, quote: j.quote, link, texted, next: "The customer signs and pays from the link; the rental turns booked automatically." });
  }));

  server.registerTool("update_rental", {
    title: "Update a tote rental",
    description: "Change addresses, windows, notes, lead source, or move delivery/pickup dates (availability is re-checked and the customer gets a reschedule text).",
    inputSchema: { rental: ref, delivery_address: external_exports.string().optional(), pickup_address: external_exports.string().optional(), delivery_date: DATE3.optional(), delivery_window: external_exports.string().optional(), pickup_date: DATE3.optional(), pickup_window: external_exports.string().optional(), notes_internal: external_exports.string().optional(), notes_customer: external_exports.string().optional(), lead_source: external_exports.enum(LEAD_SOURCES_V2).optional() }
  }, guarded(async (a) => { const r = await findRental(dbc, a.rental); if (r.isError) return r; const { rental, ...rest } = a; return rentalOp(env, "update", { rental_id: JSON.parse(r.content[0].text).id, ...rest }); }));

  server.registerTool("cancel_rental", {
    title: "Cancel a tote rental",
    description: "Preview first (confirm=false) to see the refund per the cancellation policy, then confirm=true to cancel, refund the deposit/payment as the policy says, and text the customer.",
    inputSchema: { rental: ref, reason: external_exports.string().optional(), confirm: external_exports.boolean().default(false) }
  }, guarded(async (a) => { const r = await findRental(dbc, a.rental); if (r.isError) return r; return rentalOp(env, "cancel", { rental_id: JSON.parse(r.content[0].text).id, reason: a.reason, confirm: a.confirm === true }); }));

  server.registerTool("extend_rental", {
    title: "Extend a tote rental",
    description: "Adds whole weeks, checks the totes are still free, charges the card on file for the extension and moves the pickup date. confirm must be true.",
    inputSchema: { rental: ref, weeks: external_exports.number().int().min(1).max(8).default(1), confirm: external_exports.boolean().default(false) }
  }, guarded(async (a) => { if (!a.confirm) return fail("confirm_required", "Set confirm=true to charge the extension."); const r = await findRental(dbc, a.rental); if (r.isError) return r; return rentalOp(env, "extend", { rental_id: JSON.parse(r.content[0].text).id, weeks: a.weeks ?? 1 }); }));

  server.registerTool("record_delivery", {
    title: "Record a tote delivery",
    description: "Check out the totes (by asset tag, e.g. T-001) to the customer, mark delivered, text them, and charge the balance if settings say balance is due at delivery. Tags optional: without them the next free tags are assigned.",
    inputSchema: { rental: ref, tags: external_exports.array(external_exports.string()).default([]) }
  }, guarded(async (a) => { const r = await findRental(dbc, a.rental); if (r.isError) return r; return rentalOp(env, "record_delivery", { rental_id: JSON.parse(r.content[0].text).id, tags: a.tags ?? [] }); }));

  server.registerTool("record_pickup", {
    title: "Record a tote pickup",
    description: "Check the totes back in with a condition per tag (good, dirty, damaged, missing). Fees for dirty/damaged/missing and late days are added as pending charges for review; nothing is charged until settle.",
    inputSchema: { rental: ref, items: external_exports.array(external_exports.object({ tag: external_exports.string(), condition: external_exports.enum(RENTAL_CONDITIONS).default("good"), note: external_exports.string().optional() })).min(1), all_good: external_exports.boolean().default(false).describe("Shortcut: every item on the rental came back good") }
  }, guarded(async (a) => {
    const r = await findRental(dbc, a.rental); if (r.isError) return r; const row = JSON.parse(r.content[0].text);
    let items = a.items ?? [];
    if (a.all_good) { const { data } = await dbc.from("rental_items").select("rental_assets(asset_tag)").eq("rental_id", row.id).is("checked_in_at", null); items = (data ?? []).map((i) => ({ tag: i.rental_assets?.asset_tag, condition: "good" })); }
    return rentalOp(env, "record_pickup", { rental_id: row.id, items });
  }));

  server.registerTool("charge_rental", {
    title: "Charge a rental fee",
    description: "Adds a fee (late_fee, missing_item, damage, cleaning, extension, adjustment, failed_trip) and charges the card on file now. confirm must be true. For the end-of-rental settlement use settle_rental instead.",
    inputSchema: { rental: ref, type: external_exports.enum(RENTAL_CHARGE_TYPES), amount: external_exports.number().positive(), description: external_exports.string().optional(), confirm: external_exports.boolean().default(false) }
  }, guarded(async (a) => { if (!a.confirm) return fail("confirm_required", "Set confirm=true to charge the card."); const r = await findRental(dbc, a.rental); if (r.isError) return r; return rentalOp(env, "charge", { rental_id: JSON.parse(r.content[0].text).id, type: a.type, amount: a.amount, description: a.description }); }));

  server.registerTool("settle_rental", {
    title: "Settle a returned rental",
    description: "Applies the deposit to any pending fees, charges the card for what is left (or refunds the unused deposit), texts the receipt, and closes the rental. Run after record_pickup once the fees look right. confirm must be true.",
    inputSchema: { rental: ref, confirm: external_exports.boolean().default(false) }
  }, guarded(async (a) => { if (!a.confirm) return fail("confirm_required", "Set confirm=true to settle."); const r = await findRental(dbc, a.rental); if (r.isError) return r; return rentalOp(env, "settle", { rental_id: JSON.parse(r.content[0].text).id }); }));

  server.registerTool("refund_rental_charge", {
    title: "Refund a rental charge",
    description: "Refunds a succeeded charge (full, or a partial amount) through Stripe and texts the customer. confirm must be true.",
    inputSchema: { charge_id: external_exports.string().uuid(), amount: external_exports.number().positive().optional(), reason: external_exports.string().optional(), confirm: external_exports.boolean().default(false) }
  }, guarded(async (a) => { if (!a.confirm) return fail("confirm_required", "Set confirm=true to refund."); return rentalOp(env, "refund", { charge_id: a.charge_id, amount: a.amount ?? null, reason: a.reason }); }));

  server.registerTool("send_rental_payment_link", {
    title: "Text a rental payment link",
    description: "For a failed or pending charge: makes a Stripe payment link and texts it to the customer.",
    inputSchema: { charge_id: external_exports.string().uuid() }
  }, guarded((a) => rentalOp(env, "send_payment_link", { charge_id: a.charge_id })));

  server.registerTool("send_rental_text", {
    title: "Text a rental customer",
    description: "Sends one of the rental templates (on_my_way, delivery_reminder, pickup_reminder_2d, overdue_1 ...) or custom text from the Quo line. Texts never include prices. Respects opt-outs.",
    inputSchema: { rental: ref, template: external_exports.enum(RENTAL_TEMPLATES).optional(), content: external_exports.string().optional().describe("Custom message instead of a template"), window: external_exports.string().optional().describe("For on_my_way: the arrival window to mention") }
  }, guarded(async (a) => { const r = await findRental(dbc, a.rental); if (r.isError) return r; return rentalOp(env, "send_text", { rental_id: JSON.parse(r.content[0].text).id, template: a.template, content: a.content, window: a.window }); }));

  server.registerTool("list_rental_assets", {
    title: "List totes and dollies",
    description: "Inventory with status counts. Filter by status (available, out, returned_dirty, damaged, lost, retired) or type.",
    inputSchema: { status: external_exports.string().optional(), asset_type: external_exports.string().optional() }, annotations: { readOnlyHint: true }
  }, guarded(async (a) => {
    let q = dbc.from("rental_assets").select("id, asset_tag, asset_type, status, condition_notes, purchase_cost").order("asset_tag");
    if (a.status) q = q.eq("status", a.status); if (a.asset_type) q = q.eq("asset_type", a.asset_type);
    const { data, error } = await q; if (error) return fail("db_error", error.message);
    const counts = {}; for (const x of data ?? []) counts[`${x.asset_type}:${x.status}`] = (counts[`${x.asset_type}:${x.status}`] ?? 0) + 1;
    return ok({ counts, assets: data });
  }));

  server.registerTool("update_rental_asset", {
    title: "Update a tote or dolly",
    description: "Mark an asset available, damaged, lost or retired (with a note), or add new tags in bulk (tags like T-041).",
    inputSchema: { tag: external_exports.string().optional(), status: external_exports.string().optional(), note: external_exports.string().optional(), add_tags: external_exports.array(external_exports.string()).optional(), asset_type: external_exports.string().default("tote"), purchase_cost: external_exports.number().optional() }
  }, guarded(async (a) => {
    if (a.add_tags?.length) return rentalOp(env, "bulk_add_assets", { tags: a.add_tags, asset_type: a.asset_type ?? "tote", purchase_cost: a.purchase_cost ?? null, purchase_date: new Date().toLocaleDateString("en-CA", { timeZone: "America/Detroit" }) });
    if (!a.tag || !a.status) return fail("bad_input", "Give tag and status, or add_tags.");
    const { data } = await dbc.from("rental_assets").select("id").eq("asset_tag", a.tag.toUpperCase()).maybeSingle();
    if (!data) return fail("not_found", `No asset ${a.tag}`);
    return rentalOp(env, "update_asset", { asset_id: data.id, status: a.status, condition_notes: a.note });
  }));

  server.registerTool("rental_report", {
    title: "Tote rental report",
    description: "Net rental revenue by month and type, utilization, deposits held and balances due, failed charges, lost/damaged assets and fees recovered, payback on the tote investment, booking conversion, lead sources, and the junk-removal cross-sell. Rental revenue also appears as its own line in pnl_report and weekly_scorecard.",
    inputSchema: { from: DATE3.optional(), to: DATE3.optional() }, annotations: { readOnlyHint: true }
  }, guarded((a) => rpc(dbc, "rental_report", { p_from: a.from ?? null, p_to: a.to ?? null })));
}
__name(registerRentalTools, "registerRentalTools");
