/**
 * Reconciliation matching engine.
 *
 * Suggests matches between an imported bank transaction and existing journal
 * entries that touch the cash account. Source-agnostic: it works on the
 * normalized bank txn shape and a list of candidate cash-lines, so it is
 * unchanged whether transactions came from CSV, OFX, or a future Plaid feed.
 *
 * Cash-side convention:
 *   bank CREDIT (money in)  ↔ journal DEBIT to cash  (Dr Cash)
 *   bank DEBIT  (money out) ↔ journal CREDIT to cash (Cr Cash)
 */
import type { BankTxnDirection } from './types';

export interface CashLineCandidate {
  entryId: string;
  lineId: string;
  entryDate: string;   // YYYY-MM-DD
  debit: number;       // debit to cash on this line
  credit: number;      // credit to cash on this line
  memo: string;        // entry memo / line memo / counterparty text
}

export interface BankTxnLike {
  postedDate: string;
  amount: number;              // magnitude
  direction: BankTxnDirection;
  description: string;
}

export interface Suggestion extends CashLineCandidate {
  score: number;               // 0–100
  reasons: string[];
  auto: boolean;               // safe to auto-match (unique, exact amount, close date)
}

export interface MatchOptions {
  dateWindowDays?: number;     // default 5
  amountTolerance?: number;    // default 0.005
}

const STOP = new Set(['the', 'and', 'llc', 'inc', 'co', 'payment', 'pmt', 'ach', 'deposit', 'debit', 'credit', 'card', 'purchase', 'pos', 'transaction']);

function tokens(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(a + 'T00:00:00').getTime() - new Date(b + 'T00:00:00').getTime());
  return Math.round(ms / 86_400_000);
}

/** Score one candidate against one bank txn. Returns null if amount/side mismatch. */
export function scoreCandidate(
  txn: BankTxnLike,
  cand: CashLineCandidate,
  opts: MatchOptions = {},
): Suggestion | null {
  const tol = opts.amountTolerance ?? 0.005;
  const win = opts.dateWindowDays ?? 5;

  // The bank direction dictates which side of the cash line must carry the amount.
  const cashAmount = txn.direction === 'credit' ? cand.debit : cand.credit;
  if (cashAmount <= 0) return null;
  if (Math.abs(cashAmount - txn.amount) > tol) return null; // amount is a hard gate

  const reasons: string[] = ['Amount matches exactly'];
  let score = 60;

  const dd = daysBetween(txn.postedDate, cand.entryDate);
  if (dd === 0) { score += 25; reasons.push('Same date'); }
  else if (dd <= win) { score += Math.round(25 * (1 - dd / win)); reasons.push(`${dd} day${dd > 1 ? 's' : ''} apart`); }
  else { score -= Math.min(20, dd); reasons.push(`${dd} days apart`); }

  const bt = new Set(tokens(txn.description));
  const ct = tokens(cand.memo);
  const overlap = ct.filter((t) => bt.has(t));
  if (overlap.length) { score += Math.min(15, overlap.length * 6); reasons.push(`Description: ${overlap.slice(0, 3).join(', ')}`); }

  score = Math.max(0, Math.min(100, score));
  return { ...cand, score, reasons, auto: false };
}

/** Rank all candidates for a bank txn, best first. */
export function suggestMatches(
  txn: BankTxnLike,
  candidates: CashLineCandidate[],
  opts: MatchOptions = {},
): Suggestion[] {
  const scored = candidates
    .map((c) => scoreCandidate(txn, c, opts))
    .filter((s): s is Suggestion => s !== null)
    .sort((a, b) => b.score - a.score);

  // Auto-match only when there is a single strong candidate within the date window.
  const win = opts.dateWindowDays ?? 5;
  if (scored.length >= 1) {
    const top = scored[0];
    const closeEnough = daysBetween(txn.postedDate, top.entryDate) <= win;
    const unique = scored.length === 1 || scored[1].score < top.score - 15;
    if (closeEnough && unique && top.score >= 80) top.auto = true;
  }
  return scored;
}
