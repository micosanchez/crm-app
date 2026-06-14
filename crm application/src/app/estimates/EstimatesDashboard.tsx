'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import NewEstimateForm from './NewEstimateForm';
import type { Estimate, Customer } from '@/lib/types';

/* ------------------------------------------------------------------ *
 * Estimates — executive command-center.
 * Month performance strip → comparison engine → analytics → list.
 * Status is editorial (burgundy / titanium / graphite), never badges.
 * ------------------------------------------------------------------ */

type Tone = 'accepted' | 'pending' | 'declined';
function classify(status: string): { label: string; tone: Tone } {
  if (status === 'accepted') return { label: 'Accepted', tone: 'accepted' };
  if (status === 'declined') return { label: 'Declined', tone: 'declined' };
  if (status === 'expired') return { label: 'Expired', tone: 'declined' };
  return { label: status === 'sent' ? 'Pending' : 'Draft', tone: 'pending' };
}

const TONE_TEXT: Record<Tone, string> = {
  accepted: 'text-brand-700',
  pending: 'text-metal-titanium',
  declined: 'text-gray-500',
};
const TONE_BAR: Record<Tone, string> = {
  accepted: 'var(--brand-accent)',
  pending: 'var(--metal-titanium)',
  declined: 'var(--metal-graphite)',
};

const fmtK = (n: number) => {
  if (n < 1000) return `$${Math.round(n)}`;
  const k = n / 1000;
  const dp = n >= 100000 ? 0 : n >= 10000 ? 1 : 2;
  return `$${k.toFixed(dp)}K`;
};
const fmtFull = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

interface MonthEntry { key: string; label: string; list: Estimate[]; total: number; pct: number | null }

