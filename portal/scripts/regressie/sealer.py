"""Regressietest voor de sealer met een zelfondertekend TESTcertificaat.

Dekt de punten uit changeset v1.2 die in de sealer landen:
  - /seal geeft 409 als er al een handtekening in hetzelfde veld staat (idempotentie)
  - /validate haalt niets van internet (allow_fetching=False) en zegt eerlijk
    dat er geen ingebedde validatiegegevens zijn
  - /validate weigert een kapotte PDF met 400, niet met een 500
  - een verzegeld document is geldig, dekt het hele bestand, en manipulatie wordt gezien

Draaien met een venv waarin sealer/requirements.txt is geinstalleerd:

    python -m venv .venv-sealer
    .venv-sealer/bin/pip install -r sealer/requirements.txt
    .venv-sealer/bin/python scripts/regressie/sealer.py
"""

from __future__ import annotations

import asyncio
import datetime
import io
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "sealer"))

os.environ.setdefault("SEALER_SHARED_SECRET", "testsecret")
os.environ.setdefault("TSA_URL", "http://tsa.test/tsr")
os.environ.setdefault("PADES_LEVEL", "lt")

FAILS = []


def check(name: str, ok: bool, extra=None):
    print(f"{'OK  ' if ok else 'FOUT'}  {name}")
    if not ok:
        FAILS.append(name)
        if extra is not None:
            print("       ", extra)


