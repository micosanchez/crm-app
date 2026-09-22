/**
 * Financial definitions — the single place the app decides what a number means.
 * Every page that shows revenue, outstanding balances or quote conversion must
 * derive it from here so the Dashboard, Money, Invoices, Reports and Customer
 * screens can never disagree.
 *
 * Definitions (cash basis, as the Money page has always stated):
 *   collected   = total of PAID invoices, by paid_at, excluding voided
 *   outstanding = total − amount_paid of SENT invoices (drafts are not bills yet,
 *                 paid ones owe nothing), excluding voided
 *   quote conversion = accepted ÷ (sent + accepted + declined + expired);
 *                 drafts haven't been offered and cancelled quotes never count
 *                 against the close rate (the estimate screen promises this)
 */

export interface MoneyInvoice {
  status: string;
  total: number | string;
  amount_paid?: number | string | null;
  voided_at?: string | null;
}

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

/** A live (not voided) invoice. */
export const isLive = (i: Pick<MoneyInvoice, 'voided_at'>) => !i.voided_at;

/** What the customer still owes on one invoice. Never negative. */
export function balanceDue(i: MoneyInvoice): number {
  if (!isLive(i) || i.status === 'paid') return 0;
  return Math.max(0, n(i.total) - n(i.amount_paid));
}

/** Money actually received on one invoice. */
export function collectedOn(i: MoneyInvoice): number {
  if (!isLive(i)) return 0;
  return i.status === 'paid' ? n(i.total) : n(i.amount_paid);
}

/** Sum of paid, live invoices. */
export const sumCollected = (list: MoneyInvoice[]) =>
  list.reduce((s, i) => s + (isLive(i) && i.status === 'paid' ? n(i.total) : 0), 0);

/** Sum of balances on SENT, live invoices. */
export const sumOutstanding = (list: MoneyInvoice[]) =>
  list.reduce((s, i) => s + (i.status === 'sent' ? balanceDue(i) : 0), 0);

export type QuoteTone = 'accepted' | 'pending' | 'declined' | 'cancelled';

/** How a quote status reads on screen and whether it counts toward conversion. */
export function classifyQuote(status: string): { label: string; tone: QuoteTone; decided: boolean; offered: boolean } {
  switch (status) {
    case 'accepted': return { label: 'Accepted', tone: 'accepted', decided: true, offered: true };
    case 'declined': return { label: 'Declined', tone: 'declined', decided: true, offered: true };
    case 'expired': return { label: 'Expired', tone: 'declined', decided: true, offered: true };
    case 'cancelled': return { label: 'Cancelled', tone: 'cancelled', decided: false, offered: false };
    case 'sent': return { label: 'Pending', tone: 'pending', decided: false, offered: true };
    default: return { label: 'Draft', tone: 'pending', decided: false, offered: false };
  }
}

/** accepted ÷ offered, or null when nothing has been offered yet. */
export function quoteConversion(quotes: { status: string }[]): number | null {
  let offered = 0, accepted = 0;
  for (const q of quotes) {
    const c = classifyQuote(q.status);
    if (!c.offered) continue;
    offered++;
    if (q.status === 'accepted') accepted++;
  }
  return offered ? accepted / offered : null;
}

export const money = (v: number | string | null | undefined) => `$${Math.round(n(v)).toLocaleString('en-US')}`;
export const money2 = (v: number | string | null | undefined) =>
  `$${n(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
