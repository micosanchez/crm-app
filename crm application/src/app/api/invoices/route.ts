import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/invoices  { job_id }
 * Auto-generates a draft invoice from a job, seeding a labor line item
 * from the job's estimated value, and advances the job to "invoiced".
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { job_id } = await req.json();
  if (!job_id) return NextResponse.json({ error: 'job_id required' }, { status: 400 });

  const { data: job, error: jobErr } = await supabase
    .from('jobs').select('*').eq('id', job_id).single();
  if (jobErr || !job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      job_id: job.id,
      customer_id: job.customer_id,
      status: 'draft',
      due_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
      created_by: user.id,
    })
    .select()
    .single();
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 400 });

  if (job.estimated_value) {
    await supabase.from('invoice_items').insert({
      invoice_id: invoice.id,
      kind: 'labor',
      description: job.title,
      quantity: 1,
      unit_price: job.estimated_value,
    });
  }

  await supabase.from('jobs').update({ status: 'invoiced' }).eq('id', job.id);

  return NextResponse.json({ invoice });
}