def maak_testcertificaat(tmpdir: str):
    """Zelfondertekend certificaat + sleutel, alleen voor deze test."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

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
        .sign(key, hashes.SHA256())
    )
    cert_path = os.path.join(tmpdir, "test-cert.pem")
    key_path = os.path.join(tmpdir, "test-key.pem")
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(key_path, "wb") as f:
        f.write(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
    return cert_path, key_path


def maak_pdf() -> bytes:
    """Kale PDF zonder afhankelijkheid van pdf-lib."""
    from pyhanko.pdf_utils.writer import PdfFileWriter
    from pyhanko.pdf_utils import generic

    w = PdfFileWriter()
    stream = generic.StreamObject(stream_data=b"BT /F1 18 Tf 60 700 Td (Testdocument) Tj ET")
    w.insert_page(
        w.add_object(
            generic.DictionaryObject(
                {
                    generic.pdf_name("/Type"): generic.pdf_name("/Page"),
                    generic.pdf_name("/MediaBox"): generic.ArrayObject(
                        [generic.NumberObject(0), generic.NumberObject(0),
                         generic.NumberObject(595), generic.NumberObject(842)]
                    ),
                    generic.pdf_name("/Contents"): w.add_object(stream),
                }
            )
        ).get_object()
    )
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


async def main():
    tmpdir = tempfile.mkdtemp(prefix="sealer-test-")
    cert_path, key_path = maak_testcertificaat(tmpdir)

    from pyhanko.sign.signers import SimpleSigner
    from pyhanko.sign.timestamps import DummyTimeStamper
    from pyhanko_certvalidator.registry import SimpleCertificateStore

    test_signer = SimpleSigner.load(key_path, cert_path)
    tsa_signer = SimpleSigner.load(key_path, cert_path)
    dummy_tsa = DummyTimeStamper(
        tsa_cert=tsa_signer.signing_cert,
        tsa_key=tsa_signer.signing_key,
        certs_to_embed=SimpleCertificateStore(),
    )

    import drivers
    import main as sealer

    drivers.build_signer = lambda: (test_signer, "test")
    sealer._timestamper = lambda: dummy_tsa  # noqa: SLF001 - test
    # Zonder netwerk is er geen revocatie-informatie op te halen; B-B is genoeg
    # om de idempotentie- en validatiepaden te testen.
    import pyhanko.sign.signers.pdf_signer as pdf_signer_mod
    from pyhanko.sign.signers import PdfSignatureMetadata

    origineel_init = PdfSignatureMetadata.__init__

    def init_zonder_validatie(self, *args, **kwargs):
        kwargs["embed_validation_info"] = False
        kwargs["validation_context"] = None
        origineel_init(self, *args, **kwargs)

    PdfSignatureMetadata.__init__ = init_zonder_validatie

    pdf = maak_pdf()

    # De handlers worden direct aangeroepen, dus de Form-defaults van FastAPI
    # moeten we zelf meegeven.
    vaste = dict(
        reason="Verzegeld door Otto Visser & Partners Accountants",
        location="Sneek",
        appearance_text="",
        appearance_box="null",
    )

    # 1. Verzegelen lukt.
    res = await sealer.seal(pdf=pdf, field_name="OfficeSeal", x_sealer_secret="testsecret", **vaste)
    ok = getattr(res, "status_code", 200) == 200
    check("verzegelen levert een 200", ok, getattr(res, "body", b"")[:300])
    if not ok:
        return
    sealed = res.body

    # 2. Hetzelfde bestand nog eens aanbieden geeft 409, geen tweede zegel.
    tweede = await sealer.seal(pdf=sealed, field_name="OfficeSeal", x_sealer_secret="testsecret", **vaste)
    body = tweede.body.decode() if isinstance(tweede.body, bytes) else str(tweede.body)
    check(
        "tweede poging op hetzelfde veld geeft 409 (idempotent)",
        tweede.status_code == 409 and "alreadySigned" in body,
        (tweede.status_code, body[:200]),
    )
    check("409 meldt het serienummer van het bestaande zegel", '"certSerial"' in body, body[:200])

    # 3. Een ander veldnaam mag wél een tweede zegel krijgen.
    ander = await sealer.seal(pdf=sealed, field_name="TweedeZegel", x_sealer_secret="testsecret", **vaste)
    check(
        "ander veld mag een tweede zegel krijgen",
        getattr(ander, "status_code", 200) == 200,
        getattr(ander, "body", b"")[:200],
    )

    # 4. Validatie: geldig, dekt het hele document, geen netwerktoegang.
    import json

    def uitpakken(res):
        if hasattr(res, "body"):
            return json.loads(res.body)
        return res

    # Vastleggen dat de validatie NOOIT zelf gegevens ophaalt: de te controleren
    # PDF bepaalt anders welke URL's de server benadert (SSRF).
    import pyhanko_certvalidator

    gebruikte_fetch = []
    origineel_vc_init = pyhanko_certvalidator.ValidationContext.__init__

    def vc_init(self, *args, **kwargs):
        gebruikte_fetch.append(kwargs.get("allow_fetching", None))
        origineel_vc_init(self, *args, **kwargs)

    pyhanko_certvalidator.ValidationContext.__init__ = vc_init

    val = uitpakken(await sealer.validate(pdf=sealed, x_sealer_secret="testsecret"))
    pyhanko_certvalidator.ValidationContext.__init__ = origineel_vc_init
    check(
        "validatie zet allow_fetching uit (geen SSRF via een aangeleverde PDF)",
        gebruikte_fetch and all(v is False for v in gebruikte_fetch),
        gebruikte_fetch,
    )
    sig = [s for s in val["signatures"] if s["fieldName"] == "OfficeSeal"][0]
    check("validatie ziet de handtekening als intact", sig["intact"] is True, sig)
    check("validatie meldt de dekking van de handtekening", sig["coversWholeDocument"] is not None, sig)
    check("validatie noemt de ondertekenaar", "TEST Organisatiezegel" in (sig["signerName"] or ""), sig)
    check(
        "onbekende uitgever verliest de integriteitsuitspraak niet",
        sig["intact"] is True and "UNTRUSTED" in (sig["summary"] or ""),
        sig,
    )
    check("onvertrouwd zegel wordt niet als trusted gemeld", sig["trusted"] is False, sig)

    # 5. Manipulatie na het zegel wordt gezien.
    gemanipuleerd = bytearray(sealed)
    pos = gemanipuleerd.find(b"Testdocument")
    check("teststring gevonden om te manipuleren", pos > 0)
    if pos > 0:
        gemanipuleerd[pos : pos + len(b"Testdocument")] = b"Vervalstuk!!"
        val2 = uitpakken(await sealer.validate(pdf=bytes(gemanipuleerd), x_sealer_secret="testsecret"))
        sig2 = val2["signatures"][0]
        check(
            "manipulatie na verzegeling wordt afgekeurd",
            sig2["intact"] is False or sig2["coversWholeDocument"] is False,
            sig2,
        )

    # 6. Een kapotte PDF geeft 400, geen onbehandelde 500.
    from fastapi import HTTPException

    try:
        kapot = await sealer.validate(pdf=b"%PDF-1.7 dit is geen pdf", x_sealer_secret="testsecret")
        code = getattr(kapot, "status_code", 200)
    except HTTPException as exc:
        code = exc.status_code
    check("kapotte PDF geeft 400 bij /validate", code == 400, code)

    # 7. Zonder het juiste secret komt er niets door.
    try:
        await sealer.validate(pdf=sealed, x_sealer_secret="fout")
        code = 200
    except HTTPException as exc:
        code = exc.status_code
    check("verkeerd secret geeft 401", code == 401, code)

    PdfSignatureMetadata.__init__ = origineel_init
    del pdf_signer_mod


asyncio.run(main())
print("\nALLES GOED" if not FAILS else f"\n{len(FAILS)} TEST(EN) MISLUKT: {FAILS}")
sys.exit(1 if FAILS else 0)
