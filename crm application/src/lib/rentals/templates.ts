/**
 * Customer messages for Rentals. Texts never list prices or totals; they link to the rental page or receipt.
 * Each template can be overridden and switched off in Rentals > Settings (rental_settings.templates).
 * Copy rules: friendly, simple, no em dashes, contractions, digits, no hashtags.
 */
export type RentalTemplateKey =
  | 'booking_confirmed' | 'delivery_reminder' | 'on_my_way' | 'delivered' | 'pickup_reminder_2d' | 'pickup_day'
  | 'overdue_1' | 'overdue_3' | 'receipt' | 'payment_failed' | 'card_expiring' | 'closed' | 'abandoned' | 'waitlist_open' | 'reschedule' | 'failed_trip';

export interface TemplateDef { label: string; enabled: boolean; sms: string; email_subject?: string; email?: string }

export const VARS = ['first_name', 'rental_number', 'delivery_date', 'delivery_window', 'pickup_date', 'pickup_window', 'link', 'receipt_link', 'pay_link', 'card_link', 'junk_link', 'review_link', 'totes', 'window'];

const SIGN = 'Sanchez Junk & Haul';

export const DEFAULT_TEMPLATES: Record<RentalTemplateKey, TemplateDef> = {
  booking_confirmed: { label: 'Booking confirmed', enabled: true,
    sms: `Hi {first_name}, you're booked with ${SIGN} Totes. Delivery {delivery_date} ({delivery_window}), pickup {pickup_date}. Your rental page: {link}`,
    email_subject: 'Your tote rental {rental_number} is booked', email: `Hi {first_name},\n\nYou're booked. {totes} totes arrive {delivery_date} during {delivery_window}, and we pick them up {pickup_date}.\n\nEverything about your rental, including your signed agreement and receipts, lives here: {link}\n\nMoving soon and have stuff that won't go in a tote? Old furniture, mattresses, boxes you're not taking: we haul it away. Get a junk removal quote: {junk_link}\n\nThanks,\n${SIGN}` },
  delivery_reminder: { label: 'Day before delivery', enabled: true, sms: `Hi {first_name}, ${SIGN} Totes here. Your totes arrive tomorrow ({delivery_date}) between {delivery_window}. Details: {link}` },
  on_my_way: { label: 'On my way', enabled: true, sms: `Hi {first_name}, ${SIGN} here. We're on our way with your totes and should be there shortly.` },
  delivered: { label: 'Delivered', enabled: true, sms: `Your totes are delivered! Pack heavy stuff on the bottom, lids snap shut, and stack them 4 high max. Pickup is {pickup_date}. Need more time or a junk removal quote? {link}` },
  pickup_reminder_2d: { label: '2 days before pickup', enabled: true, sms: `Hi {first_name}, we pick up your totes {pickup_date}. Please have them empty and stacked. Need more time or a quote for anything you're tossing? {link}` },
  pickup_day: { label: 'Pickup day', enabled: true, sms: `Hi {first_name}, ${SIGN} picks up your totes today between {pickup_window}. Please have them empty and stacked where we can reach them. {link}` },
  overdue_1: { label: 'Overdue day 1', enabled: true, sms: `Hi {first_name}, your totes were due back {pickup_date}. Late fees apply per your agreement. Pick a pickup time here: {link}` },
  overdue_3: { label: 'Overdue day 3', enabled: true, sms: `Hi {first_name}, your tote rental {rental_number} is 3 days overdue and late fees keep adding up per your agreement. Please schedule pickup today: {link}` },
  receipt: { label: 'Receipt after a charge', enabled: true, sms: `${SIGN} Totes: a charge was made to your card on file for rental {rental_number}. Itemized receipt with photos: {receipt_link}`,
    email_subject: 'Receipt for tote rental {rental_number}', email: `Hi {first_name},\n\nHere's your itemized receipt for rental {rental_number}: {receipt_link}\n\nQuestions? Reply to this email or text 734-537-8061.\n\n${SIGN}` },
  payment_failed: { label: 'Payment failed', enabled: true, sms: `Hi {first_name}, a payment for your tote rental {rental_number} didn't go through. Pay securely here: {pay_link}` },
  card_expiring: { label: 'Card expiring before pickup', enabled: true, sms: `Hi {first_name}, the card on your tote rental expires before your pickup date. Update it in 1 minute here: {card_link}` },
  closed: { label: 'Closed / thank you', enabled: true, sms: `Thanks for renting with ${SIGN} Totes, {first_name}! If you've got a minute, a review helps a lot: {review_link}. And remember, we do junk removal too.` },
  abandoned: { label: 'Abandoned booking (1 text)', enabled: true, sms: `Hi {first_name}, ${SIGN} Totes here. Your tote booking didn't finish. Pick it back up here whenever you're ready: {link}` },
  waitlist_open: { label: 'Waitlist: dates opened', enabled: true, sms: `Hi {first_name}, good news from ${SIGN} Totes: totes just opened up for your dates. Book here before they go: {link}` },
  reschedule: { label: 'Rescheduled', enabled: true, sms: `Hi {first_name}, your tote rental {rental_number} is rescheduled: {window}. Details: {link}` },
  failed_trip: { label: 'Failed trip', enabled: true, sms: `Hi {first_name}, we came by for your totes but couldn't complete the stop. A trip fee applies per your agreement. Pick a new time here: {link}` },
};

export function renderRental(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k]))).replace(/\s{2,}/g, ' ').trim();
}

export function mergedTemplates(overrides: Record<string, Partial<TemplateDef>> | null | undefined): Record<RentalTemplateKey, TemplateDef> {
  const out = { ...DEFAULT_TEMPLATES };
  for (const k of Object.keys(out) as RentalTemplateKey[]) if (overrides?.[k]) out[k] = { ...out[k], ...overrides[k] };
  return out;
}
