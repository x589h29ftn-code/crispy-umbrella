import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Strakke, professionele huisstijl (blauw-grijs met accent).
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#bcd3ff',
          300: '#8db6ff',
          400: '#578dff',
          500: '#2f66f0',
          600: '#1d4ed8',
          700: '#1a3fb0',
          800: '#1b378c',
          900: '#1b3271',
          950: '#141f45'
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
