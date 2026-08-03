# Roadmap: automatische documentherkenning en voorgevulde berichten

Status: **MVP gebouwd** (juli 2026). Gekozen aanpak: **volledig lokaal**, geen cliëntdata
naar externe diensten.

## Wat er nu werkt

Bij het uploaden van een document herkent het portaal het type en het boekjaar en
vult het de titel en het begeleidend bericht automatisch voor. Herkende typen:
jaarrekening, notulen aandeelhoudersvergadering, bevestiging bij de jaarrekening,
akkoordverklaring inkomstenbelasting, akkoordverklaring vennootschapsbelasting en
opdrachtbevestiging.

- Tekst wordt uit de tekstlaag gelezen (digitale PDF's) of via `mammoth` uit Word;
  bij ingescande PDF's zonder tekstlaag valt de code terug op lokale OCR (Tesseract +
  poppler, aanwezig in de Docker-image).
- De invulvelden `{voornaam_klant}`, `{bedrijfsnaam}`, `{boekjaar}`, `{documenttitel}`
  en `{voornaam_afzender}` worden bij het verzenden per ontvanger ingevuld.
- Beheerders passen de teksten per type aan onder **Instellingen &rarr; Berichtsjablonen**.
- Cliënten hebben een veld **Voornaam** (voor een nette aanhef), ook in de CSV-import.
- **Samengevoegd verzoek:** worden meerdere documenten samen geüpload (jaarrekening,
  notulen en bevestiging gaan vrijwel altijd samen), dan worden titel en bericht
  automatisch samengevoegd tot één verzoek dat alle stukken benoemt. Elk document
  behoudt zijn eigen titel; de ontvanger tekent ze na één keer inloggen achter elkaar.

Kern-code: `src/lib/docanalyze/` (`extractText.ts`, `classify.ts`, `templates.ts`,
`analyze.ts`), datamodel `MessageTemplate` + `DocumentKind` + `Client.firstName` +
`Document.detectedKind/detectedYear/ocrUsed`.

## Oorspronkelijk ontwerp

## Doel

Bij het uploaden van een document herkent het portaal automatisch wat voor stuk het is
(bijvoorbeeld een jaarrekening) en het boekjaar, en vult op basis daarvan alvast in:

- de **titel/het onderwerp** van het verzoek, en
- de **begeleidende tekst** in de uitnodigingsmail, uit een aanpasbaar sjabloon.

Voorbeeld dat we willen ondersteunen. Er wordt een jaarrekening geüpload, waarna het
portaal voorstelt:

- Titel: `Jaarrekening 2024`
- Bericht:

  > Beste {voornaam klant}, in de bijlage ontvang je de definitieve jaarrekening over
  > {boekjaar}. Zou je hem willen voorzien van een handtekening? Groet,
  > {voornaam ondertekenaar}

De accountant kan alles altijd nog handmatig aanpassen voordat er verstuurd wordt.

## Uitgangspunten

1. **Tekstlaag eerst, OCR alleen als terugval.** De meeste stukken (jaarrekening uit
   Visionplanner, aangiftes) zijn PDF's met een tekstlaag. Die lezen we direct uit,
   snel en foutloos. Alleen als er (vrijwel) geen tekst in zit (een ingescand beeld),
   zetten we echte OCR in.
2. **Lokaal en AVG-veilig.** OCR draait in de eigen container met Tesseract en het
   Nederlandse taalpakket. Er gaat geen enkel document of tekstfragment naar een
   externe dienst.
3. **Voorstellen, niet opleggen.** Herkenning levert een suggestie. De gebruiker houdt
   volledige controle en kan titel en tekst overschrijven.
4. **Dataminimalisatie.** We bewaren alleen het herkende type en het boekjaar als
   metadata. De volledige uitgelezen tekst wordt niet opgeslagen.

## Architectuur (vijf onderdelen)

### 1. Tekstextractie met OCR-terugval

Nieuwe module `src/lib/ocr/extractText.ts`:

- Lees de tekstlaag uit de PDF (via `pdfjs-dist`, dezelfde library die de viewer al
  gebruikt, of `pdf-parse` server-side).
- Meet hoeveel bruikbare tekst er is. Bij weinig of niets: render de eerste paar
  pagina's naar afbeeldingen en draai die door Tesseract (`nld`).
- Retourneer de tekst van (maximaal) de eerste 1 tot 2 pagina's. Meer is voor
  classificatie niet nodig en houdt het snel.
- Time-out en nette opruiming van tijdelijke bestanden, net als bij de bestaande
  LibreOffice-conversie.

### 2. Documenttype- en boekjaarherkenning

Nieuwe module `src/lib/ocr/classify.ts`, regelgebaseerd (transparant en zonder externe
afhankelijkheid):

- Een tabel van typen met kernwoorden, bijvoorbeeld:
  - `JAARREKENING` bij "jaarrekening", "balans", "winst- en verliesrekening",
    "toelichting op de balans".
  - `AANGIFTE_IB` bij "aangifte inkomstenbelasting".
  - `AANGIFTE_VPB` bij "aangifte vennootschapsbelasting".
  - `SAMENSTELVERKLARING`, `VASTSTELLINGSOVEREENKOMST`, enzovoort.
