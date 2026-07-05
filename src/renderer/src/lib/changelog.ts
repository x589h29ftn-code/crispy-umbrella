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
      'In volledig scherm kun je nu in- en uitzoomen zonder de modus te verlaten (zwevende zoomknoppen én Ctrl+scrollen), en volledig scherm opent sneller bij grote documenten'
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
