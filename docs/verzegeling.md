# Verzegeling, tijdstempel en achtergrondtaken

> **Sinds changeset v1.7: het organisatiezegel is de normale route.**
>
> Drie besluiten van het kantoor bepalen dit. Een jaarrekening krijgt bij
> samenstellen géén beroepscertificaat, want dat is niet voorgeschreven. Er wordt
> per dossier ondertekend, niet in batches. En de accountant tekent ingelogd, met
> herverificatie op het ondertekenmoment.
>
> Gevolg: in een gewoon dossier is er **één** cryptografische handtekening, het
> organisatiezegel, en het beroepscertificaat is de uitzondering. De hele
> batchmachinerie en de externe afhankelijkheid van een provider verdwijnen
> daarmee uit het dagelijkse pad.
>
> | `SEAL_MODE` | Betekenis |
> |---|---|
> | `none` | geen cryptografische handtekening. Banner in het portaal, regel op het certificaat, en `VERZEGELING_OVERGESLAGEN` in het auditspoor. In productie ook `ALLOW_UNSEALED=true` nodig. |
> | `organisation` | **route A, de normale route.** Certificerend organisatiezegel met DocMDP P=1, onbeheerd en onzichtbaar. |
> | `qualified` | **route B, de uitzondering.** Alleen voor SBR-verklaringen en het waarmerken van een SBR-jaarrekening. Vereist een werkende `PROFESSIONAL_SIGNING_DRIVER`. |
>
> `sealer` blijft geaccepteerd als oude naam voor `qualified`, zodat een bestaand
> `.env` niet stilvalt.
>
> Eén eigenschap die het ontwerp draagt en die je moet bewaken: **iedere
> handtekening van iedere partij is een visuele stempel; alleen het zegel aan het
> eind is cryptografisch.** Daardoor is de ondertekenvolgorde vrij configureerbaar
> zonder cryptografische gevolgen. Dat is geen toeval maar de reden dat de
> accountant een gewone ontvanger kan zijn.
>
> De zichtbare tekst hangt af van de documentsoort: op een jaarrekening staat
> "Ondertekend door \<naam\>, RA", op een stuk waarin de cliënt iets verklaart
> "Verzegeld door Otto Visser & Partners Accountants". Dat laatste is bewust: bij een
> akkoordbrief wil je niet de indruk wekken dat de accountant de verklaring van de
> cliënt mede onderschrijft. Instelbaar met `SIGN_AS_AUTHOR_KINDS`.

Deze notitie beschrijft wat er bij het hosten extra nodig is sinds het portaal
documenten cryptografisch kan verzegelen. Bedoeld voor de beheerder/IT'er.

## Waarom

Tot nu toe kreeg een afgerond document een zichtbaar stempel per ondertekenaar en
een ondertekencertificaat met een SHA-256-vingerafdruk. Die vingerafdruk stond
alleen in onze eigen database. Een ontvanger kon daarmee niet zelf vaststellen dat
het stuk onveranderd was.

Met de verzegeling komt er een **digitale handtekening in het document zelf**
(PAdES). Adobe Acrobat en andere lezers laten dan zien: wie het heeft verzegeld,
wanneer, en of er na ondertekening iets is gewijzigd.

## Twee nieuwe containers

`docker compose up -d --build` start nu vijf services in plaats van drie:

| Service | Rol | Publiek bereikbaar |
|---|---|---|
| `db` | PostgreSQL | nee |
| `web` | het portaal | via Caddy |
| `caddy` | HTTPS/reverse proxy | ja (80/443) |
| **`worker`** | achtergrondtaken (verzegeling opnieuw proberen) | nee |
| **`sealer`** | verzegelen met pyHanko | **nee, bewust niet** |

De `sealer` heeft **geen `ports:`-blok en geen Caddy-route**. Hij is alleen
bereikbaar op het interne Docker-netwerk en vraagt bij elke aanroep een shared
secret in de header `X-Sealer-Secret`. Geef hem geen route naar buiten.

## Instellen

