import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Label, Cluster, Cell, Gauge, FactorBar, Row, Stack } from '@/components/Hud';
import type { Job, Expense, Lead, Invoice } from '@/lib/types';

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
    supabase.from('leads').select('status,created_at,est_value,source,follow_up_on,name'),
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
  const today = now.toISOString().slice(0, 10);
  const followUpsDue = allLeads.filter((l) => l.follow_up_on && l.follow_up_on <= today && !['won', 'lost'].includes(l.status));

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
      why: conversion === null ? 'No closed leads yet' : `${Math.round(conversion * 100)}% of closed leads won` },
    { label: 'Pipeline', max: 20,
      score: Math.max(0, 20 - staleLeads * 5),
      why: staleLeads === 0 ? 'Leads contacted promptly' : `${staleLeads} waiting 2+ days` },
  ];
  const health = factors.reduce((s, f) => s + f.score, 0);
  const status = health >= 75
    ? { word: 'Nominal', color: SUCCESS }
    : health >= 50
      ? { word: 'Elevated', color: WARNING }
      : { word: 'Critical', color: DANGER };

  const dateline = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const monthName = now.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const hasAlerts = overdue.length > 0 || staleLeads > 0 || followUpsDue.length > 0 || (expiringDocs?.length ?? 0) > 0;

  return (
    <div className="space-y-5">
      {/* Command header */}
      <header className="flex items-baseline justify-between">
        <div>
          <p className="panel-label">Command Center</p>
          <h1 className="mt-0.5 text-2xl">{dateline}</h1>
        </div>
        <p className="panel-label" style={{ color: 'var(--text-muted)' }}>SJHC</p>
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
        <div className="card hud-rise" style={{ borderColor: 'var(--brand-accent)', boxShadow: '0 0 18px rgba(141,29,57,0.25)' }}>
          <Label right={`${overdue.length + (staleLeads ? 1 : 0) + (followUpsDue.length ? 1 : 0) + (expiringDocs?.length ?? 0)} signals`}>Attention required</Label>
          <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {overdue.map((i) => (
              <li key={i.id} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: DANGER }} />
                <span><Link className="font-medium text-white underline-offset-2 hover:underline" href={`/invoices/${i.id}`}>Invoice #{i.invoice_number}</Link> · {i.customers?.name} — {money(Number(i.total))} overdue {new Date(i.due_at!).toLocaleDateString()}</span>
              </li>
            ))}
            {staleLeads > 0 && (
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: WARNING }} />
                <span><Link className="font-medium text-white hover:underline" href="/leads">{staleLeads} new lead{staleLeads > 1 ? 's' : ''}</Link> waiting 2+ days without contact</span>
              </li>
            )}
            {followUpsDue.length > 0 && (
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: WARNING }} />
                <span><Link className="font-medium text-white hover:underline" href="/leads">{followUpsDue.length} follow-up{followUpsDue.length > 1 ? 's' : ''} due</Link> · {followUpsDue.slice(0, 3).map((l) => l.name).join(', ')}{followUpsDue.length > 3 ? '…' : ''}</span>
              </li>
            )}
            {expiringDocs?.map((d) => (
              <li key={d.id} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: WARNING }} />
                <span><Link className="font-medium text-white hover:underline" href="/documents">{d.name}</Link> expires {new Date(d.expires_on + 'T12:00:00').toLocaleDateString()}</span>
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
          <Cell label="Active" value={String(jobsActive)} href="/jobs" tone={jobsActive > 0 ? BRAND : undefined} />
          <Cell label="Completed" value={String(jobsDone)} href="/jobs" />
          <Cell label="Customers" value={String(customerCount ?? 0)} href="/customers" />
        </Cluster>
      </section>

      {/* MONTH TO DATE — money cluster */}
      <section>
        <Label right={monthName}>Month to date</Label>
        <Cluster cols="grid-cols-2 sm:grid-cols-3">
          <Cell label="Collected" value={money(collected)} href="/money" tone={BRAND} />
          <Cell label="Booked" value={money(booked)} href="/invoices" />
          <Cell label="Expenses" value={money(expenses)} href="/expenses" />
          <Cell label="Profit" value={money(profit)} href="/money" tone={profit >= 0 ? SUCCESS : DANGER} sub={collected > 0 ? `${Math.round(margin * 100)}% margin` : undefined} />
          <Cell label="Outstanding" value={money(arTotal)} href="/invoices" tone={overdue.length > 0 ? DANGER : undefined} sub={overdue.length > 0 ? `${overdue.length} overdue` : undefined} />
          <Cell label="Conversion" value={conversion === null ? '—' : `${Math.round(conversion * 100)}%`} href="/leads" />
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
