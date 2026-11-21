"""Connector v2.7.0 (2026-11-21): pickup address fee on update_rental, record_pickup(all_good) with no items, and three
charge tools: add_pending_charge (a fee collected at settle_rental), edit_rental_charge and remove_rental_charge (pending
charges only; removing an extension takes its weeks back off the pickup date). Needs migration 0064 and the CRM deploy
that adds the add_pending_charge / edit_charge / remove_charge actions. Usage: python3 patch_v27.py index.js index.patched.js
(also applies cleanly to rental_tools.js, where only the version anchor is missing)."""
import sys

src, out = sys.argv[1], sys.argv[2]
s = open(src).read()
fails = 0


def rep(a, b):
    global s, fails
    if s.count(a) != 1:
        print('anchor not unique/missing:', a[:80], s.count(a)); fails += 1; return
    s = s.replace(a, b)


rep('description: "Change addresses, windows, notes, lead source, or move delivery/pickup dates (availability is re-checked and the customer gets a reschedule text). Set customer_requested=true when the customer asked: a delivery change under 48 hours before the window charges $25,',
    'description: "Change addresses, windows, notes, lead source, or move delivery/pickup dates (availability is re-checked and the customer gets a reschedule text). Set customer_requested=true when the customer asked: a pickup address change adds a pending pickup-location fee (business setting pickup_location_change_fee, $25) collected at settle_rental and returned as new_charge; a blank pickup_address means same as delivery; a delivery change under 48 hours before the window charges $25,')

rep('description: "Check the totes back in with a condition per tag (good, dirty, damaged, missing). The CRM requires a photo for anything not good, so record those from the rental page in the CRM; use this tool for all-good pickups.',
    'description: "Check the totes back in with a condition per tag (good, dirty, damaged, missing). The CRM requires a photo for anything not good, so record those from the rental page in the CRM; use this tool for all-good pickups. With all_good=true, items are optional: every item on the rental is marked good, or the whole tote count when no tags were recorded at delivery.')
rep('note: external_exports.string().optional() })).min(1), all_good:',
    'note: external_exports.string().optional() })).optional(), all_good:')
rep('''    let items = a.items ?? [];
    if (a.all_good) { const { data } = await dbc.from("rental_items").select("rental_assets(asset_tag)").eq("rental_id", row.id).is("checked_in_at", null); items = (data ?? []).map((i) => ({ tag: i.rental_assets?.asset_tag, condition: "good" })); }
    return rentalOp(env, "record_pickup", { rental_id: row.id, items, missing_lids: a.missing_lids ?? 0 });''',
    '''    const items = a.items ?? [];
    if (!items.length && !a.all_good) return fail("items_required", "List the items with their condition, or set all_good=true.");
    return rentalOp(env, "record_pickup", { rental_id: row.id, items, all_good: a.all_good === true, missing_lids: a.missing_lids ?? 0 });''')

rep('{ name: "SJHC Connector", version: "2.6.0" }', '{ name: "SJHC Connector", version: "2.7.0" }')

NEW = r'''
  server.registerTool("add_pending_charge", {
    title: "Add a pending rental fee",
    description: "Adds a fee to a rental WITHOUT charging the card: it stays pending and is collected at settle_rental. Use charge_rental instead to charge the card now. Returns the new charge, every charge on the rental and balance_due.",
    inputSchema: { rental: ref, type: external_exports.enum(RENTAL_CHARGE_TYPES), amount: external_exports.number().positive(), description: external_exports.string().optional() }
  }, guarded(async (a) => { const f = await findRental(dbc, a.rental); if (f.err) return f.err; return rentalOp(env, "add_pending_charge", { rental_id: f.row.id, type: a.type, amount: a.amount, description: a.description }); }));

  server.registerTool("edit_rental_charge", {
    title: "Edit a pending rental charge",
    description: "Changes the amount and/or description of a charge that is still pending (not yet charged). confirm=false previews; confirm=true saves and logs a charge_edited event. A charge that already went through can only be refunded (refund_rental_charge). Returns every charge on the rental and balance_due.",
    inputSchema: { charge_id: external_exports.string().uuid(), amount: external_exports.number().positive().optional(), description: external_exports.string().optional(), confirm: external_exports.boolean().default(false) }
  }, guarded((a) => rentalOp(env, "edit_charge", { charge_id: a.charge_id, amount: a.amount ?? null, description: a.description ?? null, confirm: a.confirm === true })));

  server.registerTool("remove_rental_charge", {
    title: "Remove a pending rental charge",
    description: "Voids a charge that is still pending (kept on file as voided, never deleted) and logs a charge_removed event with the reason. Removing an extension charge also undoes the extension: pickup moves back 7 days per week and extra_weeks drops, with no text to the customer. confirm=false previews; confirm=true removes. A charge that already went through can only be refunded (refund_rental_charge). Returns every charge on the rental and balance_due.",
    inputSchema: { charge_id: external_exports.string().uuid(), reason: external_exports.string().min(1), confirm: external_exports.boolean().default(false) }
  }, guarded((a) => rentalOp(env, "remove_charge", { charge_id: a.charge_id, reason: a.reason, confirm: a.confirm === true })));

  server.registerTool("send_rental_payment_link", {'''
rep('\n  server.registerTool("send_rental_payment_link", {', NEW)

open(out, 'w').write(s)
print('fails:', fails)
