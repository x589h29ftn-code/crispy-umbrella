"""De validatormodus van de sealer (punt 5.2 uit v1.2, punt 10 uit v1.3).

De publieke controlepagina draait in een eigen container met VALIDATOR_ONLY=true.
Deze test controleert dat die grendel ook echt in dít proces zit en niet in de
webapp — een grendel in het verkeerde proces is geen grendel.

Draaien vanuit portal/:
    .venv-sealer/bin/python scripts/regressie/validatormodus.py
"""
import os
import subprocess
import sys

fails = []
def check(n, ok, extra=None):
    print(f"{'OK  ' if ok else 'FOUT'}  {n}")
    if not ok:
        fails.append(n)
        if extra is not None: print('       ', extra)

# 1. Met ondertekengegevens in de omgeving: importeren moet falen.
code = subprocess.run(
    [sys.executable, '-c', 'import sys; sys.path.insert(0,"sealer"); import main'],
    env={**os.environ, 'VALIDATOR_ONLY': 'true', 'SEALER_SHARED_SECRET': 'x',
         'SEAL_DSS_API_SECRET': 'geheim', 'PATH': os.environ['PATH']},
    capture_output=True, text=True
)
check('validator weigert te starten met ondertekengegevens', code.returncode != 0
      and 'VALIDATOR_ONLY=true' in code.stderr, code.stderr[-200:])

# 2. Zonder die gegevens start hij, en ondertekenen geeft 403.
script = '''
import asyncio, sys
sys.path.insert(0, "sealer")
import main
from fastapi import HTTPException

async def go():
    codes = {}
    for naam, aanroep in [
        ("seal", lambda: main.seal(pdf=b"%PDF-1.7", reason="r", location="l",
                                    field_name="OfficeSeal", appearance_text="",
                                    appearance_box="null", x_sealer_secret="x")),
        ("prepare", lambda: main.prepare(pdf=b"%PDF-1.7", cert_chain="[]", reason="r",
                                          location="l", field_name="P", x_sealer_secret="x")),
    ]:
        try:
            await aanroep()
            codes[naam] = 200
        except HTTPException as e:
            codes[naam] = e.status_code
    h = await main.health(x_sealer_secret="x")
    print("CODES", codes["seal"], codes["prepare"], h.body.decode())

asyncio.run(go())
'''
res = subprocess.run([sys.executable, '-c', script],
    env={**os.environ, 'VALIDATOR_ONLY': 'true', 'SEALER_SHARED_SECRET': 'x',
         'PATH': os.environ['PATH']}, capture_output=True, text=True)
uit = res.stdout.strip()
check('validator start zonder ondertekengegevens', res.returncode == 0, res.stderr[-300:])
check('ondertekenen geeft 403 in validatormodus', 'CODES 403 403' in uit, uit)
check('health meldt de rol validator', '"role":"validator"' in uit, uit)

print('\nALLES GOED' if not fails else f'\n{len(fails)} MISLUKT: {fails}')
sys.exit(1 if fails else 0)
