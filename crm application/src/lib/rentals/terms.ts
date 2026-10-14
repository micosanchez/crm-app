import { money, fmtDate, type Rental, type Settings } from './ops';

export const AUTHORIZATION_CLAUSE = `CARD AUTHORIZATION. I authorize Sanchez Junk & Haul Co. to charge the card I saved at booking for any rental extensions I request, late returns billed by the full week as described above (there is no grace period), expedited early pickups or delivery date changes I request at the fees listed above, and any missing, damaged or excessively dirty items at the replacement, damage and cleaning rates listed above. I will get a text and email receipt for every charge. This authorization stays in effect until every item is returned and the rental is closed.`;

export const DEFAULT_TERMS = `Sanchez Tote Rentals, a division of Sanchez Junk & Haul Co. Rental Terms

Rental {rental_number}: {totes} totes{addons} delivered {delivery_date} and picked up {pickup_date}.

1. Rental period. The totes are yours from delivery through the pickup date, the exact number of days in your package (14 days for standard packages). Need longer? Extend by the week from your rental page, subject to availability; extra weeks are charged to your card on file at the package's extra week rate. There are no free extra days and no daily proration.
2. Late returns. There is no grace period. If the totes are not ready for pickup by the scheduled pickup date, the rental is extended by one full week at the package's extra week rate, and again for each further week until pickup. You are never charged for a delay caused by us, such as a pickup we could not make.
3. Early pickup. Finished early? Ask for an earlier pickup. If it fits our normal schedule there is no charge. An expedited pickup that needs a special trip is {expedited_pickup_fee}, only when you ask for it and we confirm it. Returning early does not earn a partial refund.
4. Missing, damaged or dirty items. Counted at pickup with you or by photo. Missing tote {replacement_fee_per_tote} each. Missing lid {lid_fee} each. Tote damaged beyond reasonable use (cracked or crushed) {damage_fee_per_tote} each. Tote returned excessively dirty and needing cleaning beyond our normal post rental cleaning (food, liquids, mud) {cleaning_fee_per_tote} per tote. A tote is charged one of these fees at most, never both for the same condition. Missing equipment is charged at its replacement fee: standard hand truck $75, furniture dolly $25, convertible hand truck at its replacement cost. Normal wear and tear, dust, scuffs and marker are expected and free.
5. Payment. The full rental price is paid when you book. We save your card in case totes go missing or the rental runs late, and we text you a photo before any post rental charge. You get a text and email receipt for every charge.
6. Cancellations and delivery date changes. Free with at least {cancel_hours} hours' notice before your scheduled delivery window (exactly {cancel_hours} hours counts). With less notice, cancelling costs {cancel_fee} and changing the delivery date costs {reschedule_fee}. After delivery, extra time is billed as a weekly extension and a cancellation keeps half of the package price. Refunds go to the original card within five business days.
7. Delivery and pickup. Someone 18 or older must be present, or the totes must be left where we agreed. If we arrive and cannot deliver we come back once for free; after that a {failed_trip_fee} trip fee applies. A missed pickup (totes not accessible) is a {failed_trip_fee} re-trip, and the late return terms above apply.
8. Use. Totes are rented as containers only; we are not responsible for what you put in them. Household moving only. No hazardous materials: gas, propane, paint, oil, chemicals, batteries, liquids, food waste or live animals. Max 75 lb per tote. Lids must snap shut. Stack 4 high at most.
9. Responsibility. You are responsible for the totes and gear from delivery until we pick them up, including theft and weather damage.`;

export function renderTerms(s: Settings, r: Rental, addonsLabel: string): { text: string; version: number } {
  const base = (s.terms_text && s.terms_text.trim()) || DEFAULT_TERMS;
  const fee = (v: number | null | undefined) => (v == null ? 'the amount listed on our rental page' : money(v));   // blank fee = not set yet, never "$0.00"
  const vars: Record<string, string> = {
    rental_number: r.rental_number, totes: String(r.tote_count), addons: addonsLabel ? ` plus ${addonsLabel}` : '',
    delivery_date: fmtDate(r.delivery_date), pickup_date: fmtDate(r.pickup_date),
    late_fee_per_day: fee(s.late_fee_per_day), replacement_fee_per_tote: fee(s.replacement_fee_per_tote), replacement_fee_per_dolly: fee(s.replacement_fee_per_dolly),
    cleaning_fee_per_tote: fee(s.cleaning_fee_per_tote), damage_fee_per_tote: fee(s.damage_fee_per_tote), deposit: money(r.deposit_amount),
    cancel_hours: String(s.cancel_full_refund_hours), failed_trip_fee: fee(s.failed_trip_fee), lid_fee: fee(s.lid_fee as number | null),
    cancel_fee: fee(s.cancel_fee_inside_window), reschedule_fee: fee(s.reschedule_fee_inside_window), expedited_pickup_fee: fee(s.expedited_pickup_fee),
  };
  let text = base.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  if (!/CARD AUTHORIZATION/i.test(text)) text += `\n\n${AUTHORIZATION_CLAUSE}`;
  return { text, version: s.terms_version };
}
