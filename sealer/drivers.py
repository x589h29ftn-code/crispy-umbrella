"""Ondertekendriver voor de sealer.

Eén bron voor de private sleutel: de Cloud Signature Consortium API v1
(Digidentity, Cleverbase), met de sleutel in een cloud-HSM bij de aanbieder. Er
staat nooit een pfx/p12 op de server.

Sinds changeset v1.4 is er GEEN apart organisatiecertificaat meer. Het
beroepscertificaat van de accountant is de handtekening én de
integriteitsbescherming: één mechanisme in plaats van twee, en een paar honderd euro
per jaar minder. De GlobalSign-DSS-driver die daarvoor bestond is verwijderd — hij
stond er alleen voor het organisatiezegel.

De keuze blijft een env-variabele (``SEAL_DRIVER``) zodat een tweede aanbieder later
zonder refactor te koppelen is.
"""

from __future__ import annotations

import os


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


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

        base_url = _env("SEAL_CSC_BASE_URL")
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

    raise RuntimeError(f"Onbekende SEAL_DRIVER: {driver!r}")
