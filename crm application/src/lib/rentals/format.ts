/** Plain formatters shared by server pages and client components (must not be 'use client'). */
export const money = (n: number | string | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;
export const prettyDate = (ymd: string | null | undefined) => ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
export const STATUS_LABEL: Record<string, string> = { pending_payment: 'Pending payment', booked: 'Booked', delivered: 'Delivered', out: 'Out', pickup_scheduled: 'Pickup scheduled', returned: 'Returned', inspected: 'Inspected', closed: 'Closed', cancelled: 'Cancelled' };
