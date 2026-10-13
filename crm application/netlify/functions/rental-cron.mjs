/**
 * Netlify Scheduled Function — every 15 minutes (schedule in netlify.toml).
 * Drives /api/cron/rentals: hold expiry, late fees, reminders, retries, waitlist.
 */
export default async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response('CRON_SECRET not set', { status: 200 });
  const res = await fetch(`${process.env.URL ?? 'https://crmsjh.netlify.app'}/api/cron/rentals`, { method: 'POST', headers: { 'x-cron-secret': secret } });
  const body = await res.text();
  console.log('rental-cron:', res.status, body);
  return new Response(body, { status: 200 });
};
