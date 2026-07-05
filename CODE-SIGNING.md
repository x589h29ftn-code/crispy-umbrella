# De Windows-waarschuwing wegnemen (code signing)

Windows toont bij een gedownloade, **niet-ondertekende** app de melding
_"Windows heeft uw pc beschermd"_ (SmartScreen) en soms een
Defender-waarschuwing. Dat is **geen fout in PDF Studio** — Windows waarschuwt
standaard bij elke onbekende uitgever. De enige echte oplossing is de installer
**digitaal ondertekenen** met een vertrouwd certificaat.

De build is hier al helemaal op voorbereid: zodra je een certificaat als
GitHub-secret toevoegt, worden de installer én de `.exe` automatisch
ondertekend. Zolang er geen certificaat is, wordt de app gewoon ongetekend
gebouwd (zoals nu).

---

## Overzicht van de opties

| Route | Kosten (indicatie) | SmartScreen weg? | In de CI? |
|-------|--------------------|------------------|-----------|
| **Azure Trusted Signing** | ± $10/maand | **Direct** | Ja (aanbevolen) |
| **EV-certificaat** | ± €350–600/jaar | **Direct** | Ja, via cloud-HSM |
| **OV-certificaat (.pfx)** | ± €150–250/jaar | Na verloop van tijd/downloads | Ja |
| Niets doen | — | Nee | — |

> "Direct" = geen waarschuwing meer vanaf de eerste download. Bij een
> gewoon (OV) certificaat verdwijnt de tekst "onbekende uitgever", maar
> bouwt SmartScreen zijn reputatie pas op naarmate meer mensen de app
> downloaden — de eerste periode kan er dus nog een waarschuwing zijn.

Voor een accountantskantoor (gevestigde organisatie) is **Azure Trusted
Signing** meestal de goedkoopste én snelste route.

---

## Route A — Gewoon of EV-certificaat als `.pfx` (eenvoudigst)

1. Koop een **code signing certificaat** bij bijvoorbeeld Sectigo, DigiCert of
   een Nederlandse reseller. Je krijgt (of maakt) een `.pfx`/`.p12`-bestand met
   een wachtwoord. De naam op het certificaat (bv. _Otto Visser Accountants
   B.V._) wordt de getoonde uitgever.
2. Zet het `.pfx`-bestand om naar base64:
   - Windows PowerShell:
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificaat.pfx")) > cert.txt`
   - macOS/Linux: `base64 -w0 certificaat.pfx > cert.txt`
3. Voeg in GitHub twee **repository secrets** toe
   (_Settings → Secrets and variables → Actions → New repository secret_):
   - `WINDOWS_CSC_LINK` = de volledige inhoud van `cert.txt` (de base64-tekst)
   - `WINDOWS_CSC_KEY_PASSWORD` = het wachtwoord van het `.pfx`
4. Start de workflow **Build Windows installer** opnieuw. De installer is nu
   ondertekend — verder hoef je niets te wijzigen.

> Let op: een **EV-**certificaat kan tegenwoordig niet meer als los `.pfx`
> gebruikt worden (het zit op een hardware-token of cloud-HSM). Gebruik voor EV
> dan route B of de HSM-instructies van je leverancier.

---

## Route B — Azure Trusted Signing (aanbevolen, goedkoopst voor direct effect)

Microsofts eigen ondertekendienst. ± $10/maand, werkt in de CI en geeft
**direct** SmartScreen-reputatie.

1. Maak een **Azure-account** en een _Trusted Signing account_ + _Certificate
   Profile_ in de Azure-portal. Doorloop de eenmalige
   **identiteitsverificatie** van je organisatie (Otto Visser Accountants).
2. Maak een _service principal_ (App-registratie) met de rol **Trusted Signing
   Certificate Profile Signer**.
3. Voeg deze GitHub-secrets toe:
   - `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
   - `AZURE_TS_ENDPOINT` (bv. `https://weu.codesigning.azure.net`)
   - `AZURE_TS_ACCOUNT` en `AZURE_TS_PROFILE`
4. Zet in `electron-builder.yml` onder `win:` het volgende blok (electron-builder
   ondertekent dan via Azure in plaats van met een `.pfx`):

   ```yaml
   win:
     azureSignOptions:
       publisherName: "Otto Visser Accountants B.V."
       endpoint: "${env.AZURE_TS_ENDPOINT}"
       codeSigningAccountName: "${env.AZURE_TS_ACCOUNT}"
       certificateProfileName: "${env.AZURE_TS_PROFILE}"
   ```

   en geef in de workflow de Azure-secrets als `env` mee aan de build-stap.

Vraag me gerust om deze stap kant-en-klaar in te richten zodra je het
Azure-account hebt — dan zet ik het `azureSignOptions`-blok en de workflow-env
er direct in.

---

## Tussenoplossing zonder certificaat (voor jezelf / collega's)

Zolang er nog geen certificaat is, kun je de waarschuwing per keer omzeilen:

- Bij _"Windows heeft uw pc beschermd"_: klik op **Meer informatie → Toch
  uitvoeren**.
- Of: rechtsklik op het gedownloade bestand → **Eigenschappen** → onderaan
  **"Blokkering opheffen"** aanvinken → **OK**, daarna openen.

Dit is veilig voor je eigen build, maar het is geen nette oplossing om naar
klanten te sturen — daarvoor is een certificaat (route A of B) de juiste weg.
