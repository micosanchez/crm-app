/**
 * Customer messages for Rentals (business plan section 13/14). Texts never list prices or totals; they link to the
 * rental page. Transactional texts go to everyone who booked (the number was given for the booking); promotional
 * ones only to customers who ticked the separate marketing box. Max six texts per rental, enforced in sendDueMessages.
 * Each template can be overridden and switched off in Rentals > Settings (rental_settings.templates).
 * Copy rules: friendly, simple, no em dashes, contractions, digits, no hashtags.
 */
export type RentalTemplateKey =
  | 'booking_confirmed' | 'delivery_reminder' | 'on_my_way' | 'delivered' | 'during_rental' | 'pickup_reminder' | 'after_pickup' | 'referral'
  | 'overdue_1' | 'overdue_3' | 'receipt' | 'payment_failed' | 'card_expiring' | 'abandoned' | 'waitlist_open' | 'reschedule' | 'failed_trip' | 'failed_trip_free';

export interface TemplateDef { label: string; enabled: boolean; kind: 'transactional' | 'promotional'; sms: string; email_subject?: string; email?: string }

export const VARS = ['first_name', 'rental_number', 'totes', 'delivery_date', 'delivery_window', 'pickup_date', 'pickup_window', 'link', 'receipt_link', 'pay_link', 'card_link', 'junk_link', 'junk_offer', 'review_link', 'window'];

const SIGN = 'Sanchez Junk & Haul Co.';