### 1. Zonder certificaat starten (standaard)

In `.env` staat standaard:

```
SEAL_MODE="none"
```

Dan werkt het portaal precies als voorheen: zichtbare stempels en het
ondertekencertificaat, maar **geen** digitaal zegel. Handig om eerst te testen.
De `sealer`-container mag dan gewoon meedraaien; hij wordt niet gebruikt.

### 2. Route A aanzetten — het organisatiezegel (de normale route)

Nodig: een **organisatiecertificaat** (eSeal) waarvan de private sleutel bij de
aanbieder in een cloud-HSM staat, plus een **tijdstempeldienst (TSA)**.

> Zet nooit een `.pfx` of `.p12` op de server. Dat mag niet meer en is praktisch
> onverdedigbaar.

```
SEAL_MODE="organisation"
SEALER_SHARED_SECRET="<openssl rand -base64 48>"
SEAL_DRIVER="csc"
TSA_URL="https://<tijdstempeldienst>/tsr"
PADES_LEVEL="lt"
```

Dit is het dagelijkse pad. Een jaarrekening krijgt bij samenstellen géén
beroepscertificaat — dat is niet voorgeschreven — dus in een gewoon dossier is er
precies **één** cryptografische handtekening: het organisatiezegel. Het gaat
onbeheerd, dus er komt geen telefoon of pincode aan te pas, en het is onzichtbaar:
de zichtbare verantwoording staat op het ondertekencertificaat.

**`PADES_LEVEL=lt` is een eis, geen voorkeur.** Bij LTA komt er een losse
document-timestamp als incrementele update bovenop, en dat is precies de
combinatie die met een certificerende handtekening wringt. Bij LT zit de
tijdstempel ín de handtekening. De sealer weigert `lta` in combinatie met
certificeren; niet "verbeteren".

### 3. Route B — het beroepscertificaat (de uitzondering)

Alleen voor documentsoorten waar een beroepscertificaat wél vereist is: een
SBR-accountantsverklaring of het waarmerken van een SBR-jaarrekening. Niet nodig
om live te gaan.

```
SEAL_MODE="qualified"
PROFESSIONAL_SIGNING_DRIVER="cleverbase"
CLEVERBASE_CSC_BASE_URL=""
CLEVERBASE_CSC_CLIENT_ID=""
CLEVERBASE_CSC_CLIENT_SECRET=""
CLEVERBASE_CSC_ENV="production"
CLEVERBASE_REDIRECT_URI="https://<domein>/api/csc/callback"
```

Zet daarna per accountant het certificaat aan onder **Instellingen → Gebruikers**.

De app **weigert te starten** met `SEAL_MODE=qualified` en
`PROFESSIONAL_SIGNING_DRIVER=none`: er zou dan niets worden verzegeld terwijl de
configuratie zegt van wel. Dat is de gevaarlijkste stille toestand die er is.

## Hoe het in de praktijk verloopt

De volgorde is strikt, want zodra er een handtekening in een PDF zit mag het
bestand niet meer worden bewerkt.

### Route A (normaal)

1. Alle zichtbare stempels plaatsen, in vaste volgorde (`Recipient.order`, dan `id`).
2. Ondertekencertificaat als extra pagina toevoegen.
3. **Plat slaan**, en controleren dat het gelukt is: nul annotaties, nul
   formuliervelden. Faalt die controle, dan stopt de pipeline. De stempels moeten
   pagina-inhoud zijn; blijven het annotaties, dan kan een viewer ze als
   verwijderbaar presenteren.
4. `preSealKey` en `preSealSha256` vastleggen.
5. **Organisatiezegel, certificerend, DocMDP P=1 (`NO_CHANGES`)**, onbeheerd en
   onzichtbaar. Zet `sealStage = SEALED` en vult `sealedKey`, `sealedSha256`,
   `timestampedAt`, `sealCertSerial` en `sealTsaUrl`.
6. Voltooiingsmail met het verzegelde bestand als bijlage, de SHA-256 in de body en
   een downloadlink.

