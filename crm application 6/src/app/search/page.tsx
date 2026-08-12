import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { Label, Stack, Row } from '@/components/Hud';

export const dynamic = 'force-dynamic';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  await requireStaff();
  const supabase = createClient();

  const raw = (searchParams.q ?? '').trim();
  // Strip characters that would break the PostgREST or() grammar.
  const safe = raw.replace(/[,()%*]/g, ' ').trim();
  const like = `%${safe}%`;
  const digits = raw.replace(/\D/g, '');
  const num = digits ? Number(digits) : null;

  let customers: any[] = [], jobs: any[] = [], invoices: any[] = [], estimates: any[] = [], expenses: any[] = [];

  if (safe) {
    const phoneLike = `%${raw.replace(/[^\d+]/g, '') || safe}%`;
    const [c, j, e, exp, iv] = await Promise.all([
      supabase.from('customers').select('id,name,phone,city,email')
        .or(`name.ilike.${like},phone.ilike.${phoneLike},email.ilike.${like},address.ilike.${like}`).limit(20),
      supabase.from('jobs').select('id,title,status,scheduled_start,customers(name)')
        .or(`title.ilike.${like},address.ilike.${like}`).order('created_at', { ascending: false }).limit(20),
      supabase.from('estimates').select('id,estimate_number,status,total,customers(name)')
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('expenses').select('id,job_id,category,amount,vendor,description,incurred_on')
        .or(`vendor.ilike.${like},description.ilike.${like}`).order('incurred_on', { ascending: false }).limit(20),
      supabase.from('invoices').select('id,invoice_number,status,total,customers(name)')
        .order('created_at', { ascending: false }).limit(200),
    ]);
    customers = c.data ?? [];
    jobs = j.data ?? [];
    expenses = exp.data ?? [];
    const q = safe.toLowerCase();
    // Estimates + invoices: filter client-side by customer name (nested column can't go in or()).
    estimates = ((e.data ?? []) as any[]).filter((x) =>
      (x.customers?.name ?? '').toLowerCase().includes(q) || (num != null && x.estimate_number === num)
    ).slice(0, 20);
    invoices = ((iv.data ?? []) as any[]).filter((x) =>
      (x.customers?.name ?? '').toLowerCase().includes(q) || (num != null && x.invoice_number === num)
    ).slice(0, 20);
  }

  if (num != null) {
    const [inv, est] = await Promise.all([
      supabase.from('invoices').select('id,invoice_number,status,total,customers(name)').eq('invoice_number', num).limit(5),
      supabase.from('estimates').select('id,estimate_number,status,total,customers(name)').eq('estimate_number', num).limit(5),
    ]);
    // Merge any exact-number matches not already present (name search may have missed them).
    const seenInv = new Set(invoices.map((x) => x.id));
    for (const x of inv.data ?? []) if (!seenInv.has(x.id)) invoices.unshift(x);
    const seen = new Set(estimates.map((x) => x.id));
    for (const x of est.data ?? []) if (!seen.has(x.id)) estimates.unshift(x);
  }

  const totalHits = customers.length + jobs.length + invoices.length + estimates.length + expenses.length;

  return (
    <div className="space-y-6">
      <div>
        <p className="panel-label">Search</p>
        <h1 className="text-2xl">Find anything</h1>
      </div>

      <form className="flex gap-2">
        <input className="input flex-1" name="q" autoFocus placeholder="Customer, phone, address, job, invoice #, vendor…" defaultValue={raw} />
        <button className="btn-primary">Search</button>
      </form>

      {!raw && <p className="text-sm text-gray-500">Search across customers, jobs, estimates, invoices, and expenses.</p>}
      {raw && <p className="text-sm text-gray-500">{totalHits} result{totalHits === 1 ? '' : 's'} for &ldquo;{raw}&rdquo;</p>}

      {customers.length > 0 && (
        <section>
          <Label right={`${customers.length}`}>Customers</Label>
          <Stack>
            {customers.map((c) => (
              <Row key={c.id} href={`/customers/${c.id}`} title={c.name} meta={[c.phone, c.city, c.email].filter(Boolean).join(' · ')} />
            ))}
          </Stack>
        </section>
      )}

      {jobs.length > 0 && (
        <section>
          <Label right={`${jobs.length}`}>Jobs</Label>
          <Stack>
            {jobs.map((j) => (
              <Row key={j.id} href={`/jobs/${j.id}`} title={j.title} meta={j.customers?.name ?? 'No customer'} tag={j.status} tagColor="var(--text-tertiary)" />
            ))}
          </Stack>
        </section>
      )}

      {estimates.length > 0 && (
        <section>
          <Label right={`${estimates.length}`}>Estimates</Label>
          <Stack>
            {estimates.map((e) => (
              <Row key={e.id} href={`/estimates/${e.id}`} title={`Estimate #${e.estimate_number}`} meta={e.customers?.name ?? ''} tag={money(Number(e.total))} tagColor="var(--brand-text)" />
            ))}
          </Stack>
        </section>
      )}

      {invoices.length > 0 && (
        <section>
          <Label right={`${invoices.length}`}>Invoices</Label>
          <Stack>
            {invoices.map((i) => (
              <Row key={i.id} href={`/invoices/${i.id}`} title={`Invoice #${i.invoice_number}`} meta={i.customers?.name ?? ''} tag={money(Number(i.total))} tagColor="var(--brand-text)" />
            ))}
          </Stack>
        </section>
      )}

      {expenses.length > 0 && (
        <section>
          <Label right={`${expenses.length}`}>Expenses</Label>
          <Stack>
            {expenses.map((x) => (
              <Row key={x.id} href={x.job_id ? `/jobs/${x.job_id}` : '/expenses'}
                title={<span className="capitalize">{x.category.replace(/_/g, ' ')}{x.vendor ? ` · ${x.vendor}` : ''}</span>}
                meta={[x.incurred_on, x.description].filter(Boolean).join(' · ')}
                tag={money(Number(x.amount))} tagColor="var(--status-danger)" />
            ))}
          </Stack>
        </section>
      )}

      {raw && totalHits === 0 && (
        <div className="rounded-lg px-4 py-8 text-center text-sm" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
          Nothing matched. Try a name, phone number, address, invoice number, or vendor.
        </div>
      )}
    </div>
  );
}