export default function EstimatesDashboard({ estimates, customers }: {
  estimates: Estimate[];
  customers: Pick<Customer, 'id' | 'name'>[];
}) {
  const router = useRouter();

  const months = useMemo<MonthEntry[]>(() => {
    const map = new Map<string, Estimate[]>();
    for (const e of estimates) {
      const d = new Date(e.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    const now = new Date();
    const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(curKey)) map.set(curKey, []);

    const asc = [...map.keys()].sort().map((key) => {
      const [y, m] = key.split('-').map(Number);
      const list = map.get(key)!;
      return {
        key,
        label: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
        list,
        total: list.reduce((s, e) => s + Number(e.total), 0),
        pct: null as number | null,
      };
    });
    asc.forEach((e, i) => {
      const prev = asc[i - 1];
      e.pct = prev && prev.total > 0 ? Math.round(((e.total - prev.total) / prev.total) * 100) : null;
    });
    return asc;
  }, [estimates]);

  const [selectedKey, setSelectedKey] = useState(() => months[months.length - 1]?.key ?? '');
  const [statusFilter, setStatusFilter] = useState<'all' | Tone>('all');
  const [query, setQuery] = useState('');

  const selected = months.find((m) => m.key === selectedKey) ?? months[months.length - 1];

  const stats = useMemo(() => {
    const list = selected?.list ?? [];
    const g = { accepted: { v: 0, n: 0 }, pending: { v: 0, n: 0 }, declined: { v: 0, n: 0 } };
    for (const e of list) {
      const { tone } = classify(e.status);
      g[tone].v += Number(e.total);
      g[tone].n += 1;
    }
    const total = g.accepted.v + g.pending.v + g.declined.v;
    const count = list.length;
    const decided = g.accepted.n + g.declined.n;
    return {
      total, count, ...g,
      avg: count ? total / count : 0,
      acceptance: decided ? Math.round((g.accepted.n / decided) * 100) : 0,
      pct: selected?.pct ?? null,
    };
  }, [selected]);

  const visible = useMemo(() => {
    let list = selected?.list ?? [];
    if (statusFilter !== 'all') list = list.filter((e) => classify(e.status).tone === statusFilter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((e) =>
      (e.customers?.name ?? '').toLowerCase().includes(q) || String(e.estimate_number).includes(q));
    return [...list].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  }, [selected, statusFilter, query]);

  // Sparkline points across recent months
  const spark = useMemo(() => {
    const pts = months.slice(-8);
    const max = Math.max(1, ...pts.map((p) => p.total));
    const w = 120, h = 28;
    return {
      d: pts.map((p, i) => `${(i / Math.max(1, pts.length - 1)) * w},${h - (p.total / max) * h}`).join(' '),
      w, h,
    };
  }, [months]);

  const barTotal = Math.max(1, stats.total);

  return (
    <div className="space-y-6">
      <style>{`@keyframes estFade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}.est-fade{animation:estFade var(--anim-normal) var(--ease-standard)}`}</style>

      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl uppercase tracking-[0.06em]">Estimates</h1>
          <p className="panel-label mt-1">Pipeline value · Conversion metrics</p>
        </div>
        <div className="flex items-center gap-2">
          <Icon onClick={() => setQuery('')} active={!!query.trim()} label="Clear search" path="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-5.4-5.4" />
          <Icon onClick={() => setStatusFilter(statusFilter === 'all' ? 'accepted' : 'all')} active={statusFilter !== 'all'} label="Filter" path="M3 5h18M6 12h12M10 19h4" />
        </div>
      </header>

      {/* Month performance strip */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-1"
        style={{ scrollPaddingLeft: 16 }}>
        {[...months].reverse().map((m) => {
          const active = m.key === selectedKey;
          return (
            <button key={m.key} onClick={() => setSelectedKey(m.key)}
              className="min-w-[150px] shrink-0 snap-start rounded-lg px-4 py-3 text-left transition-colors duration-fast"
              style={{
                background: active ? 'var(--brand-50, #1c0a11)' : 'var(--surface-primary)',
                border: `1px solid ${active ? 'var(--brand-accent)' : 'var(--border-subtle)'}`,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03), 0 1px 2px rgba(0,0,0,0.5)',
              }}>
              <p className={`panel-label ${active ? 'text-brand-700' : ''}`}>{m.label}</p>
              <p className="metric mt-1 text-2xl font-bold text-white">{fmtK(m.total)}</p>
              <p className="mt-0.5 text-xs metric" style={{ color: m.pct == null ? 'var(--text-muted)' : m.pct >= 0 ? 'var(--metal-titanium)' : 'var(--text-muted)' }}>
                {m.pct == null ? '—' : `${m.pct >= 0 ? '↑' : '↓'} ${Math.abs(m.pct)}%`}
              </p>
            </button>
          );
        })}
      </div>

      {/* Comparison + analytics */}
      <section key={selectedKey} className="est-fade space-y-4">
        <div className="card" style={{ background: 'var(--surface-primary)' }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="panel-label">{selected?.label} · Total estimated</p>
              <p className="metric mt-1 text-4xl font-bold text-white">{fmtFull(stats.total)}</p>
              <p className="mt-1 text-sm metric" style={{ color: stats.pct == null ? 'var(--text-muted)' : 'var(--metal-titanium)' }}>
                {stats.pct == null ? 'No prior month' : `${stats.pct >= 0 ? '↑' : '↓'} ${Math.abs(stats.pct)}% vs prior month`}
              </p>
            </div>
            <svg viewBox={`0 0 ${spark.w} ${spark.h}`} width={spark.w} height={spark.h} className="mt-1 hidden sm:block" aria-hidden>
              <polyline points={spark.d} fill="none" stroke="var(--brand-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Composition bar */}
          <div className="mt-4 flex h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
            {(['accepted', 'pending', 'declined'] as Tone[]).map((t) => (
              <div key={t} style={{ width: `${(stats[t].v / barTotal) * 100}%`, background: TONE_BAR[t] }} />
            ))}
          </div>

          {/* Metric triad */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Metric label="Accepted" value={fmtFull(stats.accepted.v)} sub={`${stats.accepted.n} est`} tone="accepted" />
            <Metric label="Pending" value={fmtFull(stats.pending.v)} sub={`${stats.pending.n} est`} tone="pending" />
            <Metric label="Declined" value={fmtFull(stats.declined.v)} sub={`${stats.declined.n} est`} tone="declined" />
          </div>

          <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm" style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="text-gray-500">Acceptance rate <b className="text-white metric">{stats.acceptance}%</b></span>
            <span className="text-gray-500">Average <b className="text-white metric">{fmtFull(stats.avg)}</b></span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <input className="input max-w-[220px] flex-1" placeholder="Search name or #number" value={query}
            onChange={(e) => setQuery(e.target.value)} />
          <div className="flex gap-1">
            {(['all', 'accepted', 'pending', 'declined'] as const).map((f) => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors duration-fast ${statusFilter === f ? 'text-white' : 'text-gray-500'}`}
                style={{
                  background: statusFilter === f ? 'var(--surface-elevated)' : 'transparent',
                  border: `1px solid ${statusFilter === f ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
                }}>
                {f === 'all' ? 'All' : f}
              </button>
            ))}
          </div>
        </div>

        {/* Estimate list */}
        <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
          {visible.map((e) => {
            const c = classify(e.status);
            return (
              <button key={e.id} onClick={() => router.push(`/estimates/${e.id}`)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-[var(--bg-tertiary)]"
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  borderLeft: `2px solid ${c.tone === 'accepted' ? 'var(--brand-accent)' : 'transparent'}`,
                }}>
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{e.customers?.name ?? 'No customer'}</p>
                  <p className="panel-label mt-0.5">#EST{e.estimate_number} · {new Date(e.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="metric font-semibold text-white">{fmtFull(Number(e.total))}</p>
                  <p className={`mt-0.5 text-[11px] font-semibold uppercase tracking-wider ${TONE_TEXT[c.tone]}`}>{c.label}</p>
                </div>
              </button>
            );
          })}
          {!visible.length && (
            <p className="px-4 py-8 text-center text-sm text-gray-500">
              {selected?.list.length ? 'No estimates match this filter.' : 'No estimates this month.'}
            </p>
          )}
        </div>
      </section>

      {/* Persistent command action */}
      <div className="sticky bottom-20 z-30 md:bottom-4">
        <NewEstimateForm customers={customers} triggerClassName="btn-big glass w-full uppercase tracking-[0.08em] text-white" triggerLabel="New estimate" />
      </div>
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: Tone }) {
  return (
    <div>
      <p className="panel-label">{label}</p>
      <p className={`metric mt-1 text-lg font-bold ${TONE_TEXT[tone]}`}>{value}</p>
      <p className="text-[11px] text-gray-500">{sub}</p>
    </div>
  );
}

function Icon({ path, label, onClick, active }: { path: string; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className="grid h-9 w-9 place-items-center rounded-md transition-colors duration-fast"
      style={{ border: `1px solid ${active ? 'var(--brand-accent)' : 'var(--border-standard)'}`, color: active ? 'var(--brand-text)' : 'var(--text-tertiary)', background: 'var(--surface-primary)' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </button>
  );
}
