import { money, fmtDate, type Rental, type Settings } from './ops';

export const AUTHORIZATION_CLAUSE = `CARD AUTHORIZATION. I authorize Sanchez Junk & Haul Co. to charge the card I saved at booking for any rental extensions I request, late returns at the late fee per day listed above, and any missing, damaged or excessively dirty items at the replacement, damage and cleaning rates listed above, after the rental ends. I will get a text and email receipt for every charge. This authorization stays in effect until every item is returned and the rental is closed.`;

export const DEFAULT_TERMS = `Sanchez Junk & Haul Co. Tote Rental Terms

Rental {rental_number}: {totes} totes{addons} delivered {delivery_date} and picked up {pickup_date}.

1. Rental period. The totes are yours from delivery through the pickup date. Need longer? Extend by the week from your rental page; extra weeks are charged to your card on file.
2. Late returns. If the totes are not ready for pickup on the pickup date, a late fee of {late_fee_per_day} per day applies until they are picked up.
3. Missing or damaged items. A replacement fee of {replacement_fee_per_tote} per tote and {replacement_fee_per_dolly} per dolly applies to items not returned. Damaged items (cracked, broken lids, melted, chemical damage) are charged {damage_fee_per_tote} each. Totes returned dirty inside are charged {cleaning_fee_per_tote} each for cleaning.
4. Payment. The full rental price is paid when you book. Your card stays on file, as authorized below, for extensions and for any fees after pickup.
5. Cancellation. Cancel {cancel_hours} or more hours before delivery for a full refund. Inside that window the payment is not refunded, but you can move your dates at no charge.
6. Delivery and pickup. Someone 18 or older must be present, or the totes must be left where we agreed. If we arrive and cannot complete the stop, a failed trip fee of {failed_trip_fee} applies and we reschedule.
7. Use. Totes are for household moving only. No hazardous materials, liquids, food waste or live animals. Max 50 lb per tote. Lids must snap shut.
8. Responsibility. You are responsible for the items from delivery until we pick them up, including theft or weather damage.`;

export function renderTerms(s: Settings, r: Rental, addonsLabel: string): { text: string; version: number } {
  const base = (s.terms_text && s.terms_text.trim()) || DEFAULT_TERMS;
  const fee = (v: number | null | undefined) => (v == null ? 'the amount listed on our rental page' : money(v));   // blank fee = not set yet, never "$0.00"
  const vars: Record<string, string> = {
    rental_number: r.rental_number, totes: String(r.tote_count), addons: addonsLabel ? ` plus ${addonsLabel}` : '',
    delivery_date: fmtDate(r.delivery_date), pickup_date: fmtDate(r.pickup_date),
    late_fee_per_day: fee(s.late_fee_per_day), replacement_fee_per_tote: fee(s.replacement_fee_per_tote), replacement_fee_per_dolly: fee(s.replacement_fee_per_dolly),
    cleaning_fee_per_tote: fee(s.cleaning_fee_per_tote), damage_fee_per_tote: fee(s.damage_fee_per_tote), deposit: money(r.deposit_amount),
    cancel_hours: String(s.cancel_full_refund_hours), failed_trip_fee: fee(s.failed_trip_fee),
  };
  let text = base.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  if (!/CARD AUTHORIZATION/i.test(text)) text += `\n\n${AUTHORIZATION_CLAUSE}`;
  return { text, version: s.terms_version };
}
