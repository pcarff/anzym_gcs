/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ['Cinzel', 'Georgia', 'serif'],
        mono: ['Space Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        display: ['Cinzel Decorative', 'Cinzel', 'serif'],
      },
      colors: {
        steampunk: {
          dark: '#0c0b0e',
          panel: '#15131a',
          surface: '#1e1a26',
          deep: '#070609',
          border: '#3c3227',
          'border-brass': '#7a6027',
          'border-copper': '#734125',
          parchment: '#f4ecd8',
          'parchment-muted': '#bfae91',
        },
        brass: {
          50: '#faf5e6',
          100: '#f3e7be',
          200: '#e7d185',
          300: '#dcb94e',
          400: '#d4af37',
          500: '#c59b27',
          600: '#9e791b',
          700: '#775813',
          800: '#543e0e',
          900: '#332508',
        },
        copper: {
          50: '#fdf4ef',
          100: '#fae5da',
          200: '#f3c8b4',
          300: '#ea9f7e',
          400: '#e07a5f',
          500: '#b87333',
          600: '#9c5924',
          700: '#7a421a',
          800: '#5a2f13',
          900: '#3b1d0a',
        },
        gold: {
          300: '#fae392',
          400: '#f5d461',
          500: '#f3ca52',
          600: '#cca023',
          700: '#997514',
        },
        tube: {
          amber: '#ff9e2c',
          green: '#2ec4b6',
          ruby: '#ef4444',
        },
      },
      boxShadow: {
        'brass-sm': '0 0 8px rgba(212, 175, 55, 0.2)',
        'brass-md': '0 0 16px rgba(212, 175, 55, 0.25)',
        'brass-lg': '0 0 24px rgba(212, 175, 55, 0.35)',
        'copper-sm': '0 0 8px rgba(184, 115, 51, 0.2)',
        'copper-md': '0 0 16px rgba(184, 115, 51, 0.3)',
        'amber-tube': '0 0 12px rgba(255, 158, 44, 0.45), 0 0 25px rgba(255, 158, 44, 0.2)',
        'ruby-tube': '0 0 12px rgba(239, 68, 68, 0.5), 0 0 25px rgba(239, 68, 68, 0.25)',
        'jade-tube': '0 0 12px rgba(46, 196, 182, 0.45), 0 0 25px rgba(46, 196, 182, 0.2)',
        'gauge-inset': 'inset 0 2px 6px rgba(0,0,0,0.8), inset 0 0 10px rgba(0,0,0,0.6)',
      },
      backgroundImage: {
        'brass-gradient': 'linear-gradient(135deg, #f3ca52 0%, #c59b27 50%, #775813 100%)',
        'copper-gradient': 'linear-gradient(135deg, #e07a5f 0%, #b87333 50%, #7a421a 100%)',
        'iron-gradient': 'linear-gradient(180deg, #1c1822 0%, #110f16 100%)',
        'metallic-bevel': 'linear-gradient(180deg, rgba(212, 175, 55, 0.15) 0%, rgba(0,0,0,0.3) 100%)',
      },
    },
  },
  plugins: [],
}

