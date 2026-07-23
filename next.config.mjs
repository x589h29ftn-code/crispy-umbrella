/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Lint draait als aparte CI-stap; de build mag er niet op vastlopen.
    ignoreDuringBuilds: true
  },
  experimental: {
    // Documenten uploaden via server-acties vraagt een ruimere body-limiet.
    serverActions: {
      bodySizeLimit: '20mb'
    },
    // pdf-lib, nodemailer e.d. mogen niet in de client-bundel belanden.
    serverComponentsExternalPackages: [
      '@cantoo/pdf-lib',
      '@pdf-lib/fontkit',
      'nodemailer',
      '@node-rs/argon2',
      '@e965/xlsx',
      // Documentherkenning: buiten de webpack-bundel houden zodat de
      // dynamische imports (worker/eval) op de server correct laden.
      'pdfjs-dist',
      'mammoth'
    ]
  }
}

export default nextConfig
