/**
 * "Wat is nieuw"-inhoud per versie, nieuwste eerst. Wordt één keer getoond
 * na een update (de laatst geziene versie staat in localStorage).
 */
export const APP_CHANGELOG: { version: string; items: string[] }[] = [
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
