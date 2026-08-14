import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/invoices  { job_id }
 * Auto-generates a draft invoice from a job, seeding a labor line item
 * from the job's estimated value, and advances the job to "invoiced".
 * Admin/dispatcher only; idempotent — a job can only ever have one invoice
 * from this route (double-taps and retries return the existing one).
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Role gate — technicians must not create invoices (matches migration 0014).
  const { data: me } = await supabase.from('users').select('role').eq('id', user.id).single();
  if (me?.role !== 'admin' && me?.role !== 'dispatcher') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { job_id } = await req.json();
  if (!job_id) return NextResponse.json({ error: 'job_id required' }, { status: 400 });

  const { data: job, error: jobErr } = await supabase
    .from('jobs').select('*').eq('id', job_id).single();
  if (jobErr || !job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  // Idempotency — if an invoice already exists for this job, return it
  // instead of creating a duplicate (double-tap / retry safety).
  const { data: dupes } = await supabase
    .from('invoices').select('id, invoice_number, status').eq('job_id', job_id).limit(1);
  if (dupes && dupes.length > 0) {
    return NextResponse.json({ invoice: dupes[0], existing: true });
  }

  // Seed invoice defaults from Settings (business_settings singleton). Falls back to
  // the old hardcoded behaviour when unset. tax rate is stored as a percent (6 = 6%);
  // invoices.tax_rate is a fraction, so divide by 100.
  const { data: cfg } = await supabase
    .from('business_settings')
    .select('default_tax_rate, default_invoice_due_days, default_invoice_payment_instructions')
    .eq('id', true)
    .maybeSingle();
  const dueDays = Number(cfg?.default_invoice_due_days ?? 14) || 14;

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      job_id: job.id,
      customer_id: job.customer_id,
      status: 'draft',
      tax_rate: (Number(cfg?.default_tax_rate ?? 0) || 0) / 100,
      payment_instructions: cfg?.default_invoice_payment_instructions ?? null,
      due_at: new Date(Date.now() + dueDays * 86400_000).toISOString(),
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
