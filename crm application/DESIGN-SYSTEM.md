# SJHC Command Center — Design System

**Version 1.0 · The single source of truth for all UI.**
No screen, component, or report may use values not defined here. All tokens are implemented as CSS variables in `src/app/globals.css` and mapped through `tailwind.config.ts` — components consume Tailwind utilities, utilities resolve to tokens.

## Philosophy

Premium · Technical · Confident · Executive · Industrial · Architectural.
References: Palantir Foundry, Porsche Digital, Apple Pro apps, Bloomberg Terminal (modernized), luxury architecture portfolios. Never playful, never cartoonish, never startup-like. Typography carries hierarchy; graphics are instruments, not decoration.

## 1 · Color Tokens

| Token | Value | Usage |
|---|---|---|
| `--bg-primary` | `#050505` | App canvas |
| `--bg-secondary` | `#090909` | Nav, chrome |
| `--bg-tertiary` | `#111111` | Recessed areas, hover wells |
| `--surface-primary` | `#151515` | Panels, cards |
| `--surface-secondary` | `#1A1A1A` | Nested surfaces, dividers |
| `--surface-elevated` | `#202020` | Modals, raised panels |
| `--brand-primary` | `#5B1225` | Primary burgundy (fills) |
| `--brand-secondary` | `#75142C` | Hover/active burgundy |
| `--brand-accent` | `#8D1D39` | Accents, focus, key actions |
| `--brand-text` | `#C25674` | Burgundy legible on dark |
| `--metal-titanium` | `#B8B8B8` | Metallic secondary text/strokes |
| `--metal-graphite` | `#707070` | Inactive strokes |
| `--metal-aluminum` | `#D5D5D5` | Bright metallic accents |
| `--text-primary` | `#FFFFFF` | Headlines, key figures |
| `--text-secondary` | `#C7C7C7` | Body |
| `--text-tertiary` | `#8F8F8F` | Supporting metadata |
| `--text-muted` | `#666666` | De-emphasized |
| `--status-success` | `#4EBB8D` | Muted emerald |
| `--status-warning` | `#D4A843` | Muted amber |
| `--status-danger` | `#C25460` | Muted crimson |
| `--border-subtle` | `#1F1F1F` | Default hairlines |
| `--border-standard` | `#2A2A2A` | Panel edges |
| `--border-strong` | `#3A3A3A` | Emphasis only |

Rules: no hardcoded hex in components; status colors always muted; bright saturated color is forbidden. The legacy Tailwind palette (`gray`, `white`, `red`, `amber`, `emerald`, `blue`, `purple`) is **remapped** to these tokens in `tailwind.config.ts`, so every utility in the codebase resolves to the token system.

## 2 · Typography

Primary face: **Inter** (loaded via `next/font`), fallbacks SF Pro / system sans. No novelty, rounded, or futuristic fonts.

| Token | Size / Line | Weight | Tracking | Use |
|---|---|---|---|---|
| Display XL | 56/60 | 700 | -0.03em | Hero numerals |
| Display L | 44/48 | 700 | -0.025em | Section displays |
| Display M | 34/38 | 650 | -0.02em | Key metrics |
| Heading XL | 28/32 | 650 | -0.02em | Page titles |
| Heading L | 22/26 | 600 | -0.015em | Panel titles |
| Heading M | 17/22 | 600 | -0.01em | Sub-panels |
| Body L | 16/24 | 450 | 0 | Long-form |
| Body M | 14/21 | 450 | 0 | Default UI |
| Body S | 13/18 | 450 | 0 | Dense data |
| Caption | 12/16 | 450 | +0.01em | Metadata |
| Label | 11/14 | 600 | +0.08em, uppercase | Panel labels, instrument captions |

Numerals in metrics use `font-variant-numeric: tabular-nums`. Hierarchy via size + weight + tone — never color alone.

## 3 · Spacing

4px base grid: `4, 8, 12, 16, 24, 32, 48, 64, 96`. No values off the scale. Panels breathe: minimum 16 inside panels, 24 between panel groups, 48 between page sections.

## 4 · Borders, Radius, Shadow

Borders: 1px only, tokens above. Radius: `sm 4px · md 6px · lg 8px` (Tailwind `rounded-lg/xl/2xl` are remapped down to these — no bubbles). Shadows are architectural, near-invisible ambient occlusion:
`shadow-sm: 0 1px 2px rgba(0,0,0,.5)` · `shadow-md: 0 2px 8px rgba(0,0,0,.45)` · `shadow-lg: 0 8px 24px rgba(0,0,0,.5)`. No floating/glow effects.

## 5 · Glass

`.glass` = `rgba(17,17,17,.78)` + `backdrop-blur(14px)` + border-subtle. Permitted only on: navigation overlays (mobile More sheet), executive panels, command-center modules.

## 6 · Components

All in `globals.css` `@layer components`, consuming tokens only:
`.card` (panel: surface-primary, border-subtle, radius-md, shadow-sm) · `.btn-primary` (brand fill) · `.btn-ghost` (hairline metallic) · `.btn-big` (field/mobile) · `.input` (recessed: bg-tertiary, border-standard, brand-accent focus) · `.badge` (Label type, hairline) · `.panel-label` (Label type, text-tertiary) · `.metric` (Display numerals, tabular). Dashboard uses **Metric Panels / Command Panels / Operational Status Panels**, not "cards": label on top in Label type, value in Display, delta/meta in Caption.

## 7 · Iconography

Sparse, monochrome, geometric, stroke-based (1.5px, `currentColor`), 20–24px grid — defined inline in `Nav.tsx`. No emoji in navigation or panel chrome; typography leads. (Legacy emoji inside action buttons are being retired progressively.)

## 8 · Motion

`--anim-fast: 120ms` · `--anim-normal: 200ms` · `--anim-slow: 320ms`, easing `cubic-bezier(0.25, 0.6, 0.3, 1)`. Permitted: fade, opacity, subtle scale (≥0.98), short slide (≤8px). Forbidden: bounce, elastic, spin, parallax.

## 9 · Charts

Bloomberg-modern: thin 1.5px series lines, `--border-subtle` gridlines, Label-type axis text in `--text-muted`, single burgundy series accent, metallic secondaries. No pie charts, no gradients fills brighter than 12% opacity, no legends when direct labeling fits.

## 10 · Mobile

Tesla-app discipline: bottom instrument bar (5 destinations + More glass sheet), Heading XL page titles, 44px minimum touch targets, `.btn-big` for field actions, no decorative chrome. Customer-facing sign pages share the same tokens — the brand is one surface.

## 11 · Accessibility

Text contrast ≥ 4.5:1 against its surface (all token pairs above comply; `--text-muted` only for non-essential metadata). Focus states: 1px `--brand-accent` ring. Hit areas ≥ 44px on touch. Motion respects `prefers-reduced-motion` (animations collapse to opacity).

## 12 · Print

Documents (estimates/invoices) print on white: a global `@media print` override flips surfaces to white and text to near-black so PDFs remain paper-correct regardless of screen theme.
