/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'sim-bg': 'var(--sim-bg)',
        'sim-surface': 'var(--sim-surface)',
        'sim-border': 'var(--sim-border)',
        'sim-text': 'var(--sim-text)',
        'sim-muted': 'var(--sim-muted)',
        'sim-red': 'var(--sim-red)',
        'sim-redHover': 'var(--sim-redHover)',
        'sim-selection': 'var(--sim-selection)',
      },
      boxShadow: {
        'cell-focus': '0 0 0 2px #0096FF',
      }
    },
  },
  plugins: [],
}


