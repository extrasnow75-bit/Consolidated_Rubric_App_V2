/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Boise State brand blue, per .claude/DESIGN_SYSTEM.md. Named so components can say
        // `bg-brand` rather than repeating the hex, and so the title-bar overlay in main.ts has
        // one place to agree with.
        brand: {
          DEFAULT: '#0033a0',
          // The pressed/hover step. Same value Canvas Extractor Tools uses, so a person moving
          // between the two apps sees one button, not two that nearly match.
          dark: '#002d8f',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
