"""Ondertekendrivers voor de sealer.

Twee bronnen voor de private sleutel, beide met de sleutel in een cloud-HSM bij
de aanbieder. Er staat nooit een pfx/p12 op de server.

- ``csc``            : Cloud Signature Consortium API v1 (Digidentity, Cleverbase).
                       pyHanko heeft hiervoor een ingebouwde signer.
- ``globalsign_dss`` : GlobalSign Digital Signing Service. Geen kant-en-klare
                       driver in pyHanko; we sturen de hash in en krijgen een
                       signed hash terug.

De keuze is een env-variabele (``SEAL_DRIVER``), zodat wisselen geen refactor is.
"""

from __future__ import annotations

import base64
import os
from typing import Optional

import requests
from pyhanko.sign.signers.pdf_cms import Signer


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


class GlobalSignDSSSigner(Signer):
    """Signer die het hashen lokaal houdt en alleen de hash naar DSS stuurt.

    Het document verlaat de server niet: DSS ziet uitsluitend de digest.
    """

    def __init__(self, signing_cert, cert_registry, api_base: str, api_key: str,
                 api_secret: str, signer_id: str):
        super().__init__(
            signing_cert=signing_cert,
            cert_registry=cert_registry,
            signature_mechanism=None,
        )
        self._api_base = api_base.rstrip("/")
        self._api_key = api_key
        self._api_secret = api_secret
        self._signer_id = signer_id
        self._token: Optional[str] = None

    def _login(self) -> str:
        if self._token:
            return self._token
        res = requests.post(
            f"{self._api_base}/login",
            json={"api_key": self._api_key, "api_secret": self._api_secret},
            timeout=30,
        )
        res.raise_for_status()
        self._token = res.json()["access_token"]
        return self._token

    async def async_sign_raw(self, data: bytes, digest_algorithm: str,
                             dry_run: bool = False) -> bytes:
        # Bij een dry run hoeft er niets echt ondertekend te worden; pyHanko wil
        # alleen de lengte van de uiteindelijke handtekening weten.
        if dry_run:
            return b"\0" * 512
        import hashlib

        digest = hashlib.new(digest_algorithm, data).hexdigest()
        token = self._login()
        res = requests.post(
            f"{self._api_base}/identity/{self._signer_id}/sign/{digest}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        res.raise_for_status()
        return bytes.fromhex(res.json()["signature"])


def build_signer():
    """Geeft (signer, driver_naam) op basis van SEAL_DRIVER."""
    driver = _env("SEAL_DRIVER", "csc")

    if driver == "csc":
        from pyhanko.sign.signers.csc_signer import (
            CSCAuthorizationInfo,
            CSCCredentialInfo,
            CSCServiceSessionInfo,
            CSCSigner,
        )

        base_url = _env("SEAL_CSC_BASE_URL") or _env("DIGIDENTITY_BASE_URL")
        credential_id = _env("SEAL_CSC_CREDENTIAL_ID")
        oauth_token = _env("SEAL_CSC_OAUTH_TOKEN")
        if not (base_url and credential_id and oauth_token):
            raise RuntimeError(
                "CSC-driver mist configuratie: SEAL_CSC_BASE_URL, "
                "SEAL_CSC_CREDENTIAL_ID en SEAL_CSC_OAUTH_TOKEN zijn verplicht."
            )
        session_info = CSCServiceSessionInfo(
            service_url=base_url,
            credential_id=credential_id,
            oauth_token=oauth_token,
        )
        credential_info = CSCCredentialInfo.fetch(session_info)

        def _auth(*_args, **_kwargs):
            return CSCAuthorizationInfo(sad=_env("SEAL_CSC_SAD"))

        signer = CSCSigner(
            session_info=session_info,
            credential_info=credential_info,
            auth_manager=_auth,
        )
        return signer, "csc"

    if driver == "globalsign_dss":
        from asn1crypto import pem, x509
        from pyhanko.sign.general import SimpleCertificateStore

        cert_pem = _env("SEAL_DSS_CERT_PEM")
        if not cert_pem:
            raise RuntimeError("globalsign_dss-driver mist SEAL_DSS_CERT_PEM.")
        raw = base64.b64decode(cert_pem) if "BEGIN CERTIFICATE" not in cert_pem \
            else cert_pem.encode()
        if pem.detect(raw):
            _, _, der = pem.unarmor(raw)
        else:
            der = raw
        cert = x509.Certificate.load(der)
        signer = GlobalSignDSSSigner(
            signing_cert=cert,
            cert_registry=SimpleCertificateStore(),
            api_base=_env("SEAL_DSS_API_BASE", "https://emea.api.dss.globalsign.com:8443/v2"),
            api_key=_env("SEAL_DSS_API_KEY"),
            api_secret=_env("SEAL_DSS_API_SECRET"),
            signer_id=_env("SEAL_DSS_SIGNER_ID"),
        )
        return signer, "globalsign_dss"

    raise RuntimeError(f"Onbekende SEAL_DRIVER: {driver!r}")
