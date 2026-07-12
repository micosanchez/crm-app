/**
 * Netlify Scheduled Function — fires the daily notification sweep.
 * Schedule lives in netlify.toml ([functions."notify-cron"] schedule).
 * All real logic is in /api/cron/notifications so it can also be
 * triggered manually with the same secret.
 */
export default async () => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response('CRON_SECRET not set', { status: 200 });

  const res = await fetch(`${process.env.URL ?? 'https://crmsjh.netlify.app'}/api/cron/notifications`, {
    method: 'POST',
    headers: { 'x-cron-secret': secret },
  });
  const body = await res.text();
  console.log('notify-cron:', res.status, body);
  return new Response(body, { status: 200 });
};
