# Blokkenwereld 🌿

Een rustgevende, oneindige voxelwereld in Minecraft-stijl — direct in de browser,
zonder installatie of build-stap. Gemaakt met Three.js (lokaal meegeleverd),
alle textures en geluiden worden procedureel gegenereerd.

## Starten

Open `index.html` in een moderne browser (Chrome, Edge of Firefox). Dat is alles.

> Tip: voor de beste prestaties gebruik je een browser met hardware-versnelling
> (WebGL) aan. Lokaal serveren kan ook: `python3 -m http.server` in deze map en
> dan naar `http://localhost:8000`.

## Wat zit erin

- **Oneindige, willekeurig gegenereerde wereld** — bergen, bossen, rivieren,
  meertjes, stranden en wandelpaden. Elke seed geeft een andere wereld.
- **Sfeervolle belichting** — zachte schaduwen, warme zonsop- en ondergangen,
  mist in de verte, ACES-tonemapping en een sterrenhemel met maan 's nachts.
- **Realistisch water** — bewegende golfjes, fresnel-reflecties van de lucht en
  glinstering van de zon.
- **Dag/nachtcyclus** — een dag duurt standaard 15 minuten en is instelbaar
  (1–60 min) via Instellingen.
- **Dorpjes met bewoners** — willekeurig geplaatste dorpen met huisjes, een
  waterput, paden en omheinde akkers met gewassen. Bewoners leven hun eigen
  leven: overdag wandelen en werken ze, 's avonds lopen sommigen met een
  fakkel rond en gaan ze hun huisje in.
- **Natuur** — gevarieerde bomen (eik, berk, den), wuivend gras, bloemen,
  struiken en riet. Schapen, konijnen, herten, vossen en eenden op het water,
  zwermen vogels, overdag vlinders en 's nachts vuurvliegjes.
- **Seizoenen** — lente, zomer, herfst en winter wisselen elkaar af (instelbaar
  aantal dagen per seizoen); gras en bladeren verkleuren en in de winter ligt er
  rijp over het land.
- **Sterrenhemel** — sterrenbeelden, af en toe een vallende ster en in koude
  nachten een groen noorderlicht.
- **Kampvuur & zitplekken** — plaats een kampvuur met vlammen, licht, rook en
  een knappend geluid; plaatbanken om omheen te zitten. Dorpen hebben hun eigen
  kampvuurtje op het plein.
- **Wegen tussen dorpen** — dorpen zijn met kronkelende paden met elkaar
  verbonden.
- **Bouwen** — blokken plaatsen en weghalen, hekjes bouwen, fakkels plaatsen
  (met echt licht) of in de hand houden. Kasteelblokken (bakstenen, bemoste
  bakstenen en doorzichtig glas) om muren, torens en ramen te bouwen. Trappen
  (met oriëntatie, je loopt er vanzelf op), platen/bankjes (halve blokken) en
  deuren die met de rechtermuisknop open en dicht gaan.
- **Bootjes** — houten roeibootjes drijven langs de oevers; laat er zelf een te
  water (B) en vaar over rivieren en meren (E om in/uit te stappen).
- **Hoge bergen** — dramatische, steile kliffen met besneeuwde toppen boven de
  boomgrens.
- **Weer** — willekeurige regen, onweer met bliksem en mistige dagen. Regen valt
  niet door daken — ook niet door daken die je zelf bouwt.
- **Rustige ambient-muziek** en natuurgeluiden (vogels, krekels, wind, regen) —
  volledig gesynthetiseerd, geen audiobestanden.
- **Opslaan & laden** — drie save-slots plus automatische autosave (elke minuut
  en bij afsluiten naar het hoofdmenu). Alles staat in localStorage.

## Besturing

| Toets | Actie |
| --- | --- |
| W A S D | Lopen |
| Muis | Rondkijken |
| Spatie | Springen / zwemmen |
| Shift | Rennen |
| Linkermuisknop | Blok weghalen |
| Rechtermuisknop | Blok plaatsen |
| 1–9 / scrollwiel | Blok kiezen |
| F | Fakkel vasthouden |
| B | Bootje te water laten |
| E | In-/uitstappen bootje |
| H | Hulp |
| Esc | Pauzemenu |

## Instellingen

Daglengte (minuten), kijkafstand, mist-dichtheid, beeldhoek (FOV), muziek- en
geluidsvolume, schaduwen en wolken. Instellingen worden automatisch bewaard.

## Technisch

- `src/noise.js` — seedbare ruis (value noise, fbm, ridged) en RNG
- `src/textures.js` — procedurele pixel-art texture-atlas
- `src/world.js` — terreingeneratie, rivieren, bomen, dorps-layouts
- `src/chunks.js` — chunk-streaming, meshing met ambient occlusion, watershader
- `src/sky.js` — hemelkoepel, zon/maan/sterren, wolken, dag/nachtcyclus
- `src/weather.js` — regen (met dak-occlusie), onweer, mist
- `src/entities.js` — bewoners, dieren, vogels, vuurvliegjes, fakkel-lichtpool
- `src/audio.js` — gesynthetiseerde muziek en geluiden (WebAudio)
- `src/player.js` — besturing, fysica, bouwen
- `src/ui.js` — menu's, HUD, save/load
- `src/main.js` — renderer en spelloop
