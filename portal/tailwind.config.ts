import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Huisstijl Otto Visser & Partners, afgeleid van het logo (blauwtinten).
        brand: {
          50: '#eff6fc',
          100: '#d8e9f6',
          200: '#b6d5ee',
          300: '#86b9e1',
          400: '#5b9bd5', // lichtblauw uit het logo
          500: '#3182c4',
          600: '#2b6cad', // logoblauw (Visser & Partners)
          700: '#25588c',
          800: '#214b74',
          900: '#1f4061',
          950: '#152a41'
        }
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif']
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.08)',
        pop: '0 8px 24px rgba(16,24,40,0.12)'
      }
    }
  },
  plugins: []
}

export default config
