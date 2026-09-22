/**
 * Date helpers pinned to the business's time zone.
 *
 * The CRM serves one company in Downriver Michigan. Server code (Netlify
 * functions) may run in UTC, so "today", "this month" and every time shown on a
 * server-rendered page must be computed in America/Detroit explicitly — never
 * from the process's local clock. The cron route already did this by hand; this
 * is the one shared copy.
 */
export const BUSINESS_TZ = 'America/Detroit';

/** Calendar parts of an instant, as seen on a clock in Detroit. */
export function detroitParts(d: Date = new Date()): { y: number; m: number; d: number; h: number; min: number } {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute') };
}

/** YYYY-MM-DD for an instant, in Detroit. Use for `date` columns (expenses.incurred_on). */
export function ymd(d: Date = new Date()): string {
  const { y, m, d: day } = detroitParts(d);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The instant at which a Detroit-local wall time occurs (handles DST). */
export function detroitDateTime(y: number, m: number, d: number, h = 0, min = 0): Date {
  // First guess assumes UTC, then correct by the zone's offset at that instant.
  const guess = new Date(Date.UTC(y, m - 1, d, h, min));
  const p = detroitParts(guess);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  const corrected = new Date(guess.getTime() - (asUtc - guess.getTime()));
  // One more pass catches the rare DST-boundary miss.
  const p2 = detroitParts(corrected);
  const asUtc2 = Date.UTC(p2.y, p2.m - 1, p2.d, p2.h, p2.min);
  return new Date(corrected.getTime() - (asUtc2 - Date.UTC(y, m - 1, d, h, min)));
}

/** [start, end) of the Detroit calendar day containing `d`. */
export function dayRange(d: Date = new Date()): { start: Date; end: Date } {
  const { y, m, d: day } = detroitParts(d);
  return { start: detroitDateTime(y, m, day), end: detroitDateTime(y, m, day + 1) };
}

/** [start, end) of a Detroit calendar month. `m` is 1-12. */
export function monthRange(y: number, m: number): { start: Date; end: Date } {
  return { start: detroitDateTime(y, m, 1), end: detroitDateTime(y, m + 1, 1) };
}

/** [start, end) of the Detroit calendar month containing `d`. */
export function thisMonthRange(d: Date = new Date()): { start: Date; end: Date } {
  const { y, m } = detroitParts(d);
  return monthRange(y, m);
}

/** "2026-09" key used by the month strips and trend charts, in Detroit. */
export function monthKey(d: Date | string): string {
  const { y, m } = detroitParts(typeof d === 'string' ? new Date(d) : d);
  return `${y}-${String(m).padStart(2, '0')}`;
}

/* ---------- Display (always Detroit, so server and browser agree) ---------- */
const opt = (o: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({ timeZone: BUSINESS_TZ, ...o });

export const fmtTime = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString('en-US', opt({ hour: 'numeric', minute: '2-digit' }));
export const fmtDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('en-US', opt({ month: 'numeric', day: 'numeric', year: 'numeric' }));
export const fmtDateTime = (iso: string | Date) =>
  new Date(iso).toLocaleString('en-US', opt({ month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }));
export const fmtShort = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('en-US', opt({ month: 'short', day: 'numeric' }));
export const fmtLong = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('en-US', opt({ month: 'long', day: 'numeric', year: 'numeric' }));
/** For a bare YYYY-MM-DD (date column) — never shifts by a day. */
export const fmtYmd = (s: string, o: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric', year: 'numeric' }) =>
  new Date(`${s}T12:00:00`).toLocaleDateString('en-US', o);
