# syntax=docker/dockerfile:1

# --- Build ---
FROM node:20-bookworm-slim AS build
WORKDIR /app
# Prisma heeft openssl nodig voor engine-generatie.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# Dependencies (postinstall draait prisma generate + kopieert de pdf.js-worker).
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm ci
# Broncode en build.
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Runtime ---
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# LibreOffice (Word->PDF) + lettertypen + openssl (Prisma) +
# Tesseract (OCR, Nederlands) en poppler-utils (pdftoppm) voor de OCR-terugval
# bij ingescande PDF's zonder tekstlaag. Alles draait lokaal, geen netwerk.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-calc \
      fonts-liberation fonts-dejavu ca-certificates openssl \
      tesseract-ocr tesseract-ocr-nld poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Draai als niet-root gebruiker.
RUN useradd -m -u 10001 appuser
COPY --from=build --chown=appuser:appuser /app ./

# Documentopslag (versleuteld) als volume.
RUN mkdir -p /data/documents && chown -R appuser:appuser /data
USER appuser

EXPOSE 3000
# Migraties uitvoeren en daarna de server starten.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node_modules/.bin/next start -p 3000 -H 0.0.0.0"]