Doorlooptijd na de laatste ondertekening: seconden.

Geen leeg handtekeningveld vooraf plaatsen, en geen FieldMDP-lock: het zegel is de
eerste handtekening in het document en mag zijn eigen veld aanmaken, en P=1
vergrendelt daarna alles.

### Route B (uitzondering)

Stap 1 t/m 3 gelijk. Daarna:

4. **Leeg handtekeningveld** aanmaken voor de accountant. Dit moet vóór het
   certificeren: een veld toevoegen aan een gecertificeerd document is onder P=2
   geen toegestane wijziging. De certificeerder plaatst het veld, de tweede partij
   vult het.
5. **Organisatiezegel, certificerend, P=2 (`FILL_FORMS`)**, onbeheerd.
6. Dossier naar `WACHT_OP_WAARMERK`. **Geen mail.**
7. De accountant autoriseert via CSC. De hash gaat mee in die aanvraag en wordt dus
   berekend over het **org-verzegelde** document uit stap 5.
8. Het beroepscertificaat tekent in het bestaande veld, met een FieldMDP-lock.
9. `sealedKey`, `sealStage = SEALED`, dan pas de mail.

> Het org-verzegelde tussenresultaat mag het systeem **nooit** verlaten. Geen mail,
> geen download, geen archivering. Anders bestaan er twee versies met verschillende
> hashes en meldt onze eigen integriteitscontrole later een afwijking op de versie
> die de cliënt heeft.

## Wat we hierover wel en niet beweren

Twee dingen niet overdrijven, ook niet richting cliënten:

1. Geen enkel PDF-mechanisme verhindert fysiek dat iemand bytes aan een bestand
   plakt. Je krijgt preventie in de praktijk en detectie in beginsel. Dat geldt voor
   elke leverancier precies zo — het is nagemeten in
   `scripts/regressie/certificering.py`.
2. Het gedrag verschilt per viewer. In Acrobat staan de bewerkgereedschappen op
   grijs; andere viewers laten de bewerking soms toe en melden daarna de schending.

Schrijf dus niet "het document kan niet worden gewijzigd" maar **"wijzigen wordt
geblokkeerd en elke wijziging is aantoonbaar"**.

### Fail-closed: geen zegel, geen afronding

Is de signing-API of de TSA onbereikbaar, dan:

- komt het dossier op status **"Wacht op verzegeling"** (`SEALING_FAILED`);
- gaat er **géén voltooiingsmail** uit;
- komt er een taak in de wachtrij die het opnieuw probeert na 1, 5, 15 en 60
  minuten en daarna elk uur;
- staat er een melding op het dashboard met de laatste foutmelding;
- krijgt de eigenaar na drie mislukte pogingen een e-mail;
- staat elke poging in het auditspoor als `VERZEGELING_MISLUKT`.

Voor de cliënt verandert er niets: die heeft geldig ondertekend, alleen de
afronding wacht. De `worker`-container regelt het opnieuw proberen, dus die moet
draaien.

## Publieke controlepagina

Op `/valideren` (achter de login sinds v1.4) kan een medewerker een document
uploaden en zien of de handtekening geldig
is, wie het heeft gezet, wanneer, en of er na ondertekening iets is gewijzigd.
Het bestand wordt **niet opgeslagen**; het gaat in het geheugen naar de sealer en
wordt daarna weggegooid. De pagina werkt alleen als `SEAL_MODE="qualified"`.

**Waarom achter de login.** Een onbeauthenticeerde upload die door een PDF-parser
gaat, en dan in de container met de ondertekengegevens, was de zwakste plek in dit
ontwerp. Eerdere changesets vroegen daarom om een aparte validator-container; achter
de login is dat niet meer nodig, en het scheelt een zesde container op een machine van
4 GB.

Wat je daarmee verliest is minder dan het lijkt: een gekwalificeerd certificaat van
een aanbieder op de EU-vertrouwenslijst wordt door **Acrobat Reader zelf** als geldig
getoond, met de naam van de ondertekenaar. Een bank of cliënt heeft onze pagina dus
niet nodig. Deze pagina is er voor de eigen steekproef op het archief.

