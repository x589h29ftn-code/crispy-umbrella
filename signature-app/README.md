# Handtekening Studio

Nederlandstalige web-app om automatisch een persoonlijke handtekening te ontwerpen,
geïnspireerd op mysign.design — maar dan gratis, direct en volledig in de browser.

## Hoe het werkt

1. **Vragenlijst** — 14 korte vragen (naam, naamvarianten, schrijfhand, leesbaarheid,
   formaliteit, lijndikte, zwier, …) die de generatieparameters bepalen.
2. **Collecties** — je naam wordt live gerenderd in 22 stijlen, verdeeld over 6
   collecties (Elegant, Zakelijk, Klassiek, Modern, Abstract, Artistiek). Kies
   maximaal 9 stijlen uit maximaal 3 collecties.
3. **Resultaten** — download als PNG (transparant of wit), SVG of kopieer naar het
   klembord, en print een **oefenblad** met vervagende overtrek-stappen om de
   handtekening zelf te leren schrijven.

## Techniek

- Vite + React 18 + TypeScript, state via zustand met localStorage-persistentie.
- Handtekeningen worden met **opentype.js** omgezet naar vector-paden (geen
  `<text>`-elementen): per glyph worden schuinte, eerste-letter-schaal,
  baseline-golving en letterspacing toegepast, plus procedurele zwierpaden
  (onderstreping, doorhaling, omcirkeling, aanloop- en uitloopstreek) met
  deterministische seeds — previews zijn dus stabiel.
- Geëxporteerde SVG's bevatten alleen paden en zien er daardoor overal identiek
  uit, zonder geïnstalleerde fonts.
- De ~22 script-fonts (SIL OFL / Apache 2.0, zie `public/fonts/OFL.txt` en
  `LICENSE-Apache.txt`) zijn gecommit zodat de app offline werkt. Opnieuw
  downloaden kan met `npm run fetch-fonts`.

## Ontwikkelen

```bash
cd signature-app
npm install
npm run dev        # ontwikkelserver
npm run build      # typecheck + productie-build naar dist/
npm run preview    # gebouwde app bekijken
```

Er is geen backend: alles draait client-side en gegevens blijven op het eigen apparaat.
