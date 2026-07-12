import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

/* ------------------------------------------------------------------ *
 * HUD primitives — instrument-panel building blocks.
 * Presentational + server-safe. Reused across command-center screens.
 * Principles: density (Bloomberg), one rationed accent (Linear),
 * live system-state readouts (mission control).
 * ------------------------------------------------------------------ */

export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <p className="panel-label">{children}</p>
      {right ? <p className="panel-label" style={{ color: 'var(--text-muted)' }}>{right}</p> : null}
    </div>
  );
}

/** A hairline-gridded cluster of instrument cells (1px lines via gap technique). */
export function Cluster({ cols, children }: { cols: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
      <div className={`grid ${cols} gap-px`} style={{ background: 'var(--border-subtle)' }}>{children}</div>
    </div>
  );
}

/** One readout cell: caption label, tabular metric, optional sub + link. */
export function Cell({ label, value, sub, href, tone }: {
  label: string; value: string; sub?: string; href?: string; tone?: string;
}) {
  const inner = (
    <div className="flex h-full flex-col gap-1 bg-surface px-4 py-3.5 transition-colors duration-200 group-hover:bg-[var(--bg-tertiary)]">
      <p className="panel-label">{label}</p>
      <p className="metric text-[22px] font-bold leading-none" style={{ color: tone ?? 'var(--text-primary)' }}>{value}</p>
      {sub ? <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{sub}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="group block">{inner}</Link> : inner;
}

/** Radial system-status gauge with an animated arc draw. */
export function Gauge({ value, max = 100, word, color }: {
  value: number; max?: number; word: string; color: string;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const off = c * (1 - pct);
  const arc: Record<string, string | number> = {
    ['--c']: c,
    ['--o']: off,
    strokeDashoffset: 'var(--o)',
    animation: 'hudArc 900ms var(--ease-standard) both',
  };
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: 128, height: 128 }}>
      <style>{`@keyframes hudArc{from{stroke-dashoffset:var(--c)}to{stroke-dashoffset:var(--o)}}`}</style>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border-standard)" strokeWidth="5" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} style={arc as CSSProperties} />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="metric text-[40px] font-bold leading-none text-gray-900">{value}</span>
        <span className="panel-label mt-1.5" style={{ color }}>{word}</span>
      </div>
    </div>
  );
}

/** Thin instrument bar for a single weighted factor. */
export function FactorBar({ label, score, max, color, why }: {
  label: string; score: number; max: number; color: string; why?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round((score / max) * 100)));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
        <span className="metric text-[11px]" style={{ color: 'var(--text-muted)' }}>{score}/{max}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width var(--anim-slow) var(--ease-standard)' }} />
      </div>
      {why ? <p className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>{why}</p> : null}
    </div>
  );
}

/** Terminal-style log/manifest row. */
export function Row({ href, lead, title, meta, tag, tagColor }: {
  href?: string; lead?: string; title: ReactNode; meta?: string; tag?: string; tagColor?: string;
}) {
  const inner = (
    <div className="flex items-center gap-3 bg-surface px-4 py-3 transition-colors duration-200 group-hover:bg-[var(--bg-tertiary)]">
      {lead ? <span className="metric shrink-0 text-[11px]" style={{ color: 'var(--metal-titanium)' }}>{lead}</span> : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{title}</p>
        {meta ? <p className="panel-label mt-0.5 normal-case" style={{ letterSpacing: 0 }}>{meta}</p> : null}
      </div>
      {tag ? <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: tagColor ?? 'var(--text-tertiary)' }}>{tag}</span> : null}
    </div>
  );
  return href ? <Link href={href} className="group block">{inner}</Link> : <div className="group">{inner}</div>;
}

export function Stack({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
      <div className="grid gap-px" style={{ background: 'var(--border-subtle)' }}>{children}</div>
    </div>
  );
}
