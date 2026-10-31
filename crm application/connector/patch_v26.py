"""Connector v2.6.0 (2026-10-31): the rental lifecycle tools the CRM already had actions for but the connector did not
(confirm the date of a request, reschedule, missed trip, close), the request statuses on list_rentals, and the settle
description fixed (the rental is charged at pickup, not at booking). Usage: python3 patch_v26.py index.js index.patched.js"""
import sys

src, out = sys.argv[1], sys.argv[2]
s = open(src).read()
fails = 0


def rep(a, b):
    global s, fails
    if s.count(a) != 1:
        print('anchor not unique/missing:', a[:80], s.count(a)); fails += 1; return
    s = s.replace(a, b)


rep('var RENTAL_STATUSES = ["pending_payment", "booked",',
    'var RENTAL_STATUSES = ["pending_payment", "awaiting_confirmation", "expired", "booked",')
rep('description: "Charges the card on file for the pending fees (the rental itself was paid at booking), texts the receipt, and closes the rental. Run after record_pickup once the fees look right. confirm must be true."',
    'description: "Charges the card on file for everything still owed (the rental total is charged at pickup, plus any fees from record_pickup), emails the receipt, and closes the rental. Run after record_pickup once the fees look right. confirm must be true."')
rep('{ name: "SJHC Connector", version: "2.5.0" }', '{ name: "SJHC Connector", version: "2.6.0" }')

NEW = r'''
  server.registerTool("confirm_rental_date", {
    title: "Confirm a tote request's delivery date",
    description: "For a request waiting for a date (status awaiting_confirmation): sets the delivery date and window, reserves the totes (fails if not enough are free), sets pickup the package's rental days later, and texts and emails the customer their booking confirmation. Text them the windows first and use the one they picked.",
    inputSchema: { rental: ref, delivery_date: DATE3, delivery_window: external_exports.string().describe("One of the delivery windows in Rentals settings, e.g. as shown on the rental page"), pickup_window: external_exports.string().optional().describe("Defaults to the delivery window") }
  }, guarded(async (a) => {
    const f = await findRental(dbc, a.rental); if (f.err) return f.err;
    const { data: st } = await dbc.from("rental_settings").select("slot_windows").eq("id", true).maybeSingle();
    const windows = [...(st?.slot_windows?.weekday ?? []), ...(st?.slot_windows?.weekend ?? [])];
    for (const w of [a.delivery_window, a.pickup_window].filter(Boolean)) if (windows.length && !windows.includes(w)) return fail("bad_window", `Window must be one of: ${windows.join(" | ")}`);
    return rentalOp(env, "confirm_date", { rental_id: f.row.id, delivery_date: a.delivery_date, delivery_window: a.delivery_window, pickup_window: a.pickup_window ?? null });
  }));

  server.registerTool("reschedule_rental", {
    title: "Reschedule a tote rental",
    description: "Moves the delivery and/or pickup date or window of a booked rental. confirm=false previews the fees per the signed terms (customer-requested changes inside the notice window, expedited pickups); confirm=true applies the change, checks totes are free, adds any fee to the balance and texts the customer.",
    inputSchema: { rental: ref, delivery_date: DATE3.optional(), delivery_window: external_exports.string().optional(), pickup_date: DATE3.optional(), pickup_window: external_exports.string().optional(), customer_requested: external_exports.boolean().default(false), expedited: external_exports.boolean().default(false).describe("Customer asked for an earlier pickup"), confirm: external_exports.boolean().default(false) }
  }, guarded(async (a) => { const f = await findRental(dbc, a.rental); if (f.err) return f.err; return rentalOp(env, "reschedule", { rental_id: f.row.id, delivery_date: a.delivery_date, delivery_window: a.delivery_window, pickup_date: a.pickup_date, pickup_window: a.pickup_window, customer_requested: a.customer_requested === true, expedited: a.expedited === true, preview: a.confirm !== true }); }));

  server.registerTool("record_failed_trip", {
    title: "Record a missed delivery or pickup",
    description: "Nobody home: kind=delivery adds a second trip at the zone delivery rate to the pickup charge (per the signed terms); kind=pickup has no fee. Texts the customer to pick a new time. confirm must be true.",
    inputSchema: { rental: ref, kind: external_exports.enum(["delivery", "pickup"]), note: external_exports.string().optional(), confirm: external_exports.boolean().default(false) }
  }, guarded(async (a) => { if (!a.confirm) return fail("confirm_required", "Set confirm=true to record the missed trip."); const f = await findRental(dbc, a.rental); if (f.err) return f.err; return rentalOp(env, "failed_trip", { rental_id: f.row.id, kind: a.kind, note: a.note }); }));

  server.registerTool("close_rental", {
    title: "Close a returned rental",
    description: "Marks a returned rental closed once every tote is checked in and nothing is owed. If something is still owed or out, it stays open (status inspected); run settle_rental to charge what is owed, which also closes it.",
    inputSchema: { rental: ref }
  }, guarded(async (a) => { const f = await findRental(dbc, a.rental); if (f.err) return f.err; return rentalOp(env, "close", { rental_id: f.row.id }); }));

  server.registerTool("list_rental_assets", {'''
rep('\n  server.registerTool("list_rental_assets", {', NEW)

open(out, 'w').write(s)
print('fails:', fails)