> Wil het kantoor de pagina later toch publiek maken, dan is de aparte container een
> voorwaarde. De rol bestaat nog in de image (`VALIDATOR_ONLY=true`, met de omgekeerde
> grendel en 403 op de ondertekenpaden); zie `hosting-handleiding.md`.

## Belangrijk bij archiveren

De verzegelde bytes moeten **letterlijk** worden gekopieerd. Een tool die de PDF
herschrijft, hercomprimeert of metadata toevoegt, maakt de handtekening ongeldig.
Dat geldt met name voor SharePoint via Microsoft Graph.

Test dit één keer expliciet: archiveer een verzegeld document, download het weer,
en controleer het op `/valideren`. Bij elke download binnen het portaal wordt de
hash automatisch opnieuw gecontroleerd; wijkt die af, dan wordt de download
geblokkeerd en komt er een `INTEGRITEIT_AFWIJKING` in het auditspoor.

## Auditspoor is append-only

Wijzigen en verwijderen van auditregels wordt door de database zelf geweigerd
(een trigger), niet alleen door afspraak. Daarnaast hangt elke regel met een hash
aan de vorige. De keten controleren:

```bash
docker compose exec web npm run audit:verify
```

Dat meldt óf de keten intact is, óf precies bij welke regel hij breekt.

## Achtergrondtaken

De `worker`-container verwerkt de wachtrij (tabel `Job`). Houd het op **één**
instance. Instellingen:

```
WORKER_POLL_MS="15000"   # hoe vaak kijken of er werk is
WORKER_BATCH="5"         # hoeveel taken per ronde
```

## Beroepscertificaat: ondertekenen op persoonlijke titel

Dit is sinds v1.4 **het** ondertekenmechanisme, niet meer een extra. De accountant
(AA/RA) ondertekent gekwalificeerd met zijn beroepscertificaat; dat vervangt de natte
handtekening en beschermt tegelijk de integriteit van het document. Staat per
medewerker aan onder **Instellingen → Gebruikers**.

Er is precies één provider:

| Provider | Wie autoriseert | Gevolg |
|---|---|---|
| `cleverbase` | de **accountant zelf**, met pincode in de app | expliciete stap in het portaal |

Er was ooit een tweede (`digidentity`) waarbij de server namens de accountant
tekende, zonder handeling van hem. Die is verwijderd, en niet alleen omdat één
mechanisme eenvoudiger is: hij tekende **best-effort**. Viel de provider weg, dan
bleef het zichtbare stempel gewoon staan, kwam er een auditregel "mislukt: …" en
liep het dossier door naar ONDERTEKEND. Het resultaat was een stuk dat ondertekend
oogt zonder gekwalificeerde handtekening, zonder dat iemand bericht kreeg —
een stille afwaardering precies op het punt waar je op vertrouwt.

De Cleverbase-route faalt juist dicht: kan er niet gewaarmerkt worden, dan gaat
het dossier naar `SEALING_FAILED` en de deur niet uit. Staat de driver nog op
`digidentity`, dan weigert de applicatie te starten met een melding die zegt wat
er moet gebeuren.

### Waarom het bij Cleverbase een aparte stap is

Zodra er een handtekening in een PDF zit, mag het bestand niet meer worden
bewerkt. Het ondertekencertificaat en het plat slaan moeten er dus vóór gebeuren,
en die zijn pas klaar als alle partijen hebben getekend. Op dat moment is de
accountant er niet noodzakelijk bij om een pincode in te voeren.

Daarom komt een dossier dan op **"Wacht op uw handtekening"**. De accountant ziet
dat als taak op `/te-ondertekenen`, selecteert wat hij wil ondertekenen en
bevestigt **één keer** met zijn pincode — ook als het om meerdere stukken gaat
(de provider staat tot 50 hashes onder één bevestiging toe). Dat is een stuk
prettiger dan vijftien keer een pincode.

Zolang dit wacht gaat er **geen voltooiingsmail** uit.

