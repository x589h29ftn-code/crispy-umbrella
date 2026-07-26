"""A.3 uit changeset v1.7 — het certificerende organisatiezegel (DocMDP).

De vraag uit de changeset: landen de revocatiegegevens voor de LT-laag in
DEZELFDE revisie als de handtekening, of schrijft pyHanko de DSS-dictionary als
incrementele update erná? In het tweede geval zou de sealer zijn eigen
NO_CHANGES-permissie schenden.

Het antwoord staat onderaan dit bestand als vastlegging, met de pyHanko-versie
erbij. Kort: de DSS komt in een látere revisie (dat kan niet anders, want de DSS
verwijst naar de handtekening die er dan al moet zijn), maar zowel de PAdES-regels
als pyHanko's eigen validator rekenen dat tot de toegestane wijzigingen. Een
echte inhoudelijke wijziging wordt wél als permissieschending gemeld.

Wat deze test NIET dekt: het gedrag van Adobe Acrobat Reader. Daar is geen
headless variant van, dus stap 2 uit A.3 (blauwe certificeringsbanner, geen
melding over geschonden permissies) moet met de hand worden nagelopen zodra er
een echt organisatiecertificaat is.

    python scripts/regressie/certificering.py
"""

from __future__ import annotations

import asyncio
import datetime
import io
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "sealer"))

FAILS: list[str] = []


def check(naam: str, ok: bool, extra=None) -> None:
    print(f"{'OK  ' if ok else 'FOUT'}  {naam}")
    if not ok:
        FAILS.append(naam)
        if extra is not None:
            print("       ", extra)


