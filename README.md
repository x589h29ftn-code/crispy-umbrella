# PDF Studio

Een Windows-desktopapplicatie om PDF's te combineren, samenvoegen, splitsen en pagina's te beheren: slepen en neerzetten, miniaturen, in-/uitzoomen op een pan-canvas, en een volledig-scherm viewer met pijltjesnavigatie.

Gebouwd met Electron, Vite, TypeScript en React. PDF-weergave via [pdf.js](https://mozilla.github.io/pdf.js/), PDF-samenstelling via [pdf-lib](https://pdf-lib.js.org/).

## Functies

- **Slepen en neerzetten**: PDF-bestanden ergens in het venster loslaten om ze te importeren.
- **Miniaturen per document**: elk geïmporteerd bestand wordt een documentgroep met al zijn pagina's als miniaturen op een rij.
- **Pagina's verplaatsen**: sleep een pagina naar een andere plek in hetzelfde document, naar een ander document (samenvoegen), of naar een lege plek op het canvas (splitsen → nieuw document).
- **Documenten herordenen**: sleep de titelbalk van een document om de volgorde te wijzigen.
- **Pagina's verwijderen of roteren**: knoppen verschijnen bij het aanwijzen van een miniatuur.
- **Documenten hernoemen of verwijderen**: dubbelklik op de naam om te hernoemen; kruisje in de titelbalk om te verwijderen.
- **In-/uitzoomen**: knoppen in de werkbalk, Ctrl/Cmd+scrollen, of pinch-zoom; slepen op de achtergrond om te pannen.
- **Volledig scherm**: klik op een miniatuur voor een grote weergave; blader met de pijltjestoetsen of de pijlknoppen door alle pagina's van het hele project.
- **Lege pagina invoegen**: knop in de documenttitelbalk voegt een lege A4-pagina toe.
- **Watermerk en paginanummers**: per document in- of uit te schakelen via de titelbalk; worden bij export op elke pagina getekend.
- **Handtekening plaatsen**: laad een afbeelding (PNG/JPEG) via de werkbalk, sleep hem in het volledig-scherm vanuit de tray op de pagina, en versleep of vergroot/verklein hem daarna. De handtekening blijft aan de pagina "vastzitten": roteer je de pagina later, dan roteert de handtekening gewoon mee.
- **Wachtwoord op export**: vul een wachtwoord in via de werkbalk om de geëxporteerde PDF('s) met dat wachtwoord te beveiligen (AES, via [muhammara](https://github.com/julianhille/MuhammaraJS)).
- **Exporteren**: "Exporteer PDF" slaat het actieve document op als los PDF-bestand; "Exporteer zip" bundelt alle documenten als aparte PDF's in één zip-bestand.

> Watermerk en paginanummers worden voor de eenvoud niet rotatiegecorrigeerd getekend (prima leesbaar, maar bij een 90°/270°-gedraaide pagina staan ze niet per se aan de "onderkant" zoals je op het scherm ziet). Handtekeningen zijn wél volledig rotatiecorrect: dat is uitgebreid getest, ook op gedraaide pagina's. Bijsnijden (crop) is bewust nog niet toegevoegd.

## Design

- **App-icoon**: een eigen icoon (`build/icon.ico`, `resources/icon.png`) voor de installer, snelkoppeling en taskbar, in plaats van het generieke Electron-icoon.
- **Iconenset**: consistente lijn-iconen (`src/renderer/src/components/icons.tsx`) in plaats van tekst-glyphs zoals ⟳ en ✕.
- **Licht/donker thema**: schakelaar in de werkbalk; volgt bij eerste start de systeeminstelling en onthoudt daarna je keuze.
- **Micro-animaties**: documenten die vloeiend herschikken bij toevoegen/verwijderen/herordenen, een hover-lift op miniaturen, een vloeiende overgang bij het wisselen van pagina in het volledig scherm, en een filmstrip onderaan het volledig scherm om snel te bladeren.

## Ontwikkelen

```bash
npm install     # installeert dependencies (downloadt ook het Electron-binary, ~200 MB)
npm run dev     # start de app met live-reload
```

## Bouwen voor Windows

```bash
npm run build:win
```

Dit levert in `dist/` zowel een NSIS-installer (`PDF Studio-1.0.0-setup.exe`) als een portable `.exe` op. Bouw op Windows zelf, of gebruik macOS/Linux met [`electron-builder`](https://www.electron.build/multi-platform-build) (Wine vereist voor het NSIS-installer target).

Andere platforms:

```bash
npm run build:mac
npm run build:linux
```

> **Let op:** dit is gebouwd en getypecheckt in een sandbox zonder toegang tot GitHub-releases, waardoor het Electron-binary hier niet gedownload kon worden om de app zelf te draaien. De volledige broncode is wél getypecheckt (`npm run typecheck`) en de renderer-bundel is succesvol gebouwd en in een browser functioneel getest: drag & drop, samenvoegen/splitsen/roteren/verwijderen van pagina's, zoomen, volledig-scherm navigatie, lege pagina invoegen, watermerk/paginanummers, handtekening plaatsen (ook op gedraaide pagina's, end-to-end via export en heropenen geverifieerd), en PDF/zip-export. De wachtwoordbeveiliging (`muhammara`) is apart geverifieerd door de main-process module direct aan te roepen. `npm install` en `npm run dev`/`build:win` werken normaal op een gewone ontwikkelmachine of in CI met internettoegang.
>
> `muhammara` is een native Node-module (Apache-2.0) die tijdens `npm install` een platform-specifieke prebuilt binary ophaalt. Dat vereiste in deze sandbox toegang tot GitHub-releases die normaal niet beschikbaar is — het lukte hier onverwacht toch, maar reken erop dat dit gewoon werkt op een normale ontwikkelmachine of CI. `npm run build:win`/`electron-builder install-app-deps` zorgt dat de juiste Electron-ABI-variant wordt gebruikt.

## Projectstructuur

```
src/
  main/        Electron main process (vensterbeheer, bestandsdialogen)
  preload/     Contextbrug tussen main en renderer
  renderer/    React-app (UI, canvas, PDF-verwerking)
```

## Licentie

MIT
