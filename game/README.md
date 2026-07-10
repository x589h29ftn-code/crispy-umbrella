# Verdant

Een vrolijk, low-poly openwereldspel voor Windows. Elke wereld wordt — net als
in Minecraft — procedureel gegenereerd uit een seed, maar dan met glad,
glooiend terrein: bossen, open velden, heuvels, stranden en zee. Je loopt rond
in first-person, springt, sprint, zwemt, en bouwt met preset-blokken je eigen
huisje in de wereld.

## Spelen

**Direct spelen:** download de nieuwste `Verdant-…-setup.exe` (installer) of
`Verdant ….exe` (portable, geen installatie nodig) van de
[Releases-pagina](https://github.com/x589h29ftn-code/crispy-umbrella/releases)
van deze repository. Elke push naar de game-branch bouwt daarnaast een
artifact via GitHub Actions (workflow "Bouw Verdant (Windows)").

| Actie | Besturing |
| --- | --- |
| Bewegen | WASD / pijltjestoetsen |
| Kijken | Muis |
| Springen / omhoog zwemmen | Spatie |
| Sprinten | Shift |
| Blok kiezen | 1–6 of scrollwiel |
| Blok plaatsen / weghalen | Linker- / rechtermuisknop |
| Pauze | Esc |
| Volledig scherm | F11 |

De wereld heeft een dag/nachtcyclus, dieren (konijnen, herten, vogels,
vlinders en 's nachts vuurvliegjes), wuivend sprietengras, varens, lupines
en bloemenweides, meertjes met gras tot aan de waterlijn, beklimbare bergen
tot ~85 m, kronkelpaden met lantaarnpaaltjes, verspreide hutjes waar je in
kunt, en één bijzonder plekje: een huisje aan een meer met steiger, moestuin
en graanveld (daar start je). Volledig gesynthetiseerde audio: kabbelend
water, wind, krekels, vogelzang en rustgevende generatieve muziek. Er zijn
geen asset-bestanden — alles is procedureel. Ultrawide-schermen krijgen
automatisch een breder blikveld (Hor+ FOV) en de rendering gebruikt MSAA
anti-aliasing met ACES tone mapping en bloom.

## Zelf bouwen

Vereist Node.js 20+.

```bash
cd game
npm install
npm run dev        # ontwikkelmodus
npm run build:win  # Windows-installer + portable exe in game/dist/
```

## Verificatie

```bash
npx tsx tests/pure-checks.ts   # determinisme, chunkranden, blok-opslag
npx tsx tests/smoke.ts         # headless browser-smoke-test + screenshots
```

## Technisch

Electron + Three.js + TypeScript (electron-vite). Terrein is een chunked
heightmap (64×64 m) uit gelaagde geseede simplex/fBm-ruis; physics gebruikt
exact dezelfde continue hoogtefunctie als de mesh. Bouwlokken liggen op een
1m-grid (DDA-raycast, per 16³-regio samengevoegde geometrie). Rendering met
ACES tone mapping, PCFSoft-schaduwen en bloom/vignette-postprocessing
(instelbaar in het pauzemenu).