- Boekjaar via een regex op een jaartal (20xx), bij voorkeur dicht bij woorden als
  "boekjaar" of "over het jaar".
- Er komt altijd een score/zekerheid mee. Bij lage zekerheid tonen we geen aanname maar
  laten we de velden leeg.

### 3. Berichtsjablonen (beheerbaar in Instellingen)

Nieuw datamodel en een beheerscherm, zodat het kantoor de teksten zelf onderhoudt:

- Per documenttype een standaard **titelsjabloon** en **berichtsjabloon** met
  invulvelden.
- Ondersteunde invulvelden: `{voornaam_klant}`, `{achternaam_klant}`, `{bedrijfsnaam}`,
  `{boekjaar}`, `{voornaam_ondertekenaar}`, `{documenttitel}`.
- Beheer onder Instellingen (alleen voor beheerders), met een voorbeeldweergave.

### 4. Autofill in "Nieuw dossier"

- Direct na het kiezen van een bestand roept de pagina een endpoint aan
  (`/api/documents/analyseren`) dat extractie plus classificatie doet.
- De herkende titel en het bericht worden voorgevuld, met invulvelden voor zover al
  bekend ingevuld en de rest als zichtbare token (bijvoorbeeld `{voornaam_klant}`).
- Analyse gebeurt op de achtergrond met een laadindicator, zodat het formulier
  bruikbaar blijft als herkenning even duurt.

### 5. Invulvelden resolveren

- `{boekjaar}` en `{documenttitel}` komen uit de herkenning.
- `{voornaam_ondertekenaar}` komt uit de naam van de ingelogde accountant.
- `{voornaam_klant}` / `{bedrijfsnaam}` worden ingevuld zodra de cliënt gekoppeld is,
  en anders bij het verzenden.

## Datamodel-wijzigingen (Prisma)

- Nieuw model `MessageTemplate`: `type` (enum `DocumentKind`), `titleTemplate`,
  `bodyTemplate`, `active`.
- Nieuwe enum `DocumentKind` (`JAARREKENING`, `AANGIFTE_IB`, `AANGIFTE_VPB`,
  `SAMENSTELVERKLARING`, `VASTSTELLINGSOVEREENKOMST`, `OVERIG`).
- `Client`: veld `firstName` toevoegen (voor een nette aanhef), met terugval op
  `contactName` of `companyName` als de voornaam ontbreekt.
- `Document`: optionele metadata `detectedKind` en `detectedYear` (voor inzicht en
  latere filtering), plus `ocrUsed` (bool) voor het auditspoor.

Elke wijziging via een reguliere Prisma-migratie.

## Nieuwe afhankelijkheden en Docker

- `tesseract-ocr` en `tesseract-ocr-nld` toevoegen aan de Docker-image (naast de al
  aanwezige LibreOffice). Dit vergroot de image beperkt.
- Server-side tekstextractie via `pdfjs-dist` (al aanwezig) of `pdf-parse`.
- Geen extra clouddienst, geen extra secrets.

## Beveiliging en AVG

- OCR en classificatie draaien lokaal; documenten verlaten de server niet.
- De uitgelezen tekst wordt alleen tijdens de analyse in het geheugen gebruikt en niet
  opgeslagen; alleen het herkende type en boekjaar worden als metadata bewaard.
- `ocrUsed` in het document maakt in het auditspoor zichtbaar dat OCR is toegepast.
- Bestaande maatregelen blijven gelden: uploadvalidatie, versleutelde opslag, en de
  gesandboxte verwerking zonder netwerktoegang.

## Nauwkeurigheid en terugval

- Herkenning is een hulpmiddel. Bij twijfel (lage score) vult het portaal niets in en
  kiest de gebruiker gewoon zelf.
- Alle voorgevulde teksten blijven bewerkbaar.
- De kernwoordtabel is eenvoudig uit te breiden naarmate jullie meer documentsoorten
  gebruiken.

## Gefaseerde uitvoering

1. **MVP:** tekstlaag-extractie, herkenning van jaarrekening plus een handvol typen,
   boekjaar-extractie, en één vast berichtsjabloon per type in code. Autofill in het
   nieuw-dossierscherm.
2. **Uitbreiding:** beheerbare sjablonen in Instellingen, veld `firstName` bij de
   cliënt, en de OCR-terugval voor ingescande stukken.
3. **Later, optioneel:** slimmere herkenning. Bewust nu niet gedaan om cliëntdata lokaal
   te houden; als dit ooit wenselijk is, eerst een privacyafweging maken en bij voorkeur
   een lokaal taalmodel gebruiken.

## Open keuzes voor later

- Welke documentsoorten willen jullie als eerste herkend hebben (naast jaarrekening)?
- Willen jullie per medewerker een eigen ondertekening onder het bericht, of één
  kantoorstandaard?
- Moet het boekjaar ook uit de bestandsnaam gehaald kunnen worden als aanvulling op de
  inhoud?
