// Eenmalig script: downloadt de OFL-scriptfonts van het officiële google/fonts-repo
// naar public/fonts/. Draai met: npm run fetch-fonts
// De fonts worden daarna gecommit zodat de app volledig offline werkt.
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts')
mkdirSync(outDir, { recursive: true })

const RAW = 'https://raw.githubusercontent.com/google/fonts/main'

// Per font: mapnaam in het google/fonts-repo (ofl/ tenzij anders vermeld) +
// kandidaat-bestandsnamen (het repo is niet consistent: soms Naam-Regular.ttf,
// soms Naam.ttf, soms een variable font). Yellowtail en Homemade Apple zijn
// Apache 2.0-fonts en staan in apache/.
const FONTS = [
  ['ofl/greatvibes', ['GreatVibes-Regular.ttf']],
  ['ofl/pinyonscript', ['PinyonScript-Regular.ttf']],
  ['ofl/mrssaintdelafield', ['MrsSaintDelafield-Regular.ttf']],
  ['ofl/tangerine', ['Tangerine-Regular.ttf']],
  ['ofl/dancingscript', ['DancingScript[wght].ttf', 'DancingScript-Regular.ttf']],
  ['ofl/allura', ['Allura-Regular.ttf']],
  ['ofl/rougescript', ['RougeScript-Regular.ttf']],
  ['ofl/petitformalscript', ['PetitFormalScript-Regular.ttf']],
  ['ofl/monsieurladoulaise', ['MonsieurLaDoulaise-Regular.ttf']],
  ['ofl/herrvonmuellerhoff', ['HerrVonMuellerhoff-Regular.ttf']],
  ['ofl/arizonia', ['Arizonia-Regular.ttf']],
  ['apache/yellowtail', ['Yellowtail-Regular.ttf']],
  ['ofl/sacramento', ['Sacramento-Regular.ttf']],
  ['ofl/norican', ['Norican-Regular.ttf']],
  ['ofl/kaushanscript', ['KaushanScript-Regular.ttf']],
  ['ofl/qwigley', ['Qwigley-Regular.ttf']],
  ['ofl/drsugiyama', ['DrSugiyama-Regular.ttf']],
  ['ofl/zeyada', ['Zeyada-Regular.ttf', 'Zeyada.ttf']],
  ['apache/homemadeapple', ['HomemadeApple-Regular.ttf']],
  ['ofl/labelleaurore', ['LaBelleAurore-Regular.ttf', 'LaBelleAurore.ttf']],
  ['ofl/meddon', ['Meddon-Regular.ttf', 'Meddon.ttf']],
  ['ofl/alexbrush', ['AlexBrush-Regular.ttf']]
]

function download(url, dest, minSize = 10_000) {
  // curl respecteert HTTPS_PROXY; -f faalt op 404 zodat we geen HTML-pagina opslaan
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', dest, url], { stdio: 'pipe' })
  const size = statSync(dest).size
  if (size < minSize) throw new Error(`bestand verdacht klein (${size} bytes)`)
  return size
}

let ok = 0
const failed = []
for (const [dir, candidates] of FONTS) {
  let done = false
  for (const file of candidates) {
    // Variabele fonts krijgen een simpele bestandsnaam zonder [wght]
    const destName = file.replace('[wght]', '')
    const dest = join(outDir, destName)
    if (existsSync(dest) && statSync(dest).size > 10_000) {
      console.log(`= ${destName} (al aanwezig)`)
      done = true
      break
    }
    try {
      const size = download(`${RAW}/${dir}/${encodeURIComponent(file)}`, dest)
      console.log(`✓ ${destName} (${Math.round(size / 1024)} KB)`)
      done = true
      break
    } catch {
      // probeer volgende kandidaat
    }
  }
  if (done) ok++
  else {
    failed.push(dir)
    console.warn(`✗ ${dir}: geen kandidaat gevonden`)
  }
}

// Hershey Script single-stroke fonts (penlijn-letterdata voor de stroke-engine).
// Bron: techninja/hersheytextjs (MIT); de Hershey-fonts zelf zijn vrij te
// gebruiken met bronvermelding. We bewaren alleen de drie script-varianten.
try {
  const tmp = join(outDir, 'hersheytext.tmp.json')
  download('https://raw.githubusercontent.com/techninja/hersheytextjs/master/hersheytext.min.json', tmp, 100_000)
  const all = JSON.parse(readFileSync(tmp, 'utf8'))
  const keep = {}
  for (const key of ['scripts', 'cursive', 'scriptc']) keep[key] = all[key]
  writeFileSync(join(outDir, 'hershey-script.json'), JSON.stringify(keep))
  rmSync(tmp)
  console.log('✓ hershey-script.json')
} catch (err) {
  console.warn(`✗ hershey-script.json kon niet worden gemaakt: ${err.message}`)
}

// Licentieteksten (verplicht meeleveren: SIL OFL voor de meeste fonts,
// Apache 2.0 voor Yellowtail en Homemade Apple)
for (const [src, name] of [
  ['ofl/greatvibes/OFL.txt', 'OFL.txt'],
  ['apache/yellowtail/LICENSE.txt', 'LICENSE-Apache.txt']
]) {
  try {
    download(`${RAW}/${src}`, join(outDir, name), 1_000)
    console.log(`✓ ${name}`)
  } catch {
    console.warn(`✗ ${name} kon niet worden gedownload`)
  }
}

console.log(`\nKlaar: ${ok}/${FONTS.length} fonts.` + (failed.length ? ` Mislukt: ${failed.join(', ')}` : ''))
if (failed.length) process.exitCode = 1
