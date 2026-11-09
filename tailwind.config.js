/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        noc: {
          950: '#04070d',
          900: '#070c15',
          850: '#0a111d',
          800: '#0e1726',
          750: '#121d30',
          700: '#17243a',
          600: '#1f3150',
          500: '#2b4269',
        },
        signal: {
          green: '#34d399',
          amber: '#fbbf24',
          red: '#f87171',
          cyan: '#22d3ee',
          violet: '#a78bfa',
        },
      },
      boxShadow: {
        panel: '0 18px 50px -24px rgba(0, 0, 0, 0.9)',
        glow: '0 0 0 1px rgba(34, 211, 238, 0.25), 0 0 30px -6px rgba(34, 211, 238, 0.35)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 220ms ease-out',
        'slide-up': 'slideUp 260ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
