import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f9eff5',
          100: '#f0d9e6',
          500: '#8e2a62',
          600: '#7b2153',
          700: '#621a42',
          900: '#3c0f28',
        },
      },
    },
  },
  plugins: [],
};
export default config;
