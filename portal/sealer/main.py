"""Sealer-sidecar: cryptografische verzegeling van PDF's met pyHanko (PAdES-B-LT).

Bewust een aparte service:
- pyHanko heeft de LT-laag (revocatie-informatie in de DSS-dictionary,
  document-timestamp, correcte incrementele updates) ingebouwd. In pdf-lib is dat
  veel handwerk en foutgevoelig.
- De sleutel staat in een cloud-HSM bij de aanbieder; hier staat nooit een pfx.

Beveiliging:
- Niet publiek bereikbaar: geen ports in compose, geen Caddy-route.
- Elke aanroep moet het shared secret in de header X-Sealer-Secret meesturen.
- Body-limiet op de PDF.
- Alleen uitgaand naar de signing-API en de TSA.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import logging
import os
from typing import Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, Response
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("sealer")

app = FastAPI(title="OV&P sealer", docs_url=None, redoc_url=None, openapi_url=None)

MAX_PDF_BYTES = int(os.environ.get("SEALER_MAX_PDF_BYTES", 60 * 1024 * 1024))
# Gereserveerde ruimte voor de handtekening (RSA-2048 = 256 bytes; ruim genomen
# zodat er ook een tijdstempel en revocatie-informatie bij kunnen).
SIGNATURE_RESERVE_BYTES = int(os.environ.get("SEALER_SIGNATURE_RESERVE", 16384))
SHARED_SECRET = os.environ.get("SEALER_SHARED_SECRET", "")


def _check_secret(provided: Optional[str]) -> None:
    if not SHARED_SECRET:
        raise HTTPException(500, "SEALER_SHARED_SECRET is niet ingesteld.")
    if not provided or not hmac.compare_digest(provided, SHARED_SECRET):
        raise HTTPException(401, "Ongeldig of ontbrekend sealer-secret.")


def _timestamper():
    """TSA volgens configuratie. Zonder TSA_URL geen tijdstempel (en dus geen B-LT)."""
    url = os.environ.get("TSA_URL", "").strip()
    if not url:
        return None
    from pyhanko.sign.timestamps import HTTPTimeStamper

    mode = os.environ.get("TSA_AUTH_MODE", "none").strip()
    auth = None
    headers = None
    if mode == "basic":
        auth = (os.environ.get("TSA_USERNAME", ""), os.environ.get("TSA_PASSWORD", ""))
    elif mode == "bearer":
        headers = {"Authorization": f"Bearer {os.environ.get('TSA_PASSWORD', '')}"}
    timeout = int(os.environ.get("TSA_TIMEOUT_MS", "10000")) // 1000
    return HTTPTimeStamper(url=url, auth=auth, headers=headers, timeout=max(timeout, 1))


def _existing_signature(pdf: bytes, field_name: str) -> Optional[dict]:
    """Staat er al een handtekening in dit veld? Geeft dan de kerngegevens terug.

    Wordt gebruikt voor idempotentie: zo kan hetzelfde bestand twee keer worden
    aangeboden zonder dat er een tweede zegel in belandt.
    """
    try:
        from pyhanko.pdf_utils.reader import PdfFileReader

        reader = PdfFileReader(io.BytesIO(pdf))
        for emb in reader.embedded_signatures:
            if emb.field_name != field_name:
                continue
            serial = str(emb.signer_cert.serial_number) if emb.signer_cert else None
            signed_at = None
            dt = getattr(emb, "self_reported_timestamp", None)
            if dt is not None:
                signed_at = dt.isoformat()
            return {"certSerial": serial, "signingTime": signed_at}
    except Exception:  # noqa: BLE001 - geen leesbare PDF of geen handtekeningen
        return None
    return None


@app.get("/health")
async def health(x_sealer_secret: Optional[str] = Header(None)):
    """Controleert of de driver te bouwen is en of de TSA bereikbaar is."""
    _check_secret(x_sealer_secret)
    status = {"ok": True, "driver": os.environ.get("SEAL_DRIVER", "csc")}
    try:
        from drivers import build_signer

        _signer, name = build_signer()
        status["signer"] = name
    except Exception as exc:  # noqa: BLE001 - status rapporteren, niet crashen
        status["ok"] = False
        status["signer_error"] = str(exc)
    ts = None
    try:
        ts = _timestamper()
        if ts is None:
            status["tsa"] = "niet ingesteld"
            status["ok"] = False
        else:
            await ts.async_dummy_response("sha256")
            status["tsa"] = "bereikbaar"
    except Exception as exc:  # noqa: BLE001
        status["ok"] = False
        status["tsa_error"] = str(exc)
    return JSONResponse(status, status_code=200 if status["ok"] else 503)


@app.post("/seal")
async def seal(
    pdf: bytes = File(...),
    reason: str = Form("Verzegeld door Otto Visser & Partners Accountants"),
    location: str = Form("Sneek"),
    field_name: str = Form("OfficeSeal"),
    appearance_text: str = Form(""),
    appearance_box: str = Form("null"),
    x_sealer_secret: Optional[str] = Header(None),
):
    """Zet één PAdES-handtekening (approval, geen DocMDP) op een afgeronde PDF."""
    _check_secret(x_sealer_secret)
    if len(pdf) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF te groot.")

    # Imports, driver en TSA zijn omgevingszaken: gaat hier iets mis, dan is dat
    # een 502 (de aanroeper probeert het later opnieuw), nooit een onbehandelde
    # 500 — die zou als definitieve fout gelden en nooit opnieuw geprobeerd worden.
    try:
        from pyhanko.sign.fields import SigFieldSpec, SigSeedSubFilter
        from pyhanko.sign.signers import PdfSignatureMetadata, PdfSigner
        from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
        from pyhanko_certvalidator import ValidationContext

        from drivers import build_signer

        signer, driver_name = build_signer()

        timestamper = _timestamper()
        if timestamper is None:
            return JSONResponse({"error": "TSA_URL niet ingesteld"}, status_code=502)
    except Exception as exc:  # noqa: BLE001 - configuratie/HSM/afhankelijkheid
        log.exception("sealer niet gereed")
        return JSONResponse({"error": f"sealer niet gereed: {exc}"}, status_code=502)

    level = os.environ.get("PADES_LEVEL", "lt").strip().lower()

    # Idempotentie op de PDF zelf, niet op de database. Reden: tussen het
    # wegschrijven van de bytes en het committen van de databaserij kan het
    # proces omvallen. De rij weet dan niet dat er al verzegeld is, een retry
    # verzegelt opnieuw, en er staan twee zegels in één document. Niet ongeldig,
    # maar onuitlegbaar op een auditcertificaat.
    #
    # Daarom: staat er al een handtekening in dit veld, dan geeft de sealer 409
    # met de bestaande gegevens en tekent hij niet. De aanroeper behandelt 409 als
    # succes en werkt alleen de database bij.
    existing = _existing_signature(pdf, field_name)
    if existing is not None:
        return JSONResponse(
            {"alreadySigned": True, "fieldName": field_name, **existing},
            status_code=409,
        )

    try:
        writer = IncrementalPdfFileWriter(io.BytesIO(pdf))
    except Exception as exc:  # noqa: BLE001 - kapotte of versleutelde PDF
        return JSONResponse({"error": f"PDF ongeldig: {exc}"}, status_code=400)

    # Zichtbaar handtekeningveld (optioneel). Wordt op de auditcertificaatpagina
    # geplaatst, nooit over de inhoud van het document heen.
    box = None
    try:
        parsed_box = json.loads(appearance_box) if appearance_box else None
        if parsed_box:
            box = (
                int(parsed_box["page"]),
                (
                    float(parsed_box["x"]),
                    float(parsed_box["y"]),
                    float(parsed_box["x"]) + float(parsed_box["width"]),
                    float(parsed_box["y"]) + float(parsed_box["height"]),
                ),
            )
    except (ValueError, KeyError, TypeError) as exc:
        return JSONResponse({"error": f"appearance_box ongeldig: {exc}"}, status_code=400)

    meta = PdfSignatureMetadata(
        field_name=field_name,
        reason=reason,
        location=location,
        # embed_validation_info + een fetchende ValidationContext maken van B-B
        # een B-LT: OCSP/CRL-gegevens komen in het document zelf.
        embed_validation_info=True,
        validation_context=ValidationContext(allow_fetching=True),
        use_pades_lta=(level == "lta"),
        subfilter=SigSeedSubFilter.PADES,
        # Bewust GEEN certify/DocMDP: een approval signature is robuuster en
        # laat een tweede handtekening (incremental update) intact.
    )

    if box is not None:
        page, coords = box
        new_field = SigFieldSpec(sig_field_name=field_name, on_page=page, box=coords)
        pdf_signer = PdfSigner(
            meta, signer=signer, timestamper=timestamper, new_field_spec=new_field
        )
    else:
        pdf_signer = PdfSigner(meta, signer=signer, timestamper=timestamper)

    out = io.BytesIO()
    try:
        await pdf_signer.async_sign_pdf(writer, output=out, appearance_text_params=(
            {"url": appearance_text} if appearance_text else None
        ))
    except Exception as exc:  # noqa: BLE001
        log.exception("verzegelen mislukt")
        # Netwerk/HSM/TSA-problemen zijn te herhalen; de rest niet.
        msg = str(exc)
        retryable = any(
            hint in msg.lower()
            for hint in ("timeout", "connection", "temporarily", "503", "502", "tsa", "network")
        )
        return JSONResponse({"error": msg}, status_code=502 if retryable else 400)

    sealed = out.getvalue()

    # Signing-tijd uit de handtekening lezen (de TSA-tijd is de bewijstijd).
    signing_time = None
    cert_serial = None
    try:
        from pyhanko.pdf_utils.reader import PdfFileReader
        from pyhanko.sign.validation import async_validate_pdf_signature

        reader = PdfFileReader(io.BytesIO(sealed))
        emb = reader.embedded_signatures[-1]
        status = await async_validate_pdf_signature(emb, skip_diff=True)
        ts = getattr(status, "timestamp_validity", None)
        if ts is not None and getattr(ts, "timestamp", None):
            signing_time = ts.timestamp.isoformat()
        elif getattr(status, "signer_reported_dt", None):
            signing_time = status.signer_reported_dt.isoformat()
        if emb.signer_cert is not None:
            cert_serial = str(emb.signer_cert.serial_number)
    except Exception:  # noqa: BLE001 - metadata is nice-to-have, niet blokkerend
        log.warning("kon zegel-metadata niet uitlezen", exc_info=True)

    headers = {
        "X-Seal-Driver": driver_name,
        "X-Seal-Level": level,
        "X-Seal-Tsa-Url": os.environ.get("TSA_URL", ""),
    }
    if signing_time:
        headers["X-Seal-Signing-Time"] = signing_time
    if cert_serial:
        headers["X-Seal-Cert-Serial"] = cert_serial
    return Response(content=sealed, media_type="application/pdf", headers=headers)


@app.post("/prepare")
async def prepare(
    pdf: bytes = File(...),
    cert_chain: str = Form(...),  # JSON-array van base64-DER, eerste = ondertekenaar
    reason: str = Form("Ondertekend door de accountant"),
    location: str = Form("Sneek"),
    field_name: str = Form("ProfessionalSignature"),
    x_sealer_secret: Optional[str] = Header(None),
):
    """Fase 1 van het ondertekenen met gebruikersautorisatie.

    Zet een handtekening-placeholder met correcte /ByteRange in de PDF en geeft de
    te ondertekenen SHA-256 terug. De accountant autoriseert daarna in zijn app;
    de handtekening komt via /inject weer terug.

    Nodig omdat de hashes van ALLE documenten bekend moeten zijn vóór de
    autorisatie: de SAD leeft maar 300 seconden en dekt de hele batch.
    """
    _check_secret(x_sealer_secret)
    if len(pdf) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF te groot.")

    try:
        from asn1crypto import x509
        from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
        from pyhanko.sign.fields import SigSeedSubFilter
        from pyhanko.sign.signers import PdfSignatureMetadata, PdfSigner
        from pyhanko.sign.signers.pdf_cms import ExternalSigner
        from pyhanko_certvalidator.registry import SimpleCertificateStore
    except Exception as exc:  # noqa: BLE001
        log.exception("prepare niet gereed")
        return JSONResponse({"error": f"prepare niet gereed: {exc}"}, status_code=502)

    try:
        chain = [x509.Certificate.load(base64.b64decode(c)) for c in json.loads(cert_chain)]
        if not chain:
            return JSONResponse({"error": "cert_chain is leeg"}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": f"cert_chain ongeldig: {exc}"}, status_code=400)

    registry = SimpleCertificateStore()
    registry.register_multiple(chain[1:])

    # ExternalSigner: pyHanko bouwt de CMS-structuur, het feitelijke ondertekenen
    # gebeurt elders (bij de provider, na de pincode van de accountant). De
    # signature_value hier is alleen om de juiste ruimte te reserveren.
    ext = ExternalSigner(
        signing_cert=chain[0],
        cert_registry=registry,
        signature_value=bytes(SIGNATURE_RESERVE_BYTES),
    )
    meta = PdfSignatureMetadata(
        field_name=field_name,
        reason=reason,
        location=location,
        subfilter=SigSeedSubFilter.PADES,
    )
    pdf_signer = PdfSigner(meta, signer=ext)

    try:
        writer = IncrementalPdfFileWriter(io.BytesIO(pdf))
        # Let op: het derde element is het output-handle met de voorbereide PDF.
        prep_digest, _tbs_doc, output = await pdf_signer.async_digest_doc_for_signing(writer)

        # De provider ondertekent de signedAttrs, NIET de document-digest zelf.
        # Daarom leveren we die attributen mee terug: bij /inject moeten exact
        # dezelfde bytes worden gebruikt, anders klopt de handtekening niet.
        signed_attrs = await ext.signed_attrs(
            prep_digest.document_digest, "sha256", use_pades=True
        )
        to_sign = signed_attrs.dump()
    except Exception as exc:  # noqa: BLE001
        log.exception("placeholder plaatsen mislukt")
        return JSONResponse({"error": f"placeholder mislukt: {exc}"}, status_code=400)

    prepared = output.getvalue()
    return JSONResponse(
        {
            # Dit is de hash die naar de provider gaat.
            "hashToSign": base64.b64encode(hashlib.sha256(to_sign).digest()).decode(),
            "documentDigest": base64.b64encode(prep_digest.document_digest).decode(),
            "signedAttrs": base64.b64encode(to_sign).decode(),
            # Deze twee wijzen naar het gereserveerde gebied in de PDF waar de
            # handtekening straks komt. Zonder deze waarden kan /inject niet weten
            # waar hij moet schrijven, dus ze moeten de redirect overleven.
            "reservedRegionStart": prep_digest.reserved_region_start,
            "reservedRegionEnd": prep_digest.reserved_region_end,
            "preparedPdf": base64.b64encode(prepared).decode(),
        }
    )


@app.post("/inject")
async def inject(
    prepared_pdf: bytes = File(...),
    signed_attrs: str = Form(...),  # base64, exact zoals /prepare teruggaf
    document_digest: str = Form(...),  # base64
    reserved_region_start: int = Form(...),
    reserved_region_end: int = Form(...),
    signature_value: str = Form(...),  # base64, van de provider
    cert_chain: str = Form(...),  # JSON-array van base64-DER
    x_sealer_secret: Optional[str] = Header(None),
):
    """Fase 2: bouwt de CMS met de handtekening van de provider en zet die in de
    voorbereide PDF. Daarna is het document ondertekend en onaantastbaar."""
    _check_secret(x_sealer_secret)
    if len(prepared_pdf) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF te groot.")

    try:
        from asn1crypto import cms as acms
        from asn1crypto import x509
        from pyhanko.sign.signers.pdf_cms import ExternalSigner
        from pyhanko.sign.signers.pdf_byterange import PreparedByteRangeDigest
        from pyhanko.sign.signers.pdf_signer import PdfTBSDocument
        from pyhanko_certvalidator.registry import SimpleCertificateStore
    except Exception as exc:  # noqa: BLE001
        log.exception("inject niet gereed")
        return JSONResponse({"error": f"inject niet gereed: {exc}"}, status_code=502)

    try:
        chain = [x509.Certificate.load(base64.b64decode(c)) for c in json.loads(cert_chain)]
        attrs = acms.CMSAttributes.load(base64.b64decode(signed_attrs))
        sig = base64.b64decode(signature_value)
        doc_digest = base64.b64decode(document_digest)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": f"ongeldige invoer: {exc}"}, status_code=400)

    registry = SimpleCertificateStore()
    registry.register_multiple(chain[1:])
    ext = ExternalSigner(signing_cert=chain[0], cert_registry=registry, signature_value=sig)

    try:
        cms_obj = await ext.async_sign_prescribed_attributes("sha256", attrs)
        out = io.BytesIO(prepared_pdf)
        await PdfTBSDocument.async_finish_signing(
            out,
            prepared_digest=PreparedByteRangeDigest(
                document_digest=doc_digest,
                reserved_region_start=reserved_region_start,
                reserved_region_end=reserved_region_end,
            ),
            signature_cms=cms_obj,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("injecteren mislukt")
        return JSONResponse({"error": f"injecteren mislukt: {exc}"}, status_code=400)

    return Response(content=out.getvalue(), media_type="application/pdf")


@app.post("/validate")
async def validate(
    pdf: bytes = File(...),
    x_sealer_secret: Optional[str] = Header(None),
):
    """Valideert de handtekening(en) in een PDF. Slaat niets op."""
    _check_secret(x_sealer_secret)
    if len(pdf) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF te groot.")

    try:
        from pyhanko.pdf_utils.reader import PdfFileReader
        from pyhanko.sign.validation import async_validate_pdf_signature
        from pyhanko_certvalidator import ValidationContext
    except Exception as exc:  # noqa: BLE001 - afhankelijkheid niet beschikbaar
        log.exception("validatie niet gereed")
        return JSONResponse({"error": f"validatie niet gereed: {exc}"}, status_code=502)

    # Zowel het openen als het uitlezen van de handtekeningen kan op een
    # beschadigde PDF stuklopen. Dit endpoint is via de publieke controlepagina
    # bereikbaar, dus dat moet een nette 400 geven en geen 500.
    try:
        reader = PdfFileReader(io.BytesIO(pdf))
        sigs = list(reader.embedded_signatures)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            {"error": f"Dit bestand is geen leesbare PDF of is beschadigd: {exc}"},
            status_code=400,
        )

    if not sigs:
        return {"signed": False, "signatures": []}

    # GEEN allow_fetching hier. Dit endpoint is publiek bereikbaar, en bij het
    # ophalen van revocatiegegevens bepaalt de GEÜPLOADE PDF welke URL's worden
    # benaderd. Een kwaadaardig bestand kan zo naar interne adressen wijzen
    # (db, sealer, metadata-endpoint van de host): server-side request forgery
    # zonder dat de aanvaller hoeft in te loggen.
    #
    # Voor een B-LT-document is dat geen verlies: de revocatiegegevens zitten al
    # in het document, dat is precies het doel van de LT-laag. Ontbreken ze, dan
    # melden we dat als uitkomst in plaats van te gaan ophalen.
    vc = ValidationContext(allow_fetching=False)
    results = []
    for emb in sigs:
        # Twee gescheiden vragen, en bewust in deze volgorde:
        #
        # 1. Is het bestand ongewijzigd sinds het zegel? Dat is puur rekenwerk aan
        #    het document zelf: geen vertrouwensketen, geen netwerk, kan niet
        #    stranden op een onbekende uitgever.
        # 2. Is de uitgever te vertrouwen? Dat vraagt wél een keten en revocatie-
        #    informatie, en kan dus mislukken.
        #
        # Bij één gecombineerde aanroep sleept vraag 2 vraag 1 mee in de val: een
        # zegel van een CA die hier niet in de trust store zit, zou dan alleen een
        # foutmelding opleveren en de lezer zou niets over de integriteit horen.
        entry: dict = {
            "fieldName": emb.field_name,
            "intact": None,
            "valid": None,
            "trusted": False,
            "coversWholeDocument": None,
            "modified": None,
            "signerName": emb.signer_cert.subject.human_friendly if emb.signer_cert else None,
            "certSerial": str(emb.signer_cert.serial_number) if emb.signer_cert else None,
            "timestamp": None,
            "summary": None,
        }
        try:
            from pyhanko.sign.validation.generic_cms import validate_sig_integrity

            emb.compute_integrity_info()
            coverage = getattr(emb, "coverage", None)
            entry["coversWholeDocument"] = bool(coverage is not None and coverage.name == "ENTIRE_FILE")
            intact, _valid = validate_sig_integrity(
                emb.signer_info,
                emb.signer_cert,
                expected_content_type="data",
                actual_digest=emb.compute_digest(),
            )
            entry["intact"] = bool(intact)
            entry["modified"] = not entry["coversWholeDocument"]
            zelf_gemeld = emb.self_reported_timestamp
            if zelf_gemeld is not None:
                entry["timestamp"] = zelf_gemeld.isoformat()
        except Exception as exc:  # noqa: BLE001 - kapotte handtekeningstructuur
            entry["error"] = f"handtekening niet te lezen: {exc}"
            results.append(entry)
            continue

        try:
            status = await async_validate_pdf_signature(emb, signer_validation_context=vc)
            ts = getattr(status, "timestamp_validity", None)
            entry["intact"] = bool(status.intact)
            entry["valid"] = bool(status.valid)
            entry["trusted"] = bool(getattr(status, "trusted", False))
            if hasattr(status, "coverage_ok"):
                entry["modified"] = not bool(status.coverage_ok())
            if getattr(status, "coverage", None) is not None:
                entry["coversWholeDocument"] = status.coverage.name == "ENTIRE_FILE"
            if ts is not None and getattr(ts, "timestamp", None):
                entry["timestamp"] = ts.timestamp.isoformat()
            if hasattr(status, "summary"):
                entry["summary"] = status.summary()
        except Exception as exc:  # noqa: BLE001
            # De vertrouwensvraag is niet te beantwoorden. De integriteit hierboven
            # staat al vast, dus dit is een aanvulling en geen totaalverlies.
            msg = str(exc)
            laag = msg.lower()
            if any(k in laag for k in ("revocation", "ocsp", "crl", "fetch")):
                # Bewust niet gaan ophalen: zie de toelichting hierboven.
                entry["trustError"] = (
                    "Dit document bevat geen ingebedde validatiegegevens (OCSP/CRL). "
                    "De echtheid van de uitgever is daarom niet volledig automatisch vast te stellen."
                )
            elif any(k in laag for k in ("self-signed", "self signed", "validation path", "issuer")):
                entry["trustError"] = (
                    "De uitgever van dit zegel staat niet in de lijst met vertrouwde "
                    "certificaatautoriteiten van deze controle."
                )
            else:
                entry["trustError"] = msg
        results.append(entry)

    return {"signed": True, "signatures": results}
