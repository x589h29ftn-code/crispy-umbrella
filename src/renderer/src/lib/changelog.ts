/**
 * "Wat is nieuw"-inhoud per versie, nieuwste eerst. Wordt één keer getoond
 * na een update (de laatst geziene versie staat in localStorage).
 */
export const APP_CHANGELOG: { version: string; items: string[] }[] = [
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
