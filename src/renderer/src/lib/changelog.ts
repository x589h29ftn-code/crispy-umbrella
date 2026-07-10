/**
 * "Wat is nieuw"-inhoud per versie, nieuwste eerst. Wordt één keer getoond
 * na een update (de laatst geziene versie staat in localStorage).
 */
export const APP_CHANGELOG: { version: string; items: string[] }[] = [
  {
    version: '1.9.0',
    items: [
      'Vernieuwd verschilrapport: kleurcodering (rood = verwijderd, groen = toegevoegd, geel = gewijzigd), oude en nieuwe tekst netjes onder elkaar, een kop per hoofdstuk met paginaverwijzing en een legenda — professioneel om te delen (geen gele "markeerstift-vlek" meer)',
      'Excel-export mooier: getallen, bedragen, percentages en datums komen als échte waarden binnen (niet als tekst), met automatische kolombreedtes en een filterbare kopregel. Na het exporteren verschijnt een knop "Open Excel-bestand"',
      'Meer vormen om te tekenen: naast de pijl nu ook rechthoek, ovaal/cirkel, lijn, driehoek en een tekstballon (callout). Vrij tekenen kan met het penseel',
      'Werkbalk verbergen: klik op het kruisje in de zijbalk voor maximale documentruimte; een klein lipje links brengt de werkbalk terug',
      'In volledig scherm kun je nu in- en uitzoomen zonder de modus te verlaten (zwevende zoomknoppen én Ctrl+scrollen), en volledig scherm opent sneller bij grote documenten',
      'In volledig scherm kun je de miniaturen en de inhoudsopgave los tonen of verbergen met de knoppen "Miniaturen" en "Inhoud" linksboven',
      'Markeren voelt nu als tekst markeren: sleep in de modus Markeren over de tekst en je ziet de tekst oplichten (net als bij Selecteren) — bij loslaten krijgt precies die tekst de markeerkleur. Buiten tekst (scans) blijft het een gewoon sleepvak',
      'AVG-scan nauwkeuriger: bedragen in een jaarrekening worden niet meer per ongeluk als BSN gezien (een BSN wordt herkend als 9 aaneengesloten cijfers, of gegroepeerd alleen als het woord "BSN"/"sofinummer" op de regel staat), en bedrijfsnamen met tussenwoorden zoals "Timmerfabriek De Houtmolen Makkum B.V." of "Van der Meer Bouw B.V." worden nu wél herkend',
      'Veel soepeler scrollen door grote documenten: pagina\'s worden nu pas op hoge resolutie gerenderd wanneer ze in beeld komen (in plaats van alle pagina\'s tegelijk bij het openen), afbeeldingen worden buiten beeld gedecodeerd, en tijdens (Ctrl-)zoomen wordt pas scherp opnieuw gerenderd zodra het zoomen tot rust komt',
      'Exporteren naar bewerkbaar Word (.docx): via "Slim → Tekst → Als Word" met behoud van lettergroottes, koppen (vet) en een pagina-einde per pagina — dus geen blok platte tekst meer',
      'Excel-export met echte celopmaak: nette tabel met randen, een vetgedrukte filterbare kopregel (grijze balk) die in beeld blijft, en financiële opmaak — bedragen (€) en getallen met duizendtal-scheiding en negatieven in rood, percentages als echt percentage, en datums als échte (sorteerbare) datums. Ook boekhoudkundige negatieven zoals (1.234) en 1.234- worden herkend',
      'Documentsjablonen (knop "Sjablonen"): sla een Word-bestand met {variabelen} zoals {Klantnaam} op als sjabloon — de invoervelden worden automatisch herkend. Vul ze per klant in via een formulier (met verplichte velden en voortgang) en genereer een Word-document of PDF, met een instelbaar bestandsnaam-patroon zoals {Klantnaam} {datum} {templatenaam}',
      'Sjablonen uitgebreid: sectiegroepen (kopjes in het formulier), conditioneel zichtbare velden ("toon alleen als … is ingevuld/gelijk is aan …"), verborgen velden, plaatshouder- en toelichtingstekst per veld, beschrijving en versienummer, Concept opslaan (later verdergaan waar je was) en een automatisch oplopend {volgnummer} voor in de bestandsnaam of het document',
      'Sjablonen: bulk genereren vanuit Excel/CSV (kolomkoppen = veldsleutels of labels; één document per rij, samen in één zip, met doorlopende volgnummers en geschiedenis per rij)',
      'Sjablonen: klantkaarten — bewaar een ingevulde set klantgegevens en pas die met één klik toe op elk sjabloon (vaste gegevens nooit meer dubbel typen)',
      'Sjablonen: nieuwe veldtypen — Bedrag (€, nette notatie zoals € 50.000,00 én automatisch "in woorden": vijftigduizend euro), Keuzelijst (vaste opties) en instelbare datumnotatie (10-07-2026 of "10 juli 2026" — datums komen niet meer als 2026-07-10 in het document)',
      'Sjablonen: invoercontrole per veld (e-mail, IBAN met controle­getal, postcode, KVK-nummer) met foutmelding en blokkade tot het klopt; geschiedenis van gegenereerde documenten (datum, klant, volgnummer, bestandsnaam); velden herordenen met pijltjes; Word-bestand vervangen met behoud van veldinstellingen (versie telt automatisch op); sjablonen dupliceren en als bestand exporteren/importeren om te delen; en een PDF-voorbeeld vóór het genereren'
    ]
  },
  {
    version: '1.8.1',
    items: [
      'Bij gescande documenten verschijnt nu een duidelijke melding met een knop "Nu OCR uitvoeren" voordat je tekst, tabellen, vergelijken of de privacy-scan gebruikt',
      'Herkende (OCR-)tekst wordt nu ook echt gebruikt door tabellen, vergelijken, sorteren en de privacy-scan — niet meer alleen bij zoeken'
    ]
  },
  {
    version: '1.8.0',
    items: [
      'PDF kleiner maken (comprimeren) om makkelijk te mailen',
      'Opslaan in OneDrive en direct mailen als Outlook-bijlage',
      'Dossier bundelen: alle documenten in één PDF met voorblad en inhoudsopgave',
      'Vergelijken: doorlopend scrollen, vrij in-/uitzoomen en alle verschillen geel gemarkeerd in beide documenten',
      'Verschilrapport per hoofdstuk met inhoudsopgave, paginanummers en oude/nieuwe tekst',
      'Jaar-op-jaar: gewijzigde bedragen naar Excel met verschil en % mutatie',
      'AVG-redactie verbeterd: geredigeerde tekst is nu écht weg (ook onzichtbaar), BSN met spaties wordt herkend, en de categorieën staan overzichtelijk onder elkaar'
    ]
  },
  {
    version: '1.7.0',
    items: [
      'Tabellen uit een PDF naar Excel (.xlsx) — één werkblad per pagina, ideaal voor cijferoverzichten',
      'Handtekeningvelden: teken een invulbaar vak (handtekening, datum of tekst) dat de ontvanger kan invullen/ondertekenen',
      'Metadata opschonen bij export (auteur, maker, producer en verborgen XMP-data weg) — AVG',
      'Vergelijken herkent nu ook gewijzigde bedragen op dezelfde regel (jaarrekeningen), met een oud → nieuw-overzicht'
    ]
  },
  {
    version: '1.6.0',
    items: [
      'Soepeler scrollen door lange documenten (pagina\'s buiten beeld worden niet meer getekend)',
      'Miniaturen tot 500% vergroten met de zoomschuiver',
      'Groter en overzichtelijker "Slimme documenten"-venster',
      'Vergelijken: documenten toevoegen met een knop, PDF-metadata (titel, gemaakt/gewijzigd) per kant en een verschiloverzicht in een venster',
      'Privacy-scan met kiesbare categorieën: BSN, IBAN, e-mail, telefoon, postcode, KVK, datum, adres, bedrijfsnaam en naam',
      "Lege pagina's: zelf aanvinken welke je verwijdert",
      'Markeringen krijgen zachte, afgeronde hoeken zoals een markeerstift'
    ]
  },
  {
    version: '1.5.0',
    items: [
      'Sneller opstarten: het programma laadt de zware onderdelen pas wanneer je ze gebruikt',
      'Voorkeuren-scherm voor thema, naam, standaard leesweergave, nachtmodus en formulieren',
      'Statusbalk onderaan met document, aantal pagina\'s, selectie en zoomniveau',
      'Ctrl+S slaat het actieve document op (overschrijft het bronbestand indien bekend)',
      'Prullenbak: verwijderde pagina\'s zijn binnen de sessie terug te halen',
      'Sneltoetsen-overzicht (druk op ?)',
      'Uitlijn-hulplijnen die op het paginamidden snappen bij het slepen',
      'Grote documenten blijven soepel doordat pagina\'s pas in beeld worden gerenderd',
      'Een document in een eigen venster openen'
    ]
  },
  {
    version: '1.4.0',
    items: [
      'Splitsen op bladwijzer: een document opknippen langs zijn inhoudsopgave',
      'Tekst zoeken & vervangen (Ctrl+F → ⇄) in de paginatekst en tekstvakken',
      "Automatisch sorteren van pagina's op de herkende datum",
      'Tekst exporteren als .txt of Word-compatibel .rtf',
      'Verschilrapport als PDF bij "Vergelijken"'
    ]
  },
  {
    version: '1.3.0',
    items: [
      'Slimme documenten: automatisch hernoemen op inhoud (type, datum, afzender)',
      "Lege pagina's automatisch vinden en verwijderen",
      'Scans opschonen: rechtzetten (deskew) en achtergrond witter / tekst zwarter',
      'Gegevens uit facturen naar CSV (type, datum, bedrag, IBAN, afzender)',
      'Gemarkeerde tekst exporteren als overzichts-PDF'
    ]
  },
  {
    version: '1.2.0',
    items: [
      'Privacy-scan (AVG): vindt BSN, IBAN, e-mail en telefoon en lakt ze met één klik écht zwart',
      'Documenten vergelijken: twee versies naast elkaar met gemarkeerde verschillen',
      'Handtekening tekenen met de muis, naast een afbeelding uploaden',
      'Beveiligingsrechten: afdrukken, kopiëren of bewerken blokkeren voor de ontvanger',
      "Pagina's exporteren als losse PDF-bestanden in één zip",
      'Nachtmodus voor comfortabel lezen in het donker',
      'Delen met reMarkable-cloud; leesweergave met tabbladen en presentatiemodus',
      'Vloeiender zoomen, venstervullend lezen en muiswiel-bladeren'
    ]
  },
  {
    version: '1.1.0',
    items: [
      'Vormen: pijlen, lijnen, rechthoeken en ovalen tekenen',
      'Stempels (AKKOORD, CONCEPT, BETAALD, KOPIE) met datum en je naam',
      'Formulieren invullen op de pagina, met optie "Platslaan bij export"',
      'Opmerkingen uit bestaande PDF\'s worden ingelezen, met auteursnaam en overzicht-export',
      'Bladwijzers-paneel + automatische bladwijzers bij samenvoegen',
      'Pagina\'s slepen in de editor-rail en sneltoetsen voor alle gereedschappen',
      'Recente bestanden, PDF-bestandskoppeling en automatisch sessieherstel',
      'Tekst selecteren en kopiëren, onderstrepen/doorhalen, afdrukken (Ctrl+P)',
      'Zoektreffers oplichten op de pagina; OCR nu ook in het Engels',
      'De app werkt zichzelf voortaan automatisch bij'
    ]
  }
]
