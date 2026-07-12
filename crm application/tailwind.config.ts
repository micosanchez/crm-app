import type { Config } from 'tailwindcss';

/**
 * SJHC DESIGN TOKEN MAPPING — see DESIGN-SYSTEM.md.
 * LIGHT THEME: the legacy Tailwind palette resolves to natural light
 * values so `bg-white` / `text-gray-900` read correctly on the light
 * canvas. No component may hardcode colors outside this mapping.
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

        // Brand burgundy (light-theme scale: 50 lightest tint → 900 darkest)
        brand: {
          50: '#faf1f4',
          100: '#f3dde6',
          500: '#8d1d39',
          600: '#75142c',
          700: '#7b2153',
          900: '#5b1225',
        },

        // Legacy palette → natural light-theme values
        white: '#ffffff',
        gray: {
          50: '#faf9f7',
          100: '#f3f1ee',
          200: '#e8e5e1',
          300: '#d8d4cf',
          400: '#a8a49e',
          500: '#8a8783',
          600: '#6b6966',
          700: '#54524f',
          800: '#3f3d3b',
          900: '#1c1b1a',
        },
        red: { 50: '#fbf1f2', 100: '#f6dfe2', 300: '#e4a9b1', 400: '#c9536a', 600: '#b03040', 700: '#96222f', 800: '#7c1a26' },
        amber: { 50: '#fbf6ea', 100: '#f6ecd2', 300: '#e5cd8f', 500: '#b98a1e', 600: '#a4791a', 700: '#946a12', 800: '#7a570f' },
        emerald: { 50: '#eef7f2', 100: '#d8eee2', 600: '#1e7a56', 700: '#186549' },
        blue: { 50: '#eff4f9', 100: '#dde9f3', 700: '#2f5e8c' },
        purple: { 100: '#ece3f3', 700: '#6a4a8c' },
      },
      borderRadius: {
        // Soft, rounded — gentler than the industrial spec
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '16px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.05)',
        DEFAULT: '0 1px 3px rgba(0,0,0,0.06)',
        md: '0 2px 8px rgba(0,0,0,0.07)',
        lg: '0 8px 24px rgba(0,0,0,0.09)',
        '2xl': '0 8px 24px rgba(0,0,0,0.09)',
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
