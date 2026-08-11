/**
 * "Wat is nieuw"-inhoud per versie, nieuwste eerst. Wordt één keer getoond
 * na een update (de laatst geziene versie staat in localStorage).
 */
export const APP_CHANGELOG: { version: string; items: string[] }[] = [
  {
    version: '1.12.2',
    items: [
      'Soepeler scrollen door grote documenten. Een pagina werd pas gerenderd op het moment dat hij al in beeld schoof, waardoor je bij het scrollen eerst een grijs vlak zag: de kijkmarge werd afgekapt door de scrollende lijst. Nu wordt er twee pagina\'s vooruit en achteruit gerenderd, en staat er direct na een sprong in het document beeld op alle pagina\'s in zicht (gemeten op een document van 100 pagina\'s: 2 van de 2 pagina\'s meteen gevuld, voorheen 0 van de 2)',
      'Tijdens het scrollen wordt eerst een snelle voorvertoning getekend en pas daarna de scherpe versie, zodat de hoofdthread niet meer volloopt met pagina\'s waar je al voorbij bent. Op een document van 100 pagina\'s met een viermaal vertraagde processor: geen enkele hapering meer bij snel doorscrollen (was 11) en het langste beeldstop ging van 167 naar 50 milliseconden. Bij een sprong naar het midden van 317 naar 67 milliseconden',
      'Pagina\'s in beeld krijgen voorrang bij het renderen; pagina\'s die alleen in de kijkmarge staan wachten kort, zodat snel doorscrollen geen werk meer verspilt',
      'De selecteerbare tekstlaag wordt alleen nog voor de pagina\'s in beeld opgebouwd (en weer opgeruimd zodra je verder bent) in plaats van voor elke pagina die ooit geladen is — bij een groot document liepen dat duizenden onzichtbare tekstelementen die het scrollen zwaarder maakten',
      'Het paginaformaat wordt niet meer voor alle pagina\'s tegelijk opgevraagd bij het openen, maar pas als een pagina in de buurt komt; tot die tijd houdt de plaatshouder de verhouding van de eerste pagina aan',
      'Zelfde verbetering in het overzicht en in Vergelijken: ook daar werden miniaturen pas gerenderd als ze al in beeld stonden'
    ]
  },
  {
    version: '1.12.1',
    items: [
      'Vergelijken heeft er een wijzigingenpaneel bij: bovenaan staat hoeveel er is gewijzigd, daaronder alle wijzigingen op een rij. Klik een regel aan en beide documenten springen naar die plek, of loop ze af met de pijltjes en met F3 (Shift+F3 = terug). De teller laat zien waar je bent: "4 / 17"',
      'Kleurcodering en filters bij Vergelijken: geel = gewijzigd, groen = toegevoegd, rood = verwijderd, blauw = gewijzigd bedrag. Met de knopjes zet je een soort wijziging aan of uit, zodat je bijvoorbeeld alleen de bedragen ziet',
      'Kop- en voetteksten worden bij Vergelijken standaard genegeerd. Een gewijzigd jaartal in de voettekst of "pagina 3 van 48" op elke pagina liet voorheen het hele document oplichten; het aantal genegeerde regels staat bij het vinkje, dus je kunt ze altijd terugzetten',
      'Nieuwe cijfermodus bij Vergelijken: alleen bedragen en aantallen, met was, is, het verschil én de mutatie in procenten. Met een drempel ("vanaf verschil" en "vanaf mutatie %") filter je de ruis van een paar euro weg — precies de controle die je bij een jaarrekening doet',
      'Een regel waarvan alleen het bedrag wijzigde staat nu één keer in de lijst (als cijferwijziging) in plaats van twee keer. Ook worden toegevoegde en verwijderde pagina\'s als zodanig gemeld',
      'Het verschilrapport (PDF) en de jaar-op-jaar-export (Excel) volgen nu precies wat je in beeld hebt: dezelfde filters, dezelfde drempels — en ze zijn een stuk sneller omdat de vergelijking niet meer opnieuw wordt gedaan',
      '"Vergelijken" staat nu altijd in de zijbalk in plaats van alleen bij "Volledige werkbalk"',
      'Nieuw gereedschap Watermerk (Slim → Afwerken): kies met één klik CONCEPT, NIET VOOR PUBLICATIE of VOOR INTERN GEBRUIK, of typ je eigen tekst. Met doorzichtigheid, kleur (grijs, rood, blauw), schuin of horizontaal, eventueel alleen op de eerste pagina en desgewenst op alle documenten tegelijk — met een voorbeeld ernaast',
      'Het watermerk staat nu netjes gecentreerd en vult de pagina, ongeacht de lengte van de tekst (voorheen kon het scheef of half buiten de pagina staan). Op een documentkaart in het overzicht zie je met een merkje welk watermerk erop staat, en de drie vaste teksten zitten ook in het "…"-menu van de kaart',
      'Afbeeldingen kunnen nu rechtstreeks naar binnen: sleep een foto of schermafdruk (jpg, png, webp, gif, bmp) in de app en er wordt een PDF van gemaakt. Sleep je er meerdere in één keer in, dan worden ze samen één PDF met één pagina per afbeelding — handig voor bonnen of een gescande verklaring',
      'Bij Voorkeuren kies je hoe een afbeelding een pagina wordt: netjes op een A4 (standaard, met marge) of precies op maat van de afbeelding zonder witte randen',
      'Vergelijken opent voortaan passend: de twee pagina\'s vullen samen precies de breedte van het venster, bij elk formaat. Verberg je de wijzigingenlijst, dan worden ze meteen groter. Met de knop "Passend" ga je terug naar die stand (voorheen stond het vast op 100%, waardoor er ruimte onbenut bleef en de rechterpagina bij inzoomen onder het paneel verdween)',
      'Bij inzoomen in Vergelijken wordt de pagina nu opnieuw en scherper getekend; boven 200% werd het beeld eerder een vlek',
      'Vergelijken start met twee verschillende documenten. Kies je links en rechts hetzelfde, dan zeggen de keuzelijsten dat ("staat al rechts") en legt een melding uit waarom de lijst leeg is',
      'De wijzigingenlijst laat de volledige regel als tooltip zien, zodat een lange gewijzigde tekst leesbaar is zonder eerst naar de pagina te springen',
      'Nieuw op het startscherm: "Twee versies vergelijken" — kies twee bestanden en de vergelijking staat direct open',
      'De sneltoetsen van Vergelijken (F3, Shift+F3, Alt+pijltjes, Ctrl+muiswiel) staan nu in het sneltoetsen-overzicht',
      'De miniaturen in de leesstrook hebben een paginarand met schaduw; een pagina met alleen tekst bovenaan leek anders een los stukje tekst',
      'Kleine oneffenheden: de hint onderaan de zijbalk werd op een laptopscherm middenin de zin afgekapt, en de balk van Vergelijken liep op smallere vensters over twee regels',
      'Tabbladen zijn te slepen om ze op de gewenste volgorde te zetten; tijdens het slepen zie je met een blauw streepje waar het tabblad terechtkomt',
      'Het kruisje om een tabblad te sluiten is groter (24 bij 24 pixels) en kleurt rood bij aanwijzen',
      'Het opmerkingen- en bladwijzerpaneel staat nu naast het document in plaats van eroverheen: het overlapt de tabbalk, de documentbalk en het gereedschap niet meer, en het document schuift netjes op',
      'In het opmerkingenpaneel stonden de twee exportknoppen naast het naamveld, waardoor "Markeringen exporteren" buiten het paneel viel. De naam staat nu op een eigen regel met daaronder "Opmerkingen (PDF)" en "Markeringen (PDF)"',
      'De kop van de zijbalk ("Menu") staat op dezelfde hoogte als de tabbalk, met een doorlopende scheidingslijn, en de Menu-knop is geen los omlijnd blokje meer — dat zag eruit alsof hij boven het venster zweefde'
    ]
  },
  {
    version: '1.11.0',
    items: [
      'Miniaturen in het leestabblad zijn nu instelbaar: sleep de rand van de strook, of gebruik de − en + in het kopje "Pagina\'s". De strook klapt ook in (en weer uit) met het pijltje, net als het gereedschapspaneel rechts — dat kan nu ook ingeklapt worden',
      'Het overzicht opent voortaan vullend: de pagina\'s worden zo groot getoond dat een rij de hoogte van het canvas vult (voorheen bleef het op 100% met piepkleine miniaturen, omdat een document met veel pagina\'s nooit op de breedte paste). Met de knop "Passend" zet je dat op elk moment terug',
      'Elke documentkaart in het overzicht heeft nu een knop "Opslaan als PDF", zodat je het (samengevoegde of gesplitste) document meteen kunt wegschrijven',
      'Opgelost: de zoombalk links deed niets in een leestabblad en liep niet mee met Ctrl+scrollen. Hij bedient nu het venster waar je in zit — het document in een leestabblad, het overzicht daarbuiten — en dat geldt ook voor het percentage in de statusbalk',
      'De app start voortaan leeg: de PDF\'s van de vorige keer worden niet meer automatisch geopend, ook niet in het overzicht voor samenvoegen en splitsen. Wil je dat wél, zet dan "Vorige sessie herstellen bij opstarten" aan bij Voorkeuren',
      'Nieuw startscherm: een ruime sleepzone met daaronder de knoppen Openen, Combineren of splitsen, Sjablonen en Ondertekenen, plus je recent geopende bestanden met map en datum ("Vandaag", "Gisteren")',
      'Opgeruimde zijbalk: de acties staan gegroepeerd onder kopjes (Bestand, Bekijken, Documenten, Extra), het middendeel schuift mee en Exporteer PDF, Exporteer zip en Voorkeuren staan vast onderaan — vóór deze versie vielen die knoppen bij een normaal venster buiten beeld en waren ze onbereikbaar. Wil je alles zoals vroeger in de zijbalk? Zet "Volledige werkbalk" aan bij Voorkeuren',
      'Sneller opstarten: de PDF-motor (±0,6 MB) wordt pas geladen zodra je een document opent, waardoor er bij het starten ongeveer de helft minder programmacode ingelezen hoeft te worden. Ook wordt de update-controle pas na het opstarten gedaan',
      'Het venster onthoudt zijn grootte, positie en of het gemaximaliseerd stond, en opent meteen in de juiste themakleur (geen donkere flits meer bij een licht thema)',
      'Meerdere bestanden openen gaat nu drie tegelijk in plaats van één voor één, met een voortgangsbalk ("Bestanden openen… 3 van 12") zodat je ziet dat er gewerkt wordt',
      'Nieuwe sneltoetsen: Ctrl+W (tabblad sluiten), Ctrl+Tab en Ctrl+1…9 (wisselen tussen tabbladen) en Ctrl+A (alle pagina\'s van het document selecteren; nogmaals = alle documenten). Een tabblad sluit ook met een middelklik',
      'Escape sluit voortaan élk venster (ook Sjablonen, Ondertekenen, Slim, Privacy-scan en Handtekening tekenen), de Tab-toets blijft binnen het geopende venster en na sluiten keert de focus terug naar waar je was',
      'Beter met het toetsenbord te bedienen: overal een duidelijke blauwe focusring, en foutmeldingen blijven staan tot je ze wegklikt in plaats van na een paar seconden te verdwijnen',
      'Minder geheugengebruik bij lang doorwerken: gerenderde pagina-afbeeldingen worden begrensd bewaard en niet meer eindeloos opgestapeld',
      'Opgelost: een bestand dat je op het lege startscherm liet vallen werd twee keer geïmporteerd',
      'Samenvoegen in het overzicht is veel directer: sleep een PDF bovenop een document en je ziet "Toevoegen aan …" — hij komt er dan achter in plaats van als los document eronder. Laat je hem op de achtergrond vallen, dan wordt het (zoals altijd) een nieuw document; tijdens het slepen legt een hint het verschil uit',
      'Nieuw op elke documentkaart: een knop "Samenvoegen met…" waarmee je het document in één klik achter een ander document plakt, plus "Splitsen op inhoudsopgave…" in het "…"-menu',
      'De knoppen op een documentkaart staan nu direct naast de documentnaam (links) en zijn groter: bij inzoomen schoven ze voorheen rechts uit beeld',
      'Meerdere pagina\'s tegelijk naar een ander document verplaatsen kan nu ook zonder slepen: selecteer ze (Ctrl+klik of Shift+klik) en kies "Naar document…" in de selectiebalk',
      'Nieuw bij de Word- en Excel-export: kies zelf de getalopmaak — "Zoals in de PDF", "Zonder decimalen" (5.000,00 wordt 5.000) of "Twee decimalen" (5.000 wordt 5.000,00). Geldt voor bedragen, getallen en percentages; in Excel blijft de volledige waarde bewaard zodat sommen blijven kloppen',
      'Opgelost bij "Scans opschonen": het gereedschap maakte van élke pagina een afbeelding, ook van pagina\'s met een gewone tekstlaag — die waren daarna niet meer doorzoekbaar en niet meer naar Word of Excel te exporteren. Pagina\'s met tekst worden nu overgeslagen (met uitleg), en staat de pagina al recht en is er niets te corrigeren, dan blijft hij ongemoeid',
      'Opgelost bij "Splitsen op inhoudsopgave": pagina\'s vóór de eerste bladwijzer (voorblad, inhoudsopgave) verdwenen bij het splitsen. Ze komen nu als eerste deel terug. Ook krijgen twee hoofdstukken met dezelfde titel niet langer dezelfde documentnaam',
      'Lege pagina\'s worden nauwkeuriger herkend (op hogere resolutie en met een strengere drempel), zodat een pagina met alleen een regel tekst niet meer als leeg wordt voorgesteld',
      'Word-export flink verbeterd: koppen worden echte Word-kopstijlen (dus bruikbaar in het navigatievenster en voor een automatische inhoudsopgave), opsommingen worden echte lijsten, herkende tabellen worden echte Word-tabellen met een vette kopregel, alinea\'s lopen door in plaats van per regel af te breken (inclusief afbreekstreepjes) en terugkerende kop-/voetteksten blijven weg. Voorheen werd elke regel een losse alinea zonder tabellen of lijsten',
      'Excel-export gericht op tabellen: alleen blokken die écht een tabel zijn krijgen een werkblad, genoemd naar het kopje erboven ("Kolommenbalans") — voorheen werd elke pagina één werkblad, inclusief lopende tekst, kantoornaam en paginanummers. De beloofde vette, filterbare kopregel werkte niet en staat er nu wél. Wil je toch alles? Zet "Ook pagina\'s zonder herkende tabel meenemen" aan',
      'Opgelost bij redigeren: een zwart balkje in de witruimte tússen twee regels wiste de tekst van beide regels uit de tekstlaag, terwijl die tekst gewoon zichtbaar bleef staan. Nu telt alleen wat het balkje écht bedekt — en wat je afdekt verdwijnt nog steeds volledig uit het bestand',
      'Geredigeerde pagina\'s zijn scherper (240 dpi in plaats van 200, en waar dat kleiner uitpakt zonder verlies) en ingevulde formuliervelden blijven nu staan op een pagina waarop je iets redigeert — die verdwenen voorheen uit de export',
      'Slim → Hernoemen kiest bij gewone documenten nu de titel bovenaan de pagina ("Jaarrekening 2025") in plaats van "Document" met de kantoornaam uit het briefpapier',
      'Het venster "Slimme documenten" is opnieuw ingedeeld: de elf gereedschappen stonden in één lange rij tabbladen en staan nu gegroepeerd in een lijst links — Ordenen (hernoemen, sorteren, splitsen, dossier bundelen), Opschonen (lege pagina\'s, scans, comprimeren) en Eruit halen (Markdown, Word, Excel, CSV). Elk gereedschap heeft een regel uitleg, en wat nu niet kan is grijs met de reden erbij ("Hiervoor zijn minstens twee documenten nodig")',
      'Nieuw gereedschap "Markdown" (Slim → Markdown, of Menu → Exporteren als Markdown): zet een PDF om naar een net opgemaakt .md-bestand. Koppen worden herkend aan lettergrootte, vet en de bladwijzers van de PDF, opsommingen worden lijsten, uitgelijnde kolommen worden een Markdown-tabel, afgebroken woorden en losse regels worden weer hele alinea\'s, en terugkerende kop-/voetteksten (kantoornaam, "Pagina 3 van 12") vallen weg. Alles is per optie aan/uit te zetten en je ziet het resultaat meteen in een voorbeeld — opslaan als .md of kopiëren naar het klembord',
      'Comprimeren vernieuwd (Slim → Comprimeren): een schuifregelaar van "Kleinst (mailen)" tot "Vrijwel origineel" met daarbij direct de geschatte bestandsgrootte, het verwachte percentage winst én een voorbeeld van een pagina op die instelling, zodat je vóóraf ziet of het nog leesbaar is',
      'Comprimeren kan nu pagina\'s met tekst ongemoeid laten: die blijven scherp en doorzoekbaar en alleen de scans worden verkleind. Optioneel alles naar grijstinten, wat bij scans van zwarte tekst nog fors scheelt (in onze test: 2,0 MB → 0,4 MB)',
      'Bij het slepen van pagina\'s licht het doeldocument op en zie je precies tussen welke pagina\'s ze komen. Opgelost: de selectiebalk onderin ving de muis af, waardoor pagina\'s daar niet losgelaten konden worden'
    ]
  },
  {
    version: '1.10.0',
    items: [
      'Nieuw: menu linksboven (knop "Menu"), zoals in Adobe — met openen, bestanden combineren/splitsen, opslaan (als), alles exporteren, OneDrive, afdrukken, delen (mailen, reMarkable, los venster), ondertekenen, sjablonen, vergelijken, privacy-scan, slimme documenten, zoeken, voorkeuren en meer, netjes gegroepeerd; inclusief recent geopende bestanden',
      'Nieuw: Ondertekenen (knop "Ondertekenen") — een dashboard in ValidSign-stijl waarin je ziet wat je verstuurd hebt en of de tweede partij al getekend heeft. Maak een ondertekenverzoek van het huidige document of een gekozen bestand, plaats per ondertekenaar een tekenvak op de pagina, en volg de status (Concept, Verzonden, Gedeeltelijk, Ondertekend)',
      'Zelf ondertekenen kan op twee manieren tegelijk: een zichtbare handtekening-afbeelding én een echte digitale ondertekening (PAdES). Voor de gratis start maak je bij "Certificaat" een zelf-ondertekend certificaat aan; later kun je een AATL/gekwalificeerd .p12-certificaat importeren voor een vertrouwde handtekening',
      'Laat een tweede partij op een andere plek in het document tekenen: verstuur het via je eigen Outlook (ontvanger, onderwerp en begeleidende tekst worden vooraf ingevuld) en importeer het getekende bestand terug in het dashboard — de status springt dan automatisch op "Ondertekend"',
      'Herinneringen: bij een verzonden, nog niet getekend document toont het dashboard "x dagen geleden verzonden" en een knop die een herinneringsmail via Outlook klaarzet',
      'Elk dossier heeft een tijdlijn (aangemaakt, zelf-getekend, verzonden, herinnering, geïmporteerd) en de dossiers worden — net als de sjablonen — in de gedeelde bibliotheekmap bewaard, zodat het hele kantoor hetzelfde overzicht heeft'
    ]
  },
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
      'Sjablonen: invoercontrole per veld (e-mail, IBAN met controle­getal, postcode, KVK-nummer) met foutmelding en blokkade tot het klopt; geschiedenis van gegenereerde documenten (datum, klant, volgnummer, bestandsnaam); velden herordenen met pijltjes; Word-bestand vervangen met behoud van veldinstellingen (versie telt automatisch op); sjablonen dupliceren en als bestand exporteren/importeren om te delen; en een PDF-voorbeeld vóór het genereren',
      'Documentpakketten: bundel meerdere sjablonen (bv. AVA-notulen + uitkeringstoets + besluit) — je vult de gedeelde velden maar één keer in en genereert alles tegelijk als Word-zip of als één samengevoegde PDF',
      'Berekende velden: bijvoorbeeld dividendbelasting als percentage van het brutobedrag, of netto = bruto − belasting — automatisch uitgerekend, netjes als € en ook in woorden beschikbaar; berekeningen mogen op elkaar voortbouwen',
      'Kantoorgegevens: vaste variabelen zoals {Kantoornaam} en {Ondertekenaar} één keer instellen — in elk sjabloon beschikbaar en automatisch vooraf ingevuld',
      'Gedeelde bibliotheekmap: kies als beheerder één (netwerk-)map voor de sjablonen zodat het hele kantoor uit dezelfde bibliotheek werkt; bij het openen wordt de map telkens vers ingelezen en er is een Vernieuwen-knop; de bestaande bibliotheek verhuist automatisch mee',
      'Sjablonenbibliotheek georganiseerd: gegroepeerd op categorie, met een zoekbalk en favorieten (ster) bovenaan',
      'Klantkaarten importeren uit Excel/CSV — met een "ⓘ Kolomhulp" die per sjabloon laat zien welke kolomkoppen de import verwacht (bv. Klantnaam, Klantnummer, Adres, Telefoon, E-mail, Bedrijfsnaam)'
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
