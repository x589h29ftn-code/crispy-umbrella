import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Ondertekenportaal — Otto Visser & Partners',
  description: 'Veilig documenten aanbieden en online laten ondertekenen.',
  robots: { index: false, follow: false }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  )
}