### Instellen

```
PROFESSIONAL_SIGNING_DRIVER="cleverbase"
CLEVERBASE_CSC_BASE_URL=""
CLEVERBASE_CSC_CLIENT_ID=""
CLEVERBASE_CSC_CLIENT_SECRET=""
CLEVERBASE_CSC_ENV="production"
CLEVERBASE_REDIRECT_URI="https://portaal.ottovisseraccountants.nl/api/csc/callback"
```

De **redirect-URI moet vooraf bij Cleverbase geregistreerd zijn** en stabiel
blijven; wijzigen betekent opnieuw registreren. Vraag bij de aanvraag meteen twee
URI's aan (productie én acceptatie), anders moet je later terug. Er is ook een
clientnaam nodig die de gebruiker te zien krijgt.

Zorg dat Caddy `/api/csc/callback` gewoon doorlaat — dat is een normale route van
de webapp, geen aparte service.

### Testen zonder contract

Cleverbase publiceert openbare stub-credentials (zie `.env.example`). Daarmee kun
je de hele flow uitproberen, inclusief de foutpaden. Twee punten waarover de
documentatie niet eenduidig is, zoekt dit script voor je uit:

```bash
npm run csc:check
```

> **Belangrijk:** die stub-gegevens zijn wereldwijd bekend. Het portaal
> **weigert te starten** als `NODE_ENV=production` met `CLEVERBASE_CSC_ENV=stub`
> of met het bekende stub-client-id. Dat is bewust een harde fout.

### Wat het portaal afdwingt

- **Persoonsgebonden.** Eén credential hoort bij precies één accountant; de
  database staat niet toe dat twee gebruikers hetzelfde credential krijgen.
- **Doelbinding.** Het certificaat wordt alleen gebruikt om te ondertekenen,
  nooit om in te loggen. Inloggen blijft wachtwoord + TOTP.
- **Intrekking.** Meldt de provider dat het certificaat niet meer bruikbaar is
  (bijvoorbeeld omdat de inschrijving in het NBA-register is geëindigd of
  geschorst), dan zet het portaal gekwalificeerd ondertekenen voor die gebruiker
  automatisch uit, legt dat vast in het auditspoor en mailt de beheerders. Dit
  wordt bij **elke** ondertekensessie gecontroleerd, niet alleen bij het inrichten.
- **Atomaire batch.** Mislukt er één document, dan wordt er niets ondertekend.
  Een half ondertekende verzameling is erger dan geen.
- **Eén zegel per document.** Route A en route B zijn expliciet gescheiden via
  `SEAL_MODE`; er is geen vlag die er een tweede handtekening bovenop zet.

### Wat er tijdelijk in de database staat

Een ondertekensessie loopt over een browserredirect naar de provider. Tussen het
voorbereiden en het afronden moet het portaal daarom een aantal dingen bewaren, en
dat is een bewuste afweging waard:

| Wat | Waarom | Hoe lang |
| --- | --- | --- |
| De voorbereide PDF's (opslagsleutels) | zonder die exacte bytes klopt de hash niet meer | tot afronden of verlopen (max. 15 min) |
| De hashes die naar de autorisatie zijn gestuurd (`sentHashes`) | om vóór injectie te controleren dat er ondertekend is wat de accountant heeft gezien | idem |
| De uitkomst van `signHash` (`signatureValues`) | zodat een mislukte injectie niet opnieuw een pincode kost | tot de injectie klaar is, daarna direct gewist |

`signatureValues` is de gevoeligste van de drie: dat is de handtekeningwaarde zelf.
Daarom is dat veld **versleuteld** opgeslagen (dezelfde envelope-encryptie als de
documenten) en wordt het **onmiddellijk na injectie gewist** — niet aan het einde
van de dag door een opruimtaak. Wat overblijft is een sessierij zonder inhoud.

