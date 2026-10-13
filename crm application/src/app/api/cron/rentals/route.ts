import { NextRequest, NextResponse } from 'next/server';
import { runRentalCron } from '@/lib/rentals/ops';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

/**
 * Every 15 minutes (netlify/functions/rental-cron.mjs): expire holds, accrue late fees, overdue and card-expiry
 * texts, retry soft declines, charge balances at pickup (if that mode is on), waitlist, and drain due messages
 * inside quiet hours. Manual: curl -X POST -H "x-cron-secret: $CRON_SECRET" $APP_URL/api/cron/rentals
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ skipped: 'CRON_SECRET not set' });
  if (req.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try { return NextResponse.json(await runRentalCron()); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