def maak_testcertificaat(tmpdir: str):
    """Zelfondertekend certificaat + sleutel, alleen voor deze test."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "NL"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "TEST Otto Visser & Partners"),
            x509.NameAttribute(NameOID.COMMON_NAME, "TEST Organisatiezegel"),
        ]
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=True,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage(
                [ExtendedKeyUsageOID.TIME_STAMPING, x509.ObjectIdentifier("1.3.6.1.5.5.7.3.4")]
            ),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    cp = os.path.join(tmpdir, "cert.pem")
    kp = os.path.join(tmpdir, "key.pem")
    with open(cp, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(kp, "wb") as f:
        f.write(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )
    return cp, kp


def maak_pdf() -> bytes:
    from pyhanko.pdf_utils.generic import (
        ArrayObject,
        DictionaryObject,
        NameObject,
        NumberObject,
        pdf_name,
    )
    from pyhanko.pdf_utils.writer import PdfFileWriter

    w = PdfFileWriter()
    w.insert_page(
        DictionaryObject(
            {
                NameObject("/Type"): pdf_name("/Page"),
                NameObject("/MediaBox"): ArrayObject(
                    [NumberObject(0), NumberObject(0), NumberObject(595), NumberObject(842)]
                ),
            }
        )
    )
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


async def main() -> None:
    tmpdir = tempfile.mkdtemp(prefix="certify-test-")
    cert_path, key_path = maak_testcertificaat(tmpdir)

    from pyhanko.pdf_utils.generic import NameObject, pdf_string
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.fields import MDPPerm, SigSeedSubFilter
    from pyhanko.sign.signers import PdfSignatureMetadata, PdfSigner, SimpleSigner
    from pyhanko.sign.timestamps import DummyTimeStamper
    from pyhanko.sign.validation import async_validate_pdf_signature
    from pyhanko_certvalidator import ValidationContext

    signer = SimpleSigner.load(key_path, cert_path)
    tsa = DummyTimeStamper(
        tsa_cert=signer.signing_cert,
        tsa_key=signer.signing_key,
        certs_to_embed=signer.cert_registry,
    )
    vc = ValidationContext(
        trust_roots=[signer.signing_cert], allow_fetching=False, revocation_mode="soft-fail"
    )

    async def teken(pdf: bytes, *, certify: bool, perm, embed: bool, veld="Zegel") -> bytes:
        meta = PdfSignatureMetadata(
            field_name=veld,
            reason="regressietest",
            location="test",
            embed_validation_info=embed,
            validation_context=vc if embed else None,
            use_pades_lta=False,
            subfilter=SigSeedSubFilter.PADES,
            certify=certify,
            docmdp_permissions=perm,
        )
        out = io.BytesIO()
        await PdfSigner(meta, signer=signer, timestamper=tsa).async_sign_pdf(
            IncrementalPdfFileWriter(io.BytesIO(pdf)), output=out
        )
        return out.getvalue()

    # --- Test 1: certificeren met NO_CHANGES én ingebedde validatiegegevens ---
    ondertekend = await teken(maak_pdf(), certify=True, perm=MDPPerm.NO_CHANGES, embed=True)
    check("certificeren met NO_CHANGES en validatiegegevens levert een PDF", len(ondertekend) > 0)

    lezer = PdfFileReader(io.BytesIO(ondertekend))
    check("de validatiegegevens (DSS) zitten in het document", "/DSS" in lezer.root)

    # --- Test 2: waar landt de DSS? ---
    handtekening = lezer.embedded_signatures[0]
    revisies = lezer.xrefs.total_revisions
    check(
        "de DSS staat in een latere revisie dan de handtekening "
        "(inherent aan B-LT: de DSS verwijst naar de handtekening)",
        handtekening.signed_revision < revisies,
        f"handtekening in revisie {handtekening.signed_revision} van {revisies}",
    )

    # --- Test 3: en dat mag, volgens de PAdES-regels én pyHanko ---
    status = await async_validate_pdf_signature(handtekening, vc)
    check("de handtekening is intact", status.intact)
    check("de handtekening is geldig", status.valid)
    check(
        "de DSS-update schendt de NO_CHANGES-permissie NIET",
        status.docmdp_ok is True,
        f"docmdp_ok={status.docmdp_ok} level={status.modification_level}",
    )
    check(
        "pyHanko rekent het tot de toegestane wijzigingen",
        "ACCEPTABLE_MODIFICATIONS" in status.summary(),
        status.summary(),
    )

    # --- Test 4: een echte wijziging moet een PERMISSIESCHENDING zijn ---
    # Niet alleen "er is iets veranderd": het onderscheid is precies wat een
    # certificerende handtekening toevoegt boven een gewone.
    w = IncrementalPdfFileWriter(io.BytesIO(ondertekend))
    w.root[NameObject("/OVPStiekem")] = pdf_string("hier is aan gerommeld")
    w.update_root()
    gewijzigd = io.BytesIO()
    w.write(gewijzigd)
    lezer2 = PdfFileReader(io.BytesIO(gewijzigd.getvalue()))
    status2 = await async_validate_pdf_signature(lezer2.embedded_signatures[0], vc)
    check(
        "een inhoudelijke wijziging wordt als permissieschending gemeld",
        status2.docmdp_ok is False,
        f"docmdp_ok={status2.docmdp_ok}",
    )
    check(
        "en de samenvatting noemt het onwettige wijzigingen",
        "ILLEGAL_MODIFICATIONS" in status2.summary(),
        status2.summary(),
    )

    # --- Test 5: bytes achter het bestand plakken wordt NIET gedetecteerd ---
    # Dit hoort in de test omdat A.1 zegt dat je dit niet moet claimen. Een
    # PDF-handtekening beschermt de revisie die zij dekt; losse rommel achter de
    # laatste %%EOF is geen incrementele update en valt buiten dat bereik.
    losseBytes = ondertekend + b"\n%% hier geplakt\n"
    lezer3 = PdfFileReader(io.BytesIO(losseBytes))
    status3 = await async_validate_pdf_signature(lezer3.embedded_signatures[0], vc)
    check(
        "losse bytes achter het bestand breken de handtekening niet "
        "(vandaar: 'wijzigen wordt geblokkeerd en elke wijziging is aantoonbaar', "
        "niet 'het document kan niet worden gewijzigd')",
        status3.intact is True and status3.docmdp_ok is True,
        f"intact={status3.intact} docmdp_ok={status3.docmdp_ok}",
    )

    # --- Test 6: P=2 laat een tweede handtekening toe, P=1 niet ---
    # Dit is het verschil tussen route A en route B.
    p2 = await teken(maak_pdf(), certify=True, perm=MDPPerm.FILL_FORMS, embed=True)
    tweede = await teken(p2, certify=False, perm=None, embed=True, veld="Beroepscertificaat")
    lezer4 = PdfFileReader(io.BytesIO(tweede))
    check("onder P=2 staan er twee handtekeningen in het document", len(lezer4.embedded_signatures) == 2)
    st_cert = await async_validate_pdf_signature(lezer4.embedded_signatures[0], vc)
    check(
        "en het certificerende zegel klaagt niet over de tweede handtekening",
        st_cert.docmdp_ok is True,
        f"docmdp_ok={st_cert.docmdp_ok} level={st_cert.modification_level}",
    )

    # Onder P=1 komt het niet eens zóver: pyHanko weigert te ondertekenen. Dat is
    # sterker dan "het mag wel maar wordt gemeld" — het gereedschap doet het niet.
    from pyhanko.sign.general import SigningError

    p1 = await teken(maak_pdf(), certify=True, perm=MDPPerm.NO_CHANGES, embed=True)
    geweigerd = ""
    try:
        await teken(p1, certify=False, perm=None, embed=True, veld="Extra")
    except SigningError as exc:
        geweigerd = str(exc)
    check(
        "onder P=1 weigert pyHanko een tweede handtekening te zetten",
        "forbids all changes" in geweigerd,
        geweigerd or "geen SigningError gekregen",
    )

    # --- Test 7: de endpointgrendel op PADES_LEVEL=lta ---
    import main as sealer  # noqa: PLC0415 - pas hier nodig

    check(
        "certify_level kent precies drie waarden",
        set(sealer._MDP_PERMISSIES) == {"none", "no_changes", "fill_forms"},
        sorted(sealer._MDP_PERMISSIES),
    )
    check(
        "no_changes wijst naar de P=1-permissie",
        sealer._MDP_PERMISSIES["no_changes"] == "NO_CHANGES",
    )
    check(
        "fill_forms wijst naar de P=2-permissie",
        sealer._MDP_PERMISSIES["fill_forms"] == "FILL_FORMS",
    )


asyncio.run(main())
print("\nALLES GOED" if not FAILS else f"\n{len(FAILS)} TEST(EN) MISLUKT: {FAILS}")

# ---------------------------------------------------------------------------
# VASTLEGGING (A.3 uit changeset v1.7), pyHanko 0.25.3
#
# Vraag: schendt de DSS-dictionary van de LT-laag de eigen NO_CHANGES-permissie?
# Antwoord: nee.
#
# Feitelijk gemeten:
#   * B-LT + certify(NO_CHANGES) levert 3 revisies. De handtekening dekt revisie
#     1; de DSS komt daarna. Dat kán niet anders — de DSS bevat validatie-
#     informatie óver de handtekening, dus die moet er al zijn. Er is geen
#     variant van B-LT waarin de DSS in dezelfde revisie zit. De terugvaloptie
#     uit A.3 ("dan moet de DSS naar dezelfde revisie") bestaat dus niet, en is
#     ook niet nodig.
#   * B-B (zonder validatiegegevens) levert 2 revisies en geen DSS.
#   * pyHanko's validator meldt docmdp_ok=True, modification_level=LTA_UPDATES,
#     samenvatting ACCEPTABLE_MODIFICATIONS. De PAdES-regels zonderen
#     DSS-updates expliciet uit van de DocMDP-beperking.
#   * Een echte inhoudelijke wijziging geeft docmdp_ok=False met
#     ILLEGAL_MODIFICATIONS. Het onderscheid dat een certificerende handtekening
#     moet maken, wordt dus gemaakt.
#   * Sterker nog dan verwacht: onder P=1 wéigert pyHanko een tweede handtekening
#     te zetten ("Author signature forbids all changes"). Het is dus niet
#     "het mag, maar het wordt gemeld" — het gereedschap doet het niet. Onder P=2
#     lukt de tweede handtekening wel en klaagt het zegel niet. Dat is precies het
#     verschil tussen route A en route B.
#
# NIET getest en met de hand na te lopen zodra er een echt certificaat is:
# het gedrag van Adobe Acrobat Reader (stap 2 uit A.3). Acrobat heeft geen
# headless variant. Verwachting op grond van bovenstaande: blauwe
# certificeringsbanner zonder permissiemelding. Bevestig dat vóór go-live.
# ---------------------------------------------------------------------------

sys.exit(1 if FAILS else 0)
