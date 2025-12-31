/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'sim-bg': '#09090b',
        'sim-surface': '#18181b',
        'sim-border': '#27272a',
        'sim-text': '#fafafa',
        'sim-muted': '#71717a',
        'sim-red': '#ef4444',
        'sim-redHover': '#dc2626',
        'sim-selection': '#27272a',
      },
      boxShadow: {
        'cell-focus': '0 0 0 2px #ef4444',
      }
    },
  },
  plugins: [],
}
