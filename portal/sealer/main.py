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
        from pyhanko.sign import signers
        from pyhanko.sign.fields import SigFieldSpec
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
        subfilter=signers.SigSeedSubFilter.PADES,
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
        from pyhanko.sign.validation import validate_pdf_signature

        reader = PdfFileReader(io.BytesIO(sealed))
        emb = reader.embedded_signatures[-1]
        status = await validate_pdf_signature(emb, skip_diff=True)
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
        from pyhanko.sign.validation import validate_pdf_signature
        from pyhanko_certvalidator import ValidationContext
    except Exception as exc:  # noqa: BLE001 - afhankelijkheid niet beschikbaar
        log.exception("validatie niet gereed")
        return JSONResponse({"error": f"validatie niet gereed: {exc}"}, status_code=502)

    try:
        reader = PdfFileReader(io.BytesIO(pdf))
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": f"PDF ongeldig: {exc}"}, status_code=400)

    sigs = list(reader.embedded_signatures)
    if not sigs:
        return {"signed": False, "signatures": []}

    vc = ValidationContext(allow_fetching=True)
    results = []
    for emb in sigs:
        try:
            status = await validate_pdf_signature(emb, signer_validation_context=vc)
            ts = getattr(status, "timestamp_validity", None)
            results.append(
                {
                    "fieldName": emb.field_name,
                    "intact": bool(status.intact),
                    "valid": bool(status.valid),
                    "trusted": bool(getattr(status, "trusted", False)),
                    "modified": not bool(status.coverage_ok()) if hasattr(status, "coverage_ok") else None,
                    "coversWholeDocument": bool(
                        getattr(status, "coverage", None)
                        and status.coverage.name == "ENTIRE_FILE"
                    ),
                    "signerName": (
                        emb.signer_cert.subject.human_friendly if emb.signer_cert else None
                    ),
                    "certSerial": str(emb.signer_cert.serial_number) if emb.signer_cert else None,
                    "timestamp": (
                        ts.timestamp.isoformat() if ts is not None and getattr(ts, "timestamp", None) else None
                    ),
                    "summary": status.summary() if hasattr(status, "summary") else None,
                }
            )
        except Exception as exc:  # noqa: BLE001
            results.append({"fieldName": emb.field_name, "error": str(exc)})

    return {"signed": True, "signatures": results}
