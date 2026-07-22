// pm2-configuratie voor de Blokkenwereld multiplayer-relay.
//
// Start (vanuit de map 'game'):
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup      (zodat hij na een herstart terugkomt)
//
// Handig:
//   pm2 logs blokkenwereld-mp    (meekijken)
//   pm2 restart blokkenwereld-mp (na 'git pull')
module.exports = {
  apps: [
    {
      name: 'blokkenwereld-mp',
      script: 'server/mp-server.js',
      // Poort waarop de relay intern luistert (blijft achter de reverse proxy).
      env: { PORT: 8080 },
      autorestart: true,
      max_restarts: 20,
      // BELANGRIJK: precies één instance. De kamer-/edit-state zit in het
      // geheugen van het proces, dus clusteren (meerdere instances) zou spelers
      // in gescheiden werelden zetten.
      instances: 1,
      exec_mode: 'fork',
    },
  ],
};
