import type { Config } from 'tailwindcss';

/**
 * SJHC DESIGN TOKEN MAPPING — see DESIGN-SYSTEM.md.
 * The legacy Tailwind palette is remapped to the dark industrial token
 * system so every utility in the codebase resolves to design tokens.
 * No component may hardcode colors outside this mapping.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic tokens (preferred going forward)
        bg: { primary: 'var(--bg-primary)', secondary: 'var(--bg-secondary)', tertiary: 'var(--bg-tertiary)' },
        surface: { DEFAULT: 'var(--surface-primary)', secondary: 'var(--surface-secondary)', elevated: 'var(--surface-elevated)' },
        metal: { titanium: 'var(--metal-titanium)', graphite: 'var(--metal-graphite)', aluminum: 'var(--metal-aluminum)' },
        line: { subtle: 'var(--border-subtle)', standard: 'var(--border-standard)', strong: 'var(--border-strong)' },

        // Brand burgundy
        brand: {
          50: '#1c0a11',
          100: '#2a0f1a',
          500: '#8d1d39',
          600: '#75142c',
          700: '#c25674',
          900: '#5b1225',
        },

        // Legacy palette remap → dark theme tokens
        white: '#151515',
        gray: {
          50: '#111111',
          100: '#1a1a1a',
          200: '#242424',
          300: '#2e2e2e',
          400: '#666666',
          500: '#8f8f8f',
          600: '#c7c7c7',
          700: '#d5d5d5',
          800: '#e5e5e5',
          900: '#ffffff',
        },
        red: { 50: '#1f0d10', 100: '#2a1216', 300: '#4a2228', 400: '#c26073', 600: '#c25460', 700: '#d16a76', 800: '#e08a94' },
        amber: { 50: '#1f1809', 100: '#2a200d', 300: '#4a3a16', 500: '#d4a843', 600: '#c99b36', 700: '#d4a843', 800: '#e0bc66' },
        emerald: { 50: '#0d1a13', 100: '#12241a', 600: '#3fa47a', 700: '#4ebb8d' },
        blue: { 50: '#0d141c', 100: '#121c28', 700: '#7fa6cc' },
        purple: { 100: '#1c1426', 700: '#a98bc9' },
      },
      borderRadius: {
        // Restrained radii — no bubble UI
        md: '6px',
        lg: '6px',
        xl: '8px',
        '2xl': '10px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.5)',
        DEFAULT: '0 1px 2px rgba(0,0,0,0.5)',
        md: '0 2px 8px rgba(0,0,0,0.45)',
        lg: '0 8px 24px rgba(0,0,0,0.5)',
        '2xl': '0 8px 24px rgba(0,0,0,0.5)',
      },
      transitionDuration: {
        fast: 'var(--anim-fast)',
        DEFAULT: 'var(--anim-normal)',
        slow: 'var(--anim-slow)',
      },
    },
  },
  plugins: [],
};
export default config;
