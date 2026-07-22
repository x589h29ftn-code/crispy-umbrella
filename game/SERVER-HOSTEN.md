# De multiplayer-server zelf hosten (24/7)

Dit stappenplan is voor wie de Blokkenwereld multiplayer-server op de **eigen
server** wil draaien (een VPS met SSH-toegang en een domein met https).

De server is één bestand (`server/mp-server.js`), heeft **geen npm-pakketten**
nodig en luistert intern op poort `8080`. Je bestaande webserver zet daar een
beveiligd `wss://`-adres voor op een subdomein (bijv. `mp.jouwdomein.nl`).
Poort 8080 hoeft daardoor **niet** naar buiten open.

Kant-en-klare voorbeeldbestanden vind je in deze repo:

- `ecosystem.config.js` — pm2-configuratie (server 24/7 draaien)
- `server/deploy/nginx-blokkenwereld.conf` — reverse proxy voor Nginx
- `server/deploy/apache-blokkenwereld.conf` — reverse proxy voor Apache

---

## Deel 1 — Code en Node.js klaarzetten

**Stap 1.** Log in op je server via SSH.

**Stap 2.** Controleer Node.js:

```
node -v
```

Zie je een versienummer (bijv. `v20.x`)? Mooi. Zo niet, installeer Node.js
(bijvoorbeeld via `nvm` of je pakketbeheerder).

**Stap 3.** Haal de code binnen en ga naar de `game`-map:

```
git clone <jouw-repo-url> blokkenwereld
cd blokkenwereld/game
```

**Stap 4.** Test of hij start:

```
node server/mp-server.js
```

Je moet zien: `[mp] luistert op poort 8080`. Druk `Ctrl+C` om te stoppen.

---

## Deel 2 — Server 24/7 laten draaien (pm2)

**Stap 5.** Installeer pm2:

```
npm install -g pm2
```

**Stap 6.** Start via de meegeleverde configuratie (vanuit de map `game`):

```
pm2 start ecosystem.config.js
```

**Stap 7.** Laat hem na een herstart automatisch terugkomen:

```
pm2 save
pm2 startup
```

`pm2 startup` print één regel die je moet kopiëren en uitvoeren.

Handig later: `pm2 logs blokkenwereld-mp` (meekijken) en
`pm2 restart blokkenwereld-mp` (na een `git pull`).

---

## Deel 3 — Beveiligd `wss://` via je webserver

Laat eerst in je DNS een subdomein (bijv. `mp.jouwdomein.nl`) naar deze server
wijzen. Kies daarna het stukje dat bij jouw webserver past.

### Optie A — Nginx

**Stap 8a.** Kopieer het voorbeeld en vul je domein in:

```
cp server/deploy/nginx-blokkenwereld.conf /etc/nginx/sites-available/blokkenwereld
# vervang in dat bestand: mp.jouwdomein.nl → jouw subdomein
ln -s /etc/nginx/sites-available/blokkenwereld /etc/nginx/sites-enabled/
```

**Stap 9a.** Test en herlaad, en zet daarna https erop:

```
nginx -t && systemctl reload nginx
certbot --nginx -d mp.jouwdomein.nl
```

### Optie B — Apache

**Stap 8b.** Zet eenmalig de benodigde modules aan:

```
a2enmod proxy proxy_http proxy_wstunnel rewrite
```

**Stap 9b.** Kopieer het voorbeeld, vul je domein in, en zet https erop:

```
cp server/deploy/apache-blokkenwereld.conf /etc/apache2/sites-available/blokkenwereld.conf
# vervang in dat bestand: mp.jouwdomein.nl → jouw subdomein
a2ensite blokkenwereld && systemctl reload apache2
certbot --apache -d mp.jouwdomein.nl
```

---

## Deel 4 — Testen en spelen

**Stap 10.** Ga in je browser naar `https://mp.jouwdomein.nl`. Je moet zien:

> Blokkenwereld multiplayer-relay draait. Verbind via WebSocket.

**Stap 11.** In het spel → **👥 Multiplayer (max 5)**. Serveradres:

```
wss://mp.jouwdomein.nl
```

Kies een kamernaam, klik **Wereld hosten**. Je vrienden vullen hetzelfde adres
en dezelfde kamernaam in en klikken **Meedoen**.

---

## Belangrijk

- Gebruik **`wss://`** (met dubbele s), niet `ws://` — je domein draait op
  https, dus onbeveiligd wordt geblokkeerd.
- Poort **8080 blijft intern** (`127.0.0.1`); alleen 443 hoeft open, en dat is
  voor je website al zo.
- Er is **geen wachtwoord** op de server. Kies een moeilijk te raden kamernaam
  als drempel, en deel het adres niet publiek.
- **Niet clusteren.** De kamer-/edit-state zit in het geheugen van één proces;
  meerdere instances zouden spelers in gescheiden werelden zetten. De
  meegeleverde `ecosystem.config.js` staat daarom op één instance.

## Noot: gedeelde hosting (cPanel/Plesk)

Heb je géén VPS maar een gewoon webpakket? Dan kan het alleen als je paneel een
**"Setup Node.js App"** (of "Node.js Selector") heeft. Wijs daarin de map `game`
aan, zet als opstartbestand `server/mp-server.js`, en het paneel regelt poort +
https-adres. Zonder die functie kan gedeelde hosting geen langlopende
WebSocket-server draaien.
