/**
 * One dispatcher for every Rentals write, shared by the staff API (session auth) and the connector ops API
 * (service-key auth). Each action returns the updated record so callers echo what actually happened.
 */
import { admin, getRental, chargeRental, refundCharge, settle, recordDelivery, recordPickup, chargesReview, extendRental, reschedule, cancelRental, failedTrip, foundItem, evidencePacket, queueMessage, chargeBalance, logEvent, maybeClose, rentalLink, first, confirmDate } from './ops';
import { DEFAULT_TEMPLATES, mergedTemplates, renderRental, type RentalTemplateKey } from './templates';
import { sendText } from '@/lib/quo';
import { createHostedPaymentLink } from './stripe';
import { sendNotification } from '@/lib/notify';

export type Actor = { by: string | null };

export async function runAction(action: string, a: Record<string, any>, actor: Actor) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const db = admin();
  const id = a.rental_id as string | undefined;
  switch (action) {
    case 'charge': return chargeRental(id!, { type: a.type, amount: Number(a.amount), description: a.description, photo_urls: a.photo_urls, created_by: actor.by }, db);
    case 'charge_balance': return chargeBalance(id!, db);
    case 'refund': return refundCharge(a.charge_id, a.amount == null ? null : Number(a.amount), a.reason ?? 'refund', db);
    case 'settle': return settle(id!, db);
    case 'review': return chargesReview(id!, db);
    case 'update_line': {
      if (a.remove) await db.from('rental_charges').update({ status: 'void', description: `${a.description ?? ''} (removed)` }).eq('id', a.charge_id).in('status', ['pending', 'failed', 'requires_action']);
      else await db.from('rental_charges').update({ amount: Number(a.amount), description: a.description }).eq('id', a.charge_id).in('status', ['pending', 'failed', 'requires_action']);
      await db.rpc('rental_recompute_balance', { p_rental: id });
      return chargesReview(id!, db);
    }
    case 'add_line': {
      await db.from('rental_charges').insert({ rental_id: id, type: a.type ?? 'adjustment', amount: Number(a.amount), description: a.description ?? 'Adjustment', status: 'pending', created_by: actor.by, photo_urls: a.photo_urls ?? [] });
      return chargesReview(id!, db);
    }
    case 'confirm_date': return confirmDate(id!, { delivery_date: a.delivery_date, delivery_window: a.delivery_window, pickup_window: a.pickup_window, by: actor.by }, db);
    case 'record_delivery': return recordDelivery(id!, { tags: a.tags ?? [], photo_urls: a.photo_urls, created_by: actor.by }, db);
    case 'record_pickup': return recordPickup(id!, { items: a.items ?? [], missing_lids: Number(a.missing_lids ?? 0), created_by: actor.by }, db);
    case 'extend': return extendRental(id!, Number(a.weeks ?? 1), db);
    case 'reschedule': return reschedule(id!, { delivery_date: a.delivery_date, delivery_window: a.delivery_window, pickup_date: a.pickup_date, pickup_window: a.pickup_window, by: actor.by ?? undefined, customer_requested: !!a.customer_requested, expedited: !!a.expedited, preview: !!a.preview }, db);
    case 'junk_discount_redeem': {
      // one redemption per qualifying rental; the unique index on junk_discount_estimate_id stops reuse of the quote too
      const { data: r } = await db.from('rentals').select('id, rental_number, junk_discount_estimate_id').eq('id', id).single();
      if (!r) throw new Error('Rental not found.');
      if (r.junk_discount_estimate_id && r.junk_discount_estimate_id !== a.estimate_id) throw new Error(`${r.rental_number} already used its junk removal discount.`);
      const { error } = await db.from('rentals').update({ junk_discount_estimate_id: a.undo ? null : a.estimate_id }).eq('id', id);
      if (error) throw new Error(error.message);
      await logEvent(id!, a.undo ? 'junk_discount_undone' : 'junk_discount_redeemed', { estimate_id: a.estimate_id, by: actor.by }, db);
      return { ok: true };
    }
    case 'cancel': return cancelRental(id!, { reason: a.reason, by: actor.by ?? undefined, preview: !a.confirm }, db);
    case 'failed_trip': return failedTrip(id!, { kind: a.kind ?? 'delivery', photo_urls: a.photo_urls, note: a.note, by: actor.by ?? undefined }, db);
    case 'found_item': return foundItem(id!, a.tag, db);
    case 'close': { await maybeClose(id!, db); return getRental(id!, db); }
    case 'set_status': {
      await db.from('rentals').update({ status: a.status }).eq('id', id);
      await logEvent(id!, 'status:manual', { status: a.status, by: actor.by }, db);
      return getRental(id!, db);
    }
    case 'update': {
      const allowed = ['delivery_address', 'pickup_address', 'notes_internal', 'notes_customer', 'lead_source', 'delivery_window', 'pickup_window'];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (a[k] !== undefined) patch[k] = a[k];
      if (Object.keys(patch).length) await db.from('rentals').update(patch).eq('id', id);
      if (a.delivery_date || a.pickup_date) await reschedule(id!, { delivery_date: a.delivery_date, pickup_date: a.pickup_date, by: actor.by ?? undefined, customer_requested: !!a.customer_requested, expedited: !!a.expedited }, db);
      await logEvent(id!, 'updated', { ...patch, by: actor.by }, db);
      return getRental(id!, db);
    }
    case 'evidence': return evidencePacket(id!, db);
    case 'send_text': {
      const r = await getRental(id!, db);
      const c = r.customers!;
      let body = a.content as string | undefined;
      if (!body && a.template) {
        const s = (await db.from('rental_settings').select('templates').eq('id', true).single()).data?.templates;
        const t = mergedTemplates(s)[a.template as RentalTemplateKey] ?? DEFAULT_TEMPLATES[a.template as RentalTemplateKey];
        if (!t) throw new Error(`Unknown template ${a.template}`);
        body = renderRental(t.sms, { first_name: first(c.name), rental_number: r.rental_number, delivery_date: r.delivery_date, delivery_window: r.delivery_window, pickup_date: r.pickup_date, pickup_window: r.pickup_window ?? '', link: rentalLink(r), receipt_link: `${rentalLink(r)}/receipt`, card_link: `${rentalLink(r)}/card`, window: a.window ?? '', pay_link: a.pay_link ?? '', totes: r.tote_count });
      }
      if (!body || !c.phone) throw new Error('Nothing to send or no phone on file.');
      const res = await sendText({ to: c.phone, content: body, event: `sms:rental_${a.template ?? 'manual'}`, entityKind: 'rental', entityId: r.id });
      await logEvent(r.id, `sms:${a.template ?? 'manual'}`, { ok: res.ok, error: res.error, by: actor.by }, db);
      if (!res.ok) throw new Error(res.error ?? res.skipped ?? 'text failed');
      return { ok: true, sent: body };
    }
    case 'send_payment_link': {
      const r = await getRental(id!, db);
      const { data: ch } = await db.from('rental_charges').select('*').eq('id', a.charge_id).single();
      if (!ch || !r.stripe_customer_id) throw new Error('Charge or Stripe customer missing.');
      const link = ch.payment_link_url ?? await createHostedPaymentLink({ cents: Math.round(Number(ch.amount) * 100), description: `Tote rental ${r.rental_number}: ${ch.description ?? ch.type}`, rental_id: r.id, charge_id: ch.id, customer: r.stripe_customer_id });
      await db.from('rental_charges').update({ payment_link_url: link }).eq('id', ch.id);
      await queueMessage(r, 'payment_failed', { pay_link: link }, { dedupe: `${r.id}:paylink:${ch.id}:${Date.now()}`, force: true }, db);
      return { ok: true, link };
    }
    case 'update_card_link': {
      const r = await getRental(id!, db);
      await queueMessage(r, 'card_expiring', {}, { dedupe: `${r.id}:card_link:${Date.now()}`, force: true }, db);
      return { ok: true, link: `${rentalLink(r)}/card` };
    }
    case 'update_asset': {
      const patch: Record<string, unknown> = {};
      if (a.status) patch.status = a.status;
      if (a.condition_notes !== undefined) patch.condition_notes = a.condition_notes;
      if (a.purchase_cost !== undefined) patch.purchase_cost = a.purchase_cost;
      if (a.purchase_date !== undefined) patch.purchase_date = a.purchase_date;
      const { data, error } = await db.from('rental_assets').update(patch).eq(a.asset_id ? 'id' : 'asset_tag', a.asset_id ?? a.asset_tag).select('*').single();
      if (error) throw new Error(error.message);
      return data;
    }
    case 'bulk_add_assets': {
      const rows = (a.tags as string[]).map((t) => ({ asset_tag: t, asset_type: a.asset_type ?? 'tote', purchase_cost: a.purchase_cost ?? null, purchase_date: a.purchase_date ?? null }));
      const { data, error } = await db.from('rental_assets').upsert(rows, { onConflict: 'asset_tag', ignoreDuplicates: true }).select('asset_tag');
      if (error) throw new Error(error.message);
      return { added: data?.length ?? 0 };
    }
    case 'notify_owner': { await sendNotification({ event: 'rental_note', to: process.env.NOTIFY_EMAIL ?? '', subject: a.subject ?? 'Rental note', text: a.text ?? '' }); return { ok: true }; }
    default: throw new Error(`Unknown action: ${action}`);
  }
}