export const DEFAULT_TEMPLATES: Record<RentalTemplateKey, TemplateDef> = {
  booking_confirmed: { label: 'Booked (payment succeeded)', enabled: true, kind: 'transactional',
    sms: `You're booked! {totes} totes arrive {delivery_date} between {delivery_window}. Your rental page: {link} {junk_offer} Reply STOP to opt out.`,
    email_subject: 'Your tote rental {rental_number} is booked', email: `Hi {first_name},\n\nYou're booked. {totes} totes arrive {delivery_date} during {delivery_window}, and we pick them up {pickup_date}.\n\nEverything about your rental, including your signed agreement and receipts, lives here: {link}\n\nTote renters get $25 off any ${SIGN} junk removal job of $250 or more, booked during the rental or within 7 days after pickup. No code needed, we match it to your rental: {junk_link}\n\nQuestions? Reply to this email or text 734-537-8061.\n\n${SIGN}` },
  delivery_reminder: { label: 'Day before delivery (5 pm)', enabled: true, kind: 'transactional', sms: `See you tomorrow {delivery_window}. Please leave a clear spot by the door or garage. Questions? Just reply.` },
  on_my_way: { label: 'On my way', enabled: true, kind: 'transactional', sms: `Hi {first_name}, ${SIGN} here. We're on our way with your totes and should be there shortly.` },
  delivered: { label: 'Delivered', enabled: true, kind: 'transactional', sms: `Your totes are delivered! Pack heavy stuff on the bottom, lids snap shut, and stack them 4 high max. Pickup is {pickup_date}. {link}` },
  during_rental: { label: 'During the rental (move date plus 2 days, 6 pm; delivery plus 3 days when no move date)', enabled: true, kind: 'promotional', sms: `How's the move going? If anything didn't make the cut, snap a photo and reply. We'll send a free quote, $25 off. {junk_link}`,
    email_subject: `Anything that didn't make the move? $25 off junk removal`, email: `Hi {first_name},\n\nHow's the move going? If anything didn't make the cut, like old furniture, a mattress, a broken dresser or a garage full of odds and ends, we'll haul it away.\n\nAs a tote renter you get $25 off any junk removal job of $250 or more, booked during your rental or within 7 days after pickup. We can even take it the same day we pick up your totes.\n\nGet a free quote (a photo is all we need): {junk_link}\nOr call or text 734-537-8061.\n\nThanks,\n${SIGN}\n\n--\nYou're getting this because you said yes to offers when you booked totes. Unsubscribe: {unsubscribe_link}\n${SIGN}{mailing_address_line}` },
  pickup_reminder: { label: 'Day before pickup (5 pm)', enabled: true, kind: 'transactional', sms: `Pickup is tomorrow {pickup_window}. Stack the empty totes and lids where we can reach them. Anything left you want gone? Reply YES.`,
    email_subject: 'Tote pickup tomorrow, {pickup_window}', email: `Hi {first_name},\n\nWe're picking up your totes for rental {rental_number} tomorrow, {pickup_date}, {pickup_window}. Please stack the empty totes and lids where we can reach them. You don't need to be home.\n\nNeed another week? Extend from your rental page before pickup: {link}\n\nP.S. Anything left over you want gone? We can haul it on the same trip, and tote renters get $25 off junk removal jobs of $250 or more. Free quote: {junk_link}\n\n${SIGN} · 734-537-8061` },
  after_pickup: { label: 'Day after pickup (10 am): thanks + review', enabled: true, kind: 'transactional', sms: `All set, thanks for renting with ${SIGN}! Mind leaving a quick review? {review_link}`,
    email_subject: `Thanks for renting with ${SIGN}`, email: `Hi {first_name},\n\nYour totes are back with us and rental {rental_number} is wrapped up. Your receipts are here: {link}\n\nIf the move went smoothly, a quick Google review helps a small local business a lot: {review_link}\n\nP.S. Your $25 off junk removal (jobs of $250 or more) is good for 7 days after pickup. Free quote: {junk_link}\n\n${SIGN} · 734-537-8061` },
  referral: { label: 'Referral ask (pickup plus 7 days, 6 pm)', enabled: true, kind: 'promotional', sms: `Know someone moving? Send them our way. They get $15 off totes, you get $15 back. Just have them mention your name when they book.` },
  overdue_1: { label: 'Overdue day 1', enabled: true, kind: 'transactional', sms: `Hi {first_name}, your totes were due for pickup {pickup_date}. There is no grace period, so the rental has rolled into another week at your package's extra week rate. Reply with a time that works and we'll come get them: {link}` },
  overdue_3: { label: 'Overdue day 3', enabled: true, kind: 'transactional', sms: `Hi {first_name}, tote rental {rental_number} is still out past {pickup_date}. Each extra week is billed at your package's extra week rate until pickup, per your agreement. Please reply today to schedule pickup: {link}` },
  receipt: { label: 'Receipt after a charge', enabled: true, kind: 'transactional', sms: `${SIGN}: a charge was made to your card on file for rental {rental_number}. Itemized receipt with photos: {receipt_link}`,
    email_subject: 'Receipt for tote rental {rental_number}', email: `Hi {first_name},\n\nHere's your itemized receipt for rental {rental_number}: {receipt_link}\n\nQuestions? Reply to this email or text 734-537-8061.\n\n${SIGN}` },
  payment_failed: { label: 'Payment failed', enabled: true, kind: 'transactional', sms: `Hi {first_name}, a payment for your tote rental {rental_number} didn't go through. Pay securely here: {pay_link}` },
  card_expiring: { label: 'Card expiring before pickup', enabled: true, kind: 'transactional', sms: `Hi {first_name}, the card on your tote rental expires before your pickup date. Update it in a minute here: {card_link}` },
  abandoned: { label: 'Abandoned booking (one text)', enabled: true, kind: 'promotional', sms: `Hi {first_name}, ${SIGN} here. Your tote booking didn't finish. Pick it back up here whenever you're ready: {link}` },
  waitlist_open: { label: 'Waitlist: dates opened', enabled: true, kind: 'transactional', sms: `Hi {first_name}, good news from ${SIGN}: totes just opened up for your dates. Book here before they go: {link}` },
  reschedule: { label: 'Rescheduled', enabled: true, kind: 'transactional', sms: `Hi {first_name}, your tote rental {rental_number} is rescheduled: {window}. Details: {link}` },
  failed_trip_free: { label: 'Missed delivery, first one (no fee)', enabled: true, kind: 'transactional', sms: `Hi {first_name}, we came by with your totes but couldn't complete the delivery. No charge this time. Pick a new time here or just reply with one that works: {link}` },
  failed_trip: { label: 'Failed trip', enabled: true, kind: 'transactional', sms: `Hi {first_name}, we came by for your totes but couldn't complete the stop. A trip fee applies per your agreement. Pick a new time here: {link}` },
};

export function renderRental(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])))// collapse runs of spaces left by empty vars, but keep line breaks so emails keep their paragraphs
    .replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim();
}

export function mergedTemplates(overrides: Record<string, Partial<TemplateDef>> | null | undefined): Record<RentalTemplateKey, TemplateDef> {
  const out = { ...DEFAULT_TEMPLATES };
  for (const k of Object.keys(out) as RentalTemplateKey[]) if (overrides?.[k]) out[k] = { ...out[k], ...overrides[k] };
  return out;
}
