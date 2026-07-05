# PDF Studio

Een Windows-desktopapplicatie om PDF's te combineren, samenvoegen, splitsen en pagina's te beheren: slepen en neerzetten, miniaturen, in-/uitzoomen op een pan-canvas, en een volledig-scherm viewer met pijltjesnavigatie.

Gebouwd met Electron, Vite, TypeScript en React. PDF-weergave via [pdf.js](https://mozilla.github.io/pdf.js/), PDF-samenstelling en -versleuteling via [@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib) (de onderhouden pdf-lib-fork met encryptie-ondersteuning, puur JavaScript — geen native modules).

## Functies

- **Slepen en neerzetten**: PDF-bestanden ergens in het venster loslaten om ze te importeren.
- **Miniaturen per document**: elk geïmporteerd bestand wordt een documentgroep met al zijn pagina's als miniaturen op een rij.
- **Pagina's verplaatsen**: houd de muis ingedrukt op een miniatuur en sleep — een live voorbeeld volgt de cursor, een blauwe lijn toont de invoegplek, en pagina's schuiven met een animatie op hun plek. Binnen hetzelfde document, naar een ander document (samenvoegen), of naar een lege plek op het canvas (splitsen → nieuw document). Escape annuleert een sleep.
- **Documenten herordenen**: sleep de titelbalk van een document om de volgorde te wijzigen (zelfde ingedrukt-houden-gebaar).
- **Pagina's verwijderen of roteren**: knoppen verschijnen bij het aanwijzen van een miniatuur.
- **Documenten hernoemen of verwijderen**: dubbelklik op de naam om te hernoemen; kruisje in de titelbalk om te verwijderen.
- **In-/uitzoomen**: knoppen én een zoomslider in het zijmenu, Ctrl/Cmd+scrollen, of pinch-zoom; slepen op de achtergrond om te pannen. Bij de eerste import zoomt het canvas automatisch zó in dat de miniaturen direct goed leesbaar zijn. Miniaturen worden bij inzoomen op hogere resolutie (met oversampling) opnieuw gerenderd zodat ze ook op 250%+ scherp blijven, en een zwevende "Origineel"-knop rechtsonder brengt je terug naar 100%.
- **Horizontale schuifbalk**: zodra de ingezoomde inhoud breder is dan het venster verschijnt onderaan een sleepbalk om naar links en rechts te schuiven (klikken op de balk springt er direct heen).
- **Reader-first met tabbladen**: een geopend document verschijnt direct als leestabblad (zoals Acrobat Reader); ordenen (samenvoegen/splitsen/verplaatsen) blijft één klik weg via het "Overzicht"-tabblad. "Eén pagina" en "Naast elkaar" schalen automatisch zó dat de pagina('s) het venster vullen; zoomen kan vloeiend met Ctrl+scrollen (tot 500%), en met het muiswiel blader je naar de volgende/vorige pagina zodra er niets meer te scrollen valt. Het gereedschapspaneel heeft ook pagina-acties (roteren, verwijderen, samenvoegen/splitsen via het Overzicht), en met de knop rechtsboven (of Esc) schakel je een **presentatiemodus** in waarin alle menu's verdwijnen en alleen de PDF zichtbaar is.
- **Editor-weergave met tabbladen**: dubbelklik op een documentkop (of klik het tabblad-icoon) en het document opent als tabblad naast het "Overzicht" — zoals in Adobe Acrobat, maar in ons design. Links een strook paginaminiaturen, in het midden de pagina's (doorlopend scrollen, twee naast elkaar, of één pagina op ware grootte met bladeren), rechts een verticaal gereedschapspaneel met alle bewerkingstools: selecteren, markeren, tekenen, tekst, tekst bewerken, redigeren, commentaar, gum en de handtekening-tray. Zoomen met Ctrl+scrollen of de knoppen. Bewerkingen in een tabblad en in het overzicht werken op hetzelfde project door; samenvoegen/splitsen/verplaatsen doe je in het Overzicht-tabblad (knop "Ordenen in overzicht" onderin het paneel).
- **Volledig scherm**: klik op een miniatuur voor een grote weergave; blader met de pijltjestoetsen of de pijlknoppen door alle pagina's van het hele project. Zoom op de pagina zelf met de +/−-knoppen of Ctrl+scrollen, en versleep de ingezoomde pagina om te pannen.
- **Bewerkingsmenu in volledig scherm**: markeer met een kleur naar keuze (geel, rood, groen, blauw, oranje, roze) en instelbare doorzichtigheid — getekend met multiply-blend zodat de tekst eronder leesbaar blijft; teken of schrijf vrij met de pen (zelfde kleuren, drie lijndiktes) en haal getekende lijnen weg met de gum; voeg tekst toe met keuze uit Arial, Open Sans, Helvetica, Times en Courier, tekstgrootte, vet en cursief en een tekstkleur (Enter plaatst, Shift+Enter maakt een nieuwe regel, dubbelklik om bestaande tekst te bewerken); en plaats je handtekening vanuit de tray. Alles is naderhand te verslepen, aan te passen en te verwijderen, met undo/redo, en wordt exact zo geëxporteerd (rotatievast, net als handtekeningen). Arial en Open Sans worden als opensource-lettertypen (Liberation Sans/Open Sans, via fontkit gesubset) in de PDF ingebed, dus het document toont overal correct.
- **Pagina toevoegen met keuze**: de "Pagina toevoegen"-tegel vraagt eerst of je een lege pagina of pagina's uit een PDF-bestand wilt toevoegen.
- **Watermerk en paginanummers**: per document in- of uit te schakelen via de titelbalk; worden bij export op elke pagina getekend.
- **Handtekeningen plaatsen**: laad één of meer afbeeldingen (PNG/JPEG) via het zijmenu — bij meerdere handtekeningen verschijnt een klein menu om de actieve te kiezen of er een te verwijderen. Sleep hem in het volledig-scherm vanuit de tray op de pagina (wissel daar zo nodig van handtekening via het pijltje), en versleep of vergroot/verklein hem daarna. Geplaatste handtekeningen en markeringen zijn ook op de kleine miniaturen zichtbaar. De handtekening blijft aan de pagina "vastzitten": roteer je de pagina later, dan roteert de handtekening gewoon mee.
- **Wachtwoord op export**: vul een wachtwoord in via de werkbalk om de geëxporteerde PDF('s) met dat wachtwoord te beveiligen (AES).
- **Word, Excel en PowerPoint importeren**: open of sleep .docx/.xlsx/.pptx-bestanden (en .doc/.xls/.ppt, ODF, RTF, CSV) — ze worden automatisch naar PDF-pagina's omgezet. Met LibreOffice op de computer (gratis) gebeurt dat met perfecte opmaak voor alle formaten; zonder LibreOffice is er een ingebouwde omzetting voor Word (.docx) en Excel.
- **Redigeren (zwartlakken)**: teken zwarte vlakken over gevoelige informatie. Bij export wordt de pagina opnieuw opgebouwd met de vlakken ín de pixels gebrand — de onderliggende tekst zit dan écht niet meer in het bestand (niet te kopiëren, niet te doorzoeken, geverifieerd op byte-niveau). De rest van de pagina blijft doorzoekbaar via een onzichtbare tekstlaag.
- **Tekst bewerken op de pagina**: klik in de modus "Tekst bewerken" op een bestaande tekstregel — er opent een editor met de huidige tekst op dezelfde plek en grootte. Aanpassen of leegmaken (= regel verwijderen); het origineel wordt bij export definitief vervangen.
- **Commentaar met tijdlijn**: plaats opmerkingen op specifieke plekken op een pagina (spelden op de pagina en stipjes op de miniatuur), beantwoord ze en vink ze af als afgehandeld. Het zijmenu heeft een tijdlijn van alle opmerkingen (nieuwste eerst, met teller voor openstaande); klikken springt direct naar de juiste plek. Bij export worden het échte PDF-notities met reacties en status, zichtbaar in Adobe & co. Opmerkingen die al in een geopende PDF zitten (bv. uit Adobe) worden bij het importeren ingelezen — inclusief reacties en afgehandeld-status. Stel je naam in bovenin het opmerkingen-paneel: die komt bij nieuwe opmerkingen en reacties te staan, in de app én in de PDF. Met "Overzicht exporteren" maak je een nette overzichts-PDF van alle opmerkingen (per document, met auteur, tijd en status).
- **Vormen en stempels**: teken pijlen, lijnen, rechthoeken en ovalen (kleur en lijndikte instelbaar, verplaatsbaar, gum werkt), en plaats stempels — AKKOORD, CONCEPT, BETAALD of KOPIE — met de datum en je naam eronder. Alles ook op miniaturen zichtbaar en exact zo (als vector + tekst) in de export.
- **Formulieren invullen**: het gereedschap "Formulier" maakt invulbare PDF-velden (tekst, selectievakjes, keuzelijsten, keuzerondjes) direct op de pagina invulbaar. De waarden reizen mee in de export — na samenvoegen blijft het formulier gewoon werken — en met "Platslaan bij export" worden de velden definitieve, niet meer te wijzigen inhoud. Afdrukken gebruikt altijd de ingevulde (platgeslagen) weergave.
- **Bladwijzers / inhoudsopgave**: het zijmenu-paneel "Bladwijzers" toont de inhoudsopgave van alle geopende documenten; klikken springt direct naar de juiste pagina. Bij export blijven de originele bladwijzers behouden, en bij het samenvoegen van meerdere bestanden krijgt de export automatisch een bladwijzer per brondocument met de oorspronkelijke inhoudsopgave daaronder.
- **Afdrukken**: Ctrl+P of de knop "Afdrukken" in het zijmenu — het document wordt eerst exact zoals de export opgebouwd (inclusief alle bewerkingen) en dan via het normale Windows-afdrukvenster geprint.
- **Privacy-scan (AVG)**: doorzoekt het document automatisch op gevoelige gegevens — BSN's (met 11-proef), IBAN's (met mod-97-controle), e-mailadressen en telefoonnummers — en lakt de aangevinkte treffers met één klik écht zwart (de tekst verdwijnt uit het bestand, geverifieerd op byte-niveau).
- **Documenten vergelijken**: zet twee documenten of versies naast elkaar; de gewijzigde, toegevoegde en verwijderde tekstregels worden per pagina gemarkeerd (rood/oranje/groen) met een teller "X wijzigingen". Handig bij het nakijken van herziene offertes, contracten of jaarstukken.
- **Handtekening tekenen**: teken met de muis of trackpad een handtekening (in plaats van een afbeelding te uploaden); hij wordt automatisch bijgesneden en als handtekening opgeslagen.
- **Beveiligingsrechten**: naast het open-wachtwoord kun je afdrukken, kopiëren en bewerken voor de ontvanger blokkeren; de beperkingen worden bij export via encryptie afgedwongen (ook zonder open-wachtwoord).
- **Pagina's als losse bestanden**: selecteer pagina's en exporteer ze in één keer elk als apart PDF-bestand (gebundeld in een zip).
- **Nachtmodus voor het lezen**: keer de paginakleuren om voor comfortabel lezen in het donker — alleen op het scherm, niet in de export.
- **Delen met reMarkable**: stuur het actieve document rechtstreeks naar je reMarkable-cloud (en dus je tablet). De eerste keer koppel je de app één keer via een code van my.remarkable.com; daarna is het één klik. Uploads komen netjes in een map "PDF Studio". De koppeling gebeurt via de (onofficiële) reMarkable cloud-API — het device-token wordt lokaal bewaard, de upload draait in het main-proces (geen CORS). Ontkoppelen kan altijd.
- **Splitsen via selectie**: selecteer pagina's en klik "Nieuw document" in de selectiebalk — de pagina's verhuizen naar een nieuw document.
- **Zoeken in alle documenten**: Ctrl+F opent een zoekpaneel dat door de tekst van álle geladen documenten zoekt. Enter (of een klik op een treffer) markeert alle treffers geel op de pagina's en springt ernaartoe; met ‹ › (of Enter/Shift+Enter) blader je door de treffers. Sluit je het zoeken (kruisje of Escape), dan verdwijnen de markeringen automatisch.
- **Tekst-volgend markeren en redigeren**: sleep in de modus Markeren of Redigeren gewoon over de tekst — de markering of het zwarte vlak volgt automatisch de tekstregels (per regel strak om de tekst), zonder eerst zelf een net rechthoekje te hoeven tekenen. Buiten tekst (scans, marges) blijft het een gewone rechthoek. Tekst selecteren + kopiëren (met mini-menu voor markeren/onderstrepen/doorhalen) werkt in de Selecteren-modus in zowel het volledig scherm als de tabbladweergave.
- **Bladwijzers + Commentaar in één paneel**: het zijpaneel heeft twee tabbladen — de inhoudsopgave (klikken navigeert, in het leestabblad of volledig scherm) en de opmerkingen-tijdlijn.
- **Tekstherkenning (OCR) voor scans**: het zoekpaneel meldt gescande pagina's zonder tekstlaag; één klik op "Tekst herkennen (OCR)" herkent ze (Nederlands én Engels, via tesseract.js in het main-proces — volledig offline, de taaldata zit in de installer). Daarna zijn de scans doorzoekbaar in de app én krijgt de export een onzichtbare tekstlaag op woordpositie, zodat de PDF ook in andere programma's selecteerbaar en doorzoekbaar is. Zoektreffers lichten na een klik in het zoekpaneel even op de pagina zelf op.
- **Tekst selecteren en kopiëren**: in de modus "Selecteren" is de paginatekst gewoon selecteerbaar; na een selectie verschijnt een klein menu om te kopiëren of de selectie meteen te markeren, onderstrepen of doorhalen (tekst-volgend, per regel).
- **Recente bestanden en sessieherstel**: het startscherm toont recent geopende bestanden (één klik om te heropenen), en de hele werksessie — documenten met alle bewerkingen — wordt automatisch bewaard en bij het opstarten teruggezet. De installer registreert PDF Studio bovendien als "Openen met"-app voor PDF's; dubbelklikken op een PDF opent hem in het bestaande venster.
- **Automatische updates**: de geïnstalleerde app controleert op nieuwe versies (GitHub-releases), downloadt ze op de achtergrond en installeert bij de volgende start — met een "Nu opnieuw starten"-knop als je niet wilt wachten. Na een update verschijnt eenmalig een "Wat is nieuw"-overzicht.
- **Pagina's slepen in de editor**: in het tabblad-bewerkscherm versleep je pagina's in de miniaturenrail links om de volgorde te wijzigen; alle gereedschappen hebben er sneltoetsen (V/M/P/S/K/F/T/B/R/C/E, zichtbaar op de knoppen).
- **Documentdatum instellen**: via de kalenderknop in de documentkop (of het ⋯-menu) kies je een datum (bv. 1-1-2026) die bij export als aanmaak- én wijzigingsdatum in de PDF-metadata wordt geschreven — ook in combinatie met een exportwachtwoord. Een blauw label in de documentkop toont de ingestelde datum; klik erop om hem aan te passen.
- **Beveiligde PDF's openen**: importeer je een PDF mét wachtwoord, dan verschijnt een wachtwoord-prompt (met nette foutmelding bij een onjuist wachtwoord); het bestand wordt ontsleuteld ingeladen.
- **Ongedaan maken / opnieuw**: Ctrl+Z / Ctrl+Y (of Ctrl+Shift+Z) voor alle bewerkingen — verplaatsen, verwijderen, roteren, watermerk, handtekeningen, importeren — plus knoppen in de werkbalk.
- **Meerdere pagina's selecteren**: Ctrl+klik om pagina's aan de selectie toe te voegen, Shift+klik voor een bereik. Sleep één geselecteerde pagina en de hele selectie verhuist mee; Delete verwijdert, R roteert en Ctrl+D dupliceert de selectie; Esc wist de selectie.
- **Selectiebalk**: zodra je pagina's selecteert verschijnt onderin een zwevende actiebalk met roteren (linksom én rechtsom), dupliceren, verwijderen en selectie wissen — zoals in de meeste PDF-pakketten.
- **Sneltoetsen**: Ctrl+O openen, Ctrl+E alles exporteren als zip, naast bovenstaande selectie- en undo-sneltoetsen.
- **Meldingen**: geslaagde exports en fouten (onleesbaar bestand, mislukte export, overgeslagen beveiligd bestand) verschijnen als toast rechtsonder.
- **Exporteren**: "Exporteer PDF" slaat het actieve document op als los PDF-bestand; "Exporteer zip" bundelt alle documenten als aparte PDF's in één zip-bestand.

> Watermerk en paginanummers worden voor de eenvoud niet rotatiegecorrigeerd getekend (prima leesbaar, maar bij een 90°/270°-gedraaide pagina staan ze niet per se aan de "onderkant" zoals je op het scherm ziet). Handtekeningen zijn wél volledig rotatiecorrect: dat is uitgebreid getest, ook op gedraaide pagina's. Bijsnijden (crop) is bewust nog niet toegevoegd.

## Design

- **App-icoon**: een eigen icoon (`build/icon.ico`, `resources/icon.png`) voor de installer, snelkoppeling en taskbar, in plaats van het generieke Electron-icoon.
- **Iconenset**: consistente lijn-iconen (`src/renderer/src/components/icons.tsx`) in plaats van tekst-glyphs zoals ⟳ en ✕.
- **Licht/donker thema**: schakelaar in de werkbalk; volgt bij eerste start de systeeminstelling en onthoudt daarna je keuze.
- **Micro-animaties**: documenten die vloeiend herschikken bij toevoegen/verwijderen/herordenen, een hover-lift op miniaturen, een vloeiende overgang bij het wisselen van pagina in het volledig scherm, en een filmstrip onderaan het volledig scherm om snel te bladeren.
- **Inklapbaar zijmenu**: de werkbalk zit als verticaal menu links van het canvas, gegroepeerd met scheidingslijnen (undo/zoom · thema/handtekening/wachtwoord · openen/exporteren). Met het pijltje bovenin klap je hem in tot een smalle balk met alleen iconen; die keuze wordt onthouden.
- **Rustigere, strakkere chrome**: watermerk/paginanummers/lege pagina zitten achter een "⋯"-menu per document in plaats van altijd zichtbare knoppen; kaarten en dropdowns gebruiken zachte schaduwen in plaats van harde randen; knoppen zijn standaard randloos (ghost) met alleen "Exporteer zip" als opvallende primaire actie; een consistente 4/8/12/16px-spacingschaal en iets meer letter-spacing op kleine labels.

## Ontwikkelen

```bash
npm install     # installeert dependencies (downloadt ook het Electron-binary, ~200 MB)
npm run dev     # start de app met live-reload
```

## Bouwen voor Windows

```bash
npm run build:win
```

Dit levert in `dist/` zowel een NSIS-installer (`PDF Studio-1.3.0-setup.exe`) als een portable `.exe` op. Bouw op Windows zelf, of gebruik macOS/Linux met [`electron-builder`](https://www.electron.build/multi-platform-build) (Wine vereist voor het NSIS-installer target).

### Automatische build via GitHub Actions

De workflow `.github/workflows/build-windows.yml` bouwt de Windows-installer automatisch bij elke push naar `main` (en bij tags die met `v` beginnen, die ook een GitHub-release krijgen — inclusief `latest.yml`, de feed waarmee geïnstalleerde apps zichzelf automatisch bijwerken). Je kunt hem ook handmatig starten via het tabblad *Actions* → *Build Windows installer* → *Run workflow*. De `.exe`-bestanden staan daarna als artifact "pdf-studio-windows" bij de workflow-run.

Andere platforms:

```bash
npm run build:mac
npm run build:linux
```

> **Let op:** dit is gebouwd en getypecheckt in een sandbox zonder toegang tot GitHub-releases, waardoor het Electron-binary hier niet gedownload kon worden om de app zelf te draaien. De volledige broncode is wél getypecheckt (`npm run typecheck`) en de renderer-bundel is succesvol gebouwd en in een browser functioneel getest: drag & drop, samenvoegen/splitsen/roteren/verwijderen/dupliceren van pagina's (ook multi-select), undo/redo, zoomen, volledig-scherm navigatie, lege pagina invoegen, watermerk/paginanummers, documentdatum, handtekening plaatsen (ook op gedraaide pagina's, end-to-end via export en heropenen geverifieerd), beveiligde PDF's importeren, en PDF/zip-export met en zonder wachtwoord (onafhankelijk geverifieerd met pypdf). Alle dependencies zijn puur JavaScript — geen native modules — dus `npm install` en `npm run dev`/`build:win` werken zonder gedoe op een gewone ontwikkelmachine of in CI.

## Projectstructuur

```
src/
  main/        Electron main process (vensterbeheer, bestandsdialogen)
  preload/     Contextbrug tussen main en renderer
  renderer/    React-app (UI, canvas, PDF-verwerking)
```

## Licentie

MIT