Eerlijk over de keuze: vóór deze wijziging stond de handtekeningwaarde nergens en
kostte elke mislukte injectie een nieuwe autorisatie. Bij een batch van vijftig
stukken is dat vijftig keer opnieuw een pincode voor iets wat de provider al had
ondertekend. De waarde kort en versleuteld bewaren is het kleinere kwaad, maar het
is wél nieuw: er staat nu tijdelijk iets in de database wat er eerder niet stond.

## Mail: weten of de uitnodiging is aangekomen

Bij SMTP (Microsoft 365) weet je alleen dat je de mail aan de server hebt
aangeboden. Of hij is afgeleverd, gebounced of in de spamfolder belandde, weet je
niet. In een bewijsdossier is "verzonden" daarmee de zwakste schakel — en precies
de schakel waar een betwisting begint.

Zet daarom `MAIL_TRANSPORT` op **`postmark`** of **`resend`**. Het portaal:

- bewaart het message-id van de provider bij de ontvanger;
- verwerkt de terugkoppeling op `/api/webhooks/mail` (afgeleverd, bounce,
  spamklacht, geopend);
- legt elke gebeurtenis vast in het auditspoor met de volledige payload;
- toont op het dashboard **"uitnodigingen komen niet aan"** met de reden.

Gebruik een **apart subdomein** voor deze mail (bijvoorbeeld
`mail.ottovisseraccountants.nl`) met eigen SPF, DKIM en DMARC. Zo raakt een
mailincident de reputatie van het hoofddomein niet.

### Het webhook-eindpunt beveiligen

Zonder instellingen worden **alle** webhooks geweigerd — nooit stilzwijgend open.

- **Postmark:** zet de webhook-URL in met basicauth, bijvoorbeeld
  `https://hookuser:GEHEIM@portaal.example.nl/api/webhooks/mail`, en vul
  `MAIL_WEBHOOK_USER` en `MAIL_WEBHOOK_PASSWORD`. Optioneel `MAIL_WEBHOOK_IPS`
  als extra slot.
- **Resend:** vul `RESEND_WEBHOOK_SECRET` (`whsec_…`). De Svix-signatuur wordt
  gecontroleerd, inclusief een tijdvenster van vijf minuten zodat een onderschepte
  call niet later opnieuw bruikbaar is.

Dezelfde gebeurtenis twee keer aangeboden doet niets extra: dat wordt op
`providerEventId` afgevangen.

### Bounces

| Situatie | Wat het portaal doet |
|---|---|
| **Harde bounce** (adres bestaat niet) | status BOUNCED, mail naar de eigenaar, geen herinneringen meer |
| **Tijdelijke bounce** (mailbox vol) | één automatische herzending na een uur; bounce hij dan weer, dan als hard behandelen |
| **Spamklacht** | status COMPLAINED, mail naar de eigenaar, geen herinneringen meer |

Herinneren naar een gebouncet adres is geblokkeerd: doorgaan schaadt de
bezorgbaarheid van het hele domein. Corrigeer eerst het adres en verstuur het
verzoek opnieuw.

### Openen: bewust géén bewijs

`MAIL_GEOPEND` komt van een tracking-pixel en is in twee richtingen onbetrouwbaar:
geblokkeerde afbeeldingen geven een gemiste opening, en privacybescherming die
mail vooraf ophaalt (zoals Apple Mail Privacy Protection) geeft een opening die er
niet was. Het wordt daarom wél gelogd als procesindicatie, maar staat **niet** op
het ondertekencertificaat. Standaard staat het meten uit (`MAIL_TRACK_OPENS`).

## Nog te doen bij ingebruikname

- **Back-up.** Dagelijks `pg_dump` én het documentvolume, versleuteld, buiten de
  host. Bewaar de encryptiesleutels **niet** in dezelfde back-up.
- **Herstel testen.** Zet minstens één keer per kwartaal een volledige restore op
  in een schone omgeving en controleer dat een verzegeld document daaruit nog
  geldig valideert. Leg de uitkomst vast.
- **Bewaartermijn.** Afgeronde dossiers krijgen automatisch `retentionUntil` op
  zeven jaar na afronding. De opruimtaak zelf volgt nog.
