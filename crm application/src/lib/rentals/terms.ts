import { money, fmtDate, type Rental, type Settings } from './ops';

export const AUTHORIZATION_CLAUSE = `CARD AUTHORIZATION. I authorize Sanchez Junk & Haul Co. to charge the card I saved at booking for any rental extensions I request, late returns billed by the week after the grace period as described above, and any missing, damaged or excessively dirty items at the replacement, damage and cleaning rates listed above, after the rental ends. I will get a text and email receipt for every charge. This authorization stays in effect until every item is returned and the rental is closed.`;

export const DEFAULT_TERMS = `Sanchez Tote Rentals, a division of Sanchez Junk & Haul Co. Rental Terms

Rental {rental_number}: {totes} totes{addons} delivered {delivery_date} and picked up {pickup_date}.

1. Rental period. The totes are yours from delivery through the pickup date. Need longer? Extend by the week from your rental page, subject to availability; extra weeks are charged to your card on file at the package's extra week rate.
2. Late returns. If the totes are not ready on the pickup date you get a two day grace period. After that the next week is billed automatically at the extra week rate, and again each week until pickup.
3. Missing or damaged items. Counted at pickup with you or by photo. Missing tote {replacement_fee_per_tote} each. Missing lid {lid_fee} each. Tote damaged beyond use (cracked or crushed) {damage_fee_per_tote} each. Returned dirty inside (food, liquids, mud) {cleaning_fee_per_tote} cleaning fee per tote, waived once. Missing tote dolly {replacement_fee_per_dolly}; hand truck $75; furniture dolly $25; moving blanket $12 each. Normal wear, scuffs and marker are expected and free.
4. Payment. The full rental price is paid when you book. We save your card in case totes go missing or the rental runs late, and we text you a photo before any post rental charge. You get a text and email receipt for every charge.
5. Cancellation. Free {cancel_hours} or more hours before delivery. Inside that window a $25 fee is kept. After delivery, half of the package price is kept. Refunds go to the original card within five business days.
6. Delivery and pickup. Someone 18 or older must be present, or the totes must be left where we agreed. If we arrive and cannot deliver we come back once for free; after that a {failed_trip_fee} trip fee applies. A missed pickup (totes not accessible) is a {failed_trip_fee} re-trip. Pickup reschedules with a day's notice are free.
7. Use. Totes are rented as containers only; we are not responsible for what you put in them. Household moving only. No hazardous materials: gas, propane, paint, oil, chemicals, batteries, liquids, food waste or live animals. Max 75 lb per tote. Lids must snap shut. Stack 4 high at most.
8. Responsibility. You are responsible for the totes and gear from delivery until we pick them up, including theft and weather damage.`;

export function renderTerms(s: Settings, r: Rental, addonsLabel: string): { text: string; version: number } {
  const base = (s.terms_text && s.terms_text.trim()) || DEFAULT_TERMS;
  const fee = (v: number | null | undefined) => (v == null ? 'the amount listed on our rental page' : money(v));   // blank fee = not set yet, never "$0.00"
  const vars: Record<string, string> = {
    rental_number: r.rental_number, totes: String(r.tote_count), addons: addonsLabel ? ` plus ${addonsLabel}` : '',
    delivery_date: fmtDate(r.delivery_date), pickup_date: fmtDate(r.pickup_date),
    late_fee_per_day: fee(s.late_fee_per_day), replacement_fee_per_tote: fee(s.replacement_fee_per_tote), replacement_fee_per_dolly: fee(s.replacement_fee_per_dolly),
    cleaning_fee_per_tote: fee(s.cleaning_fee_per_tote), damage_fee_per_tote: fee(s.damage_fee_per_tote), deposit: money(r.deposit_amount),
    cancel_hours: String(s.cancel_full_refund_hours), failed_trip_fee: fee(s.failed_trip_fee), lid_fee: fee(s.lid_fee as number | null),
  };
  let text = base.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  if (!/CARD AUTHORIZATION/i.test(text)) text += `\n\n${AUTHORIZATION_CLAUSE}`;
  return { text, version: s.terms_version };
}
