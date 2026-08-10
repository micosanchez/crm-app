import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Label, Cluster, Cell, Gauge, FactorBar, Row, Stack } from '@/components/Hud';
import { requireStaff } from '@/lib/auth';
import type { Job, Expense, Invoice } from '@/lib/types';

export const dynamic = 'force-dynamic';

const SUCCESS = 'var(--status-success)';
const WARNING = 'var(--status-warning)';
const DANGER = 'var(--status-danger)';
const BRAND = 'var(--brand-text)';
const TITANIUM = 'var(--metal-titanium)';

/** Muted instrument color by fill ratio. */
const ratioColor = (r: number) => (r >= 0.75 ? SUCCESS : r >= 0.5 ? WARNING : DANGER);
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function jobTone(status: string): { tag: string; color: string } {
  if (status === 'paid') return { tag: 'Paid', color: BRAND };
  if (status === 'lead') return { tag: 'Lead', color: 'var(--text-tertiary)' };
  const tag = status === 'in_progress' ? 'Active' : status.charAt(0).toUpperCase() + status.slice(1);
  return { tag, color: TITANIUM };
}

type EstRow = { id: string; estimate_number: number; status: string; total: number | string; created_at: string; customers: { name: string } | null };

export default async function CommandCenter() {
  await requireStaff();
  const supabase = createClient();
  const now = new Date();
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const dayEnd = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthStartDate = monthStart.slice(0, 10);
  const soonDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

  const [
    { data: todayJobs }, { data: monthInvoices }, { data: monthCollected }, { data: monthExpenses },
    { data: openInvoices }, { data: estimates }, { data: activity }, { count: customerCount },
    { data: expiringDocs },
  ] = await Promise.all([
    supabase.from('jobs').select('*, customers(id,name,phone,address)')
      .gte('scheduled_start', dayStart).lte('scheduled_start', dayEnd).order('scheduled_start'),
    supabase.from('invoices').select('total,status,paid_at,issued_at,due_at,created_at').gte('created_at', monthStart),
    // Cash basis: revenue is recognized when the invoice is PAID (paid_at), not when created.
    supabase.from('invoices').select('total').eq('status', 'paid').gte('paid_at', monthStart),
    supabase.from('expenses').select('amount,category').gte('incurred_on', monthStartDate),
    // Outstanding + overdue: only SENT invoices carry a real balance (matches the Money page).
    supabase.from('invoices').select('id,invoice_number,total,amount_paid,due_at,status,customers(id,name)').eq('status', 'sent').order('due_at'),
    supabase.from('estimates').select('id,estimate_number,status,total,created_at,customers(name)'),
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
  const collected = (monthCollected ?? []).reduce((s, i) => s + Number(i.total), 0); // cash in this month (paid_at)
  // "Booked" = invoices raised this month, excluding drafts (a draft isn't a real bill yet).
  const booked = (monthInvoices ?? []).filter((i) => i.status !== 'draft').reduce((s, i) => s + Number(i.total), 0);
  const expenses = ((monthExpenses ?? []) as Expense[]).reduce((s, e) => s + Number(e.amount), 0);
  const profit = collected - expenses;
  const margin = collected > 0 ? profit / collected : 0;

  // ----- Receivables & alerts (sent invoices only) -----
  const open = (openInvoices ?? []) as unknown as (Invoice & { customers: { name: string } | null })[];
  const arTotal = open.reduce((s, i) => s + (Number(i.total) - Number(i.amount_paid ?? 0)), 0);
  const overdue = open.filter((i) => i.due_at && new Date(i.due_at) < now);

  // ----- Quotes (replaces the abandoned leads table as the pipeline signal) -----
  const est = (estimates ?? []) as unknown as EstRow[];
  const estActive = est.filter((e) => e.status !== 'draft');
  const accepted = est.filter((e) => e.status === 'accepted').length;
  const conversion = estActive.length ? accepted / estActive.length : null;
  const staleQuotes = est.filter((e) => e.status === 'sent' && (now.getTime() - new Date(e.created_at).getTime()) > 14 * 86400_000);
  const staleValue = staleQuotes.reduce((s, e) => s + Number(e.total), 0);

  // ----- Business Health Score (0-100) -----
  const factors = [
    { label: 'Margin', max: 30,
      score: collected === 0 ? 15 : Math.max(0, Math.min(30, Math.round(margin * 100 * 0.75))),
      why: collected === 0 ? 'No revenue collected yet' : `${Math.round(margin * 100)}% margin this month` },
    { label: 'Receivables', max: 25,
      score: overdue.length === 0 ? 25 : Math.max(0, 25 - overdue.length * 8),
      why: overdue.length === 0 ? 'No overdue invoices' : `${overdue.length} overdue` },
    { label: 'Conversion', max: 25,
      score: conversion === null ? 13 : Math.round(conversion * 25),
      why: conversion === null ? 'No quotes sent yet' : `${Math.round(conversion * 100)}% of quotes accepted` },
    { label: 'Pipeline', max: 20,
      score: Math.max(0, 20 - staleQuotes.length * 2),
      why: staleQuotes.length === 0 ? 'No quotes awaiting an answer' : `${staleQuotes.length} quote${staleQuotes.length > 1 ? 's' : ''} to follow up` },
  ];
  const health = factors.reduce((s, f) => s + f.score, 0);
  const status = health >= 75
    ? { word: 'Nominal', color: SUCCESS }
    : health >= 50
      ? { word: 'Elevated', color: WARNING }
      : { word: 'Critical', color: DANGER };

  const dateline = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const monthName = now.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const signalCount = overdue.length + (staleQuotes.length ? 1 : 0) + (expiringDocs?.length ?? 0);
  const hasAlerts = signalCount > 0;

  return (
    <div className="space-y-5">
      {/* Command header */}
      <header className="flex items-baseline justify-between">
        <div>
          <p className="panel-label">Command Center</p>
          <h1 className="mt-0.5 text-2xl">{dateline}</h1>
        </div>
        <Link href="/search" className="panel-label hover:text-brand-600" style={{ color: 'var(--text-muted)' }}>Search ⌕</Link>
      </header>

      {/* SYSTEM STATUS */}
      <div className="card hud-rise">
        <Label right="System status">Business health</Label>
        <div className="flex items-center gap-5">
          <Gauge value={health} word={status.word} color={status.color} />
          <div className="min-w-0 flex-1 space-y-3">
            {factors.map((f) => (
              <FactorBar key={f.label} label={f.label} score={f.score} max={f.max} why={f.why} color={ratioColor(f.score / f.max)} />
            ))}
          </div>
        </div>
      </div>

      {/* ATTENTION CHANNEL */}
      {hasAlerts && (
        <div className="card hud-rise" style={{ borderColor: 'var(--brand-accent)', boxShadow: '0 2px 12px rgba(141,29,57,0.12)' }}>
          <Label right={`${signalCount} signal${signalCount === 1 ? '' : 's'}`}>Attention required</Label>
          <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {overdue.map((i) => (
              <li key={i.id} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: DANGER }} />
                <span><Link className="font-medium text-gray-900 underline-offset-2 hover:underline" href={`/invoices/${i.id}`}>Invoice #{i.invoice_number}</Link> · {i.customers?.name} — {money(Number(i.total) - Number(i.amount_paid ?? 0))} overdue {new Date(i.due_at!).toLocaleDateString()}</span>
              </li>
            ))}
            {staleQuotes.length > 0 && (
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: WARNING }} />
                <span><Link className="font-medium text-gray-900 hover:underline" href="/estimates">{staleQuotes.length} quote{staleQuotes.length > 1 ? 's' : ''} worth {money(staleValue)}</Link> awaiting an answer 14+ days — follow up</span>
              </li>
            )}
            {expiringDocs?.map((d) => (
              <li key={d.id} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: WARNING }} />
                <span><Link className="font-medium text-gray-900 hover:underline" href="/documents">{d.name}</Link> expires {new Date(d.expires_on + 'T12:00:00').toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* TODAY — live ops */}
      <section>
        <Label right="Live">Today</Label>
        <Cluster cols="grid-cols-2 sm:grid-cols-4">
          <Cell label="Scheduled" value={String(tJobs.length)} href="/schedule" />
          <Cell label="Active" value={String(jobsActive)} href="/jobs?status=active" tone={jobsActive > 0 ? BRAND : undefined} />
          <Cell label="Completed" value={String(jobsDone)} href="/jobs?status=paid" />
          <Cell label="Customers" value={String(customerCount ?? 0)} href="/customers" />
        </Cluster>
      </section>

      {/* MONTH TO DATE — money cluster */}
      <section>
        <Label right={monthName}>Month to date</Label>
        <Cluster cols="grid-cols-2 sm:grid-cols-3">
          <Cell label="Collected" value={money(collected)} href="/money" tone={BRAND} />
          <Cell label="Booked" value={money(booked)} href="/invoices" sub="excl. drafts" />
          <Cell label="Expenses" value={money(expenses)} href="/expenses" />
          <Cell label="Profit" value={money(profit)} href="/money" tone={profit >= 0 ? SUCCESS : DANGER} sub={collected > 0 ? `${Math.round(margin * 100)}% margin` : undefined} />
          <Cell label="Outstanding" value={money(arTotal)} href="/invoices" tone={overdue.length > 0 ? DANGER : undefined} sub={overdue.length > 0 ? `${overdue.length} overdue` : undefined} />
          <Cell label="Quote acceptance" value={conversion === null ? '—' : `${Math.round(conversion * 100)}%`} href="/reports" />
        </Cluster>
      </section>

      {/* MANIFEST — today's jobs */}
      <section>
        <Label right={`${tJobs.length} job${tJobs.length === 1 ? '' : 's'}`}>Today&apos;s manifest</Label>
        {tJobs.length ? (
          <Stack>
            {tJobs.map((j) => {
              const t = jobTone(j.status);
              return (
                <Row key={j.id} href={`/jobs/${j.id}`}
                  lead={j.scheduled_start ? new Date(j.scheduled_start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
                  title={j.title} meta={j.customers?.name ?? 'No customer'} tag={t.tag} tagColor={t.color} />
              );
            })}
          </Stack>
        ) : (
          <div className="rounded-lg px-4 py-6 text-center text-sm" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            Nothing scheduled today.
          </div>
        )}
      </section>

      {/* FEED — activity log */}
      <section>
        <Label right="Memory log">Activity feed</Label>
        {activity?.length ? (
          <Stack>
            {activity.map((a) => (
              <Row key={a.id}
                title={<span><span className="capitalize">{a.entity_type}</span> <span style={{ color: 'var(--text-tertiary)' }}>{a.action_type.replace(/_/g, ' ')}</span></span>}
                tag={new Date(a.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                tagColor="var(--text-muted)" />
            ))}
          </Stack>
        ) : (
          <div className="rounded-lg px-4 py-6 text-center text-sm" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
            No activity yet.
          </div>
        )}
      </section>
    </div>
  );
}
