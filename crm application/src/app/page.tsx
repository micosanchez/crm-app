import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import StatusBadge from '@/components/StatusBadge';
import type { Job, Expense, Lead, Invoice } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function CommandCenter() {
  const supabase = createClient();
  const now = new Date();
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const dayEnd = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthStartDate = monthStart.slice(0, 10);

  const soonDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const [
    { data: todayJobs }, { data: monthInvoices }, { data: monthExpenses },
    { data: openInvoices }, { data: leads }, { data: activity }, { count: customerCount },
    { data: expiringDocs },
  ] = await Promise.all([
    supabase.from('jobs').select('*, customers(id,name,phone,address)')
      .gte('scheduled_start', dayStart).lte('scheduled_start', dayEnd).order('scheduled_start'),
    supabase.from('invoices').select('total,status,paid_at,issued_at,due_at,created_at').gte('created_at', monthStart),
    supabase.from('expenses').select('amount,category').gte('incurred_on', monthStartDate),
    supabase.from('invoices').select('id,invoice_number,total,due_at,status,customers(id,name)').in('status', ['sent', 'draft']).order('due_at'),
    supabase.from('leads').select('status,created_at,est_value,source'),
    supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(8),
    supabase.from('customers').select('*', { count: 'exact', head: true }),
    supabase.from('documents').select('id,name,expires_on').eq('archived', false)
      .not('expires_on', 'is', null).lte('expires_on', soonDate).order('expires_on'),
  ]);

  // ----- Today -----
  const tJobs = (todayJobs ?? []) as Job[];
  const jobsDone = tJobs.filter((j) => ['completed', 'invoiced', 'paid'].includes(j.status)).length;
  const jobsActive = tJobs.filter((j) => j.status === 'in_progress').length;

  // ----- Month money -----
  const collected = (monthInvoices ?? []).filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.total), 0);
  const booked = (monthInvoices ?? []).reduce((s, i) => s + Number(i.total), 0);
  const expenses = ((monthExpenses ?? []) as Expense[]).reduce((s, e) => s + Number(e.amount), 0);
  const profit = collected - expenses;
  const margin = collected > 0 ? profit / collected : 0;

  // ----- Receivables & alerts -----
  const open = (openInvoices ?? []) as unknown as (Invoice & { customers: { name: string } | null })[];
  const arTotal = open.reduce((s, i) => s + Number(i.total), 0);
  const overdue = open.filter((i) => i.due_at && new Date(i.due_at) < now);
  const allLeads = (leads ?? []) as Lead[];
  const wonLeads = allLeads.filter((l) => l.status === 'won').length;
  const closedLeads = wonLeads + allLeads.filter((l) => l.status === 'lost').length;
  const conversion = closedLeads > 0 ? wonLeads / closedLeads : null;
  const staleLeads = allLeads.filter((l) => l.status === 'new' && (now.getTime() - new Date(l.created_at).getTime()) > 2 * 86400_000).length;

  // ----- Business Health Score (0-100) -----
  const factors: { label: string; score: number; max: number; why: string }[] = [
    { label: 'Profit margin', max: 30,
      score: collected === 0 ? 15 : Math.max(0, Math.min(30, Math.round(margin * 100 * 0.75))),
      why: collected === 0 ? 'No revenue collected yet this month' : `${Math.round(margin * 100)}% margin this month` },
    { label: 'Receivables', max: 25,
      score: overdue.length === 0 ? 25 : Math.max(0, 25 - overdue.length * 8),
      why: overdue.length === 0 ? 'No overdue invoices' : `${overdue.length} overdue invoice${overdue.length > 1 ? 's' : ''}` },
    { label: 'Lead conversion', max: 25,
      score: conversion === null ? 13 : Math.round(conversion * 25),
      why: conversion === null ? 'No closed leads yet' : `${Math.round(conversion * 100)}% of closed leads won` },
    { label: 'Pipeline freshness', max: 20,
      score: Math.max(0, 20 - staleLeads * 5),
      why: staleLeads === 0 ? 'All new leads contacted promptly' : `${staleLeads} lead${staleLeads > 1 ? 's' : ''} waiting 2+ days` },
  ];
  const health = factors.reduce((s, f) => s + f.score, 0);
  const healthColor = health >= 75 ? 'text-emerald-600' : health >= 50 ? 'text-amber-600' : 'text-red-600';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Command Center</h1>
        <div className="card flex items-center gap-3 py-2">
          <span className={`text-3xl font-extrabold ${healthColor}`}>{health}</span>
          <span className="text-xs leading-tight text-gray-500">Business<br />Health</span>
        </div>
      </div>

      {/* Alerts */}
      {(overdue.length > 0 || staleLeads > 0 || (expiringDocs?.length ?? 0) > 0) && (
        <div className="card border-amber-300 bg-amber-50">
          <p className="panel-label mb-2 !text-amber-800">Needs attention</p>
          <ul className="space-y-1 text-sm text-amber-800">
            {overdue.map((i) => (
              <li key={i.id}>
                <Link className="underline" href={`/invoices/${i.id}`}>Invoice #{i.invoice_number}</Link>
                {' '}({i.customers?.name}) — ${Number(i.total).toFixed(0)} overdue since {new Date(i.due_at!).toLocaleDateString()}
              </li>
            ))}
            {staleLeads > 0 && <li><Link className="underline" href="/leads">{staleLeads} new lead{staleLeads > 1 ? 's' : ''}</Link> waiting 2+ days without contact</li>}
            {expiringDocs?.map((d) => (
              <li key={d.id}><Link className="underline" href="/documents">{d.name}</Link> expires {new Date(d.expires_on + 'T12:00:00').toLocaleDateString()}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Today */}
      <section>
        <h2 className="mb-2 font-semibold">Today</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Jobs scheduled" value={String(tJobs.length)} href="/schedule" />
          <Stat label="In progress" value={String(jobsActive)} href="/jobs" />
          <Stat label="Completed" value={String(jobsDone)} href="/jobs" />
          <Stat label="Customers" value={String(customerCount ?? 0)} href="/customers" />
        </div>
      </section>

      {/* This month */}
      <section>
        <h2 className="mb-2 font-semibold">This month</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Collected" value={`$${collected.toFixed(0)}`} href="/money" />
          <Stat label="Booked" value={`$${booked.toFixed(0)}`} href="/invoices" />
          <Stat label="Expenses" value={`$${expenses.toFixed(0)}`} href="/expenses" />
          <Stat label="Profit" value={`$${profit.toFixed(0)}`} href="/money" accent={profit >= 0} />
          <Stat label="Outstanding (AR)" value={`$${arTotal.toFixed(0)}`} href="/invoices" />
        </div>
      </section>

      {/* Health breakdown */}
      <section>
        <h2 className="mb-2 font-semibold">Health score breakdown</h2>
        <div className="card divide-y divide-gray-100 p-0">
          {factors.map((f) => (
            <div key={f.label} className="flex items-center justify-between px-4 py-2 text-sm">
              <div>
                <p className="font-medium">{f.label}</p>
                <p className="text-xs text-gray-500">{f.why}</p>
              </div>
              <span className="font-semibold">{f.score}/{f.max}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Today's schedule */}
      <section>
        <h2 className="mb-2 font-semibold">Today&apos;s jobs</h2>
        {tJobs.length ? (
          <div className="space-y-2">
            {tJobs.map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="card flex items-center justify-between hover:border-brand-500">
                <div>
                  <p className="font-medium">{j.title}</p>
                  <p className="text-sm text-gray-500">
                    {j.scheduled_start && new Date(j.scheduled_start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {j.customers?.name}
                  </p>
                </div>
                <StatusBadge status={j.status} />
              </Link>
            ))}
          </div>
        ) : <p className="text-sm text-gray-500">Nothing scheduled today.</p>}
      </section>

      {/* Activity */}
      <section>
        <h2 className="mb-2 font-semibold">Recent activity <span className="text-xs font-normal text-gray-400">(memory log)</span></h2>
        <div className="card divide-y divide-gray-100 p-0">
          {activity?.map((a) => (
            <div key={a.id} className="flex justify-between px-4 py-2 text-sm">
              <span><b className="capitalize">{a.entity_type}</b> {a.action_type.replace('_', ' ')}</span>
              <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
            </div>
          ))}
          {!activity?.length && <p className="p-4 text-sm text-gray-500">No activity yet.</p>}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, href, accent }: { label: string; value: string; href: string; accent?: boolean }) {
  return (
    <Link href={href} className="card hover:border-brand-500">
      <p className={`text-2xl font-bold ${accent === false ? 'text-red-700' : 'text-brand-700'}`}>{value}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </Link>
  );
}
