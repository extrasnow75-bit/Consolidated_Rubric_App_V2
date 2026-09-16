/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Boise State brand blue, per .claude/DESIGN_SYSTEM.md. Named so components can say
        // `bg-brand` rather than repeating the hex, and so the title-bar overlay in main.ts has
        // one place to agree with.
        brand: '#0033a0',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
