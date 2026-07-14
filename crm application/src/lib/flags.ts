/**
 * Central feature flags. Everything new ships behind a flag that is OFF in
 * production until the matching env var is set. Client-visible flags must be
 * prefixed NEXT_PUBLIC_. Nothing here changes behavior until a flag is enabled.
 *
 * Batch-release model: code lands dark, migrations run, then flags flip on.
 */
const on = (v: string | undefined) => v === '1' || v === 'true';

/** Client + server readable (NEXT_PUBLIC_*). Safe to import anywhere. */
export const flags = {
  payments: on(process.env.NEXT_PUBLIC_FF_PAYMENTS),       // deposits + record-payment / balance due
  stripe: on(process.env.NEXT_PUBLIC_FF_STRIPE),           // online card pay — also needs STRIPE_SECRET_KEY
  priceBook: on(process.env.NEXT_PUBLIC_FF_PRICE_BOOK),    // saved service items for fast quoting
  recurring: on(process.env.NEXT_PUBLIC_FF_RECURRING),     // recurring jobs / maintenance plans
  sms: on(process.env.NEXT_PUBLIC_FF_SMS),                 // text quote/invoice links — also needs Twilio creds
  accounting: on(process.env.NEXT_PUBLIC_FF_ACCOUNTING),   // double-entry books + bank reconciliation (needs migration 0018)
} as const;

/** Server-only gates (never exposed to the client bundle). */
export const serverFlags = {
  stripe: !!process.env.STRIPE_SECRET_KEY,
  twilio: !!(process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_ACCOUNT_SID),
  recurring: on(process.env.FF_RECURRING),
} as const;

export type FlagKey = keyof typeof flags;
