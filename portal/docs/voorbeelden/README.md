# Voorbeeldbestanden

Twee bestanden die vaak door elkaar worden gehaald. Ze horen bij elkaar, maar
doen iets anders.

## `Voorbeeld-ondertekend-document.pdf`

Het stuk zelf, met de handtekeningen erin gestempeld en daarachter het
**ondertekencertificaat**. Dit is wat de cliënt in zijn mailbox krijgt.

Het certificaat reist mee met het bestand. Iemand die over vijf jaar alleen dit
ene PDF-bestand in handen heeft — zonder toegang tot het portaal — kan er nog
steeds op zien wie er tekende, wanneer, vanaf welk IP-adres en apparaat, welke
verklaring die persoon heeft gelezen, en met welke vingerafdruk de inhoud
vastligt.

## `Voorbeeld-auditrapport.pdf`

Het volledige verloop, als apart bestand. Hier staat álles in: elke vastgelegde
gebeurtenis op volgnummer, inclusief de mislukte pogingen, met per regel de hash
van zichzelf en van zijn voorganger. Plus een paragraaf die eerlijk benoemt wat
het rapport níet aantoont.

Dit rapport wordt na de laatste ondertekening opgemaakt en gaat als bijlage mee
in de voltooiingsmail. Het is vooral het bewijsstuk bij het niveau
**Auditspoor**, waarbij er geen digitaal zegel in het document zit.

## Waar deze voorbeelden vandaan komen

Ze zijn niet nagetekend, maar echt door de applicatie gemaakt:

```
npm run voorbeeld:audit
```

Dat script zet een verzonnen dossier in de database (Jansen Holding B.V., twee
ondertekenaars: de cliënt met een sms-code en de accountant met herverificatie),
stempelt de handtekeningen er echt in, laat `sealDocument` en
`buildAuditReportFor` hun werk doen, en ruimt het dossier daarna weer op.

Zo blijven de voorbeelden gelijk aan wat de code werkelijk maakt. Een
nagetekende voorbeeldpagina gaat na de eerste wijziging afwijken zonder dat
iemand het merkt.

**Alle gegevens in deze bestanden zijn verzonnen.** De namen, adressen,
telefoonnummers en IP-adressen bestaan niet. De hashes zijn wél echt: ze zijn
berekend over deze voorbeeldbestanden.

Regenereer ze opnieuw na elke wijziging in `src/lib/pdf/seal.ts` of
`src/lib/pdf/auditReport.ts`, zodat ze blijven kloppen.
