// Multiplayer-client: verbindt met de relay-server, synct spelerposities en
// blok-wijzigingen. De wereld zelf is deterministisch (zelfde seed), dus we
// sturen alleen poses en edits. Andere spelers verschijnen als avatars.
window.Net = (function () {
  const N = {};
  let scene = null, ws = null, myId = 0, isHost = false, room = '', name = 'Speler';
  let poseTimer = 0, timeTimer = 0;
  let suppressBroadcast = false;
  const avatars = new Map();   // id -> { group, body, head, tx,ty,tz,tyaw, name, label }
  const AV_COLORS = [0x5a8fd0, 0xd07a5a, 0x6fae5a, 0xb060c0, 0xd0b050, 0x50b0b0];

  N.init = function (theScene) { scene = theScene; };
  N.connected = function () { return !!ws && ws.readyState === 1; };
  N.isHost = function () { return isHost; };
  N.myId = function () { return myId; };

  function makeLabel(txt) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 32;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, 0, 128, 32);
    x.fillStyle = '#fff'; x.font = 'bold 18px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(txt.slice(0, 12), 64, 17);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(1.6, 0.4, 1);
    return spr;
  }

  function addAvatar(id, nm) {
    if (avatars.has(id)) return;
    const g = new THREE.Group();
    const col = AV_COLORS[id % AV_COLORS.length];
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.35), new THREE.MeshLambertMaterial({ color: col }));
    body.position.y = 1.0; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshLambertMaterial({ color: 0xe8bd98 }));
    head.position.y = 1.75; head.castShadow = true; g.add(head);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.22), new THREE.MeshLambertMaterial({ color: col }));
      arm.position.set(s * 0.4, 1.0, 0); g.add(arm);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.9, 0.24), new THREE.MeshLambertMaterial({ color: 0x39435a }));
      leg.position.set(s * 0.16, 0.45, 0); g.add(leg);
    }
    const label = makeLabel(nm || ('Speler ' + id));
    label.position.y = 2.3; g.add(label);
    g.position.set(0, -999, 0);
    scene.add(g);
    avatars.set(id, { group: g, body, head, tx: 0, ty: -999, tz: 0, tyaw: 0, name: nm });
  }
  function removeAvatar(id) { const a = avatars.get(id); if (a) { scene.remove(a.group); avatars.delete(id); } }
  function clearAvatars() { for (const id of [...avatars.keys()]) removeAvatar(id); }

  N.connect = function (opts, onStatus) {
    N.disconnect();
    room = opts.room || 'wereld'; name = opts.name || 'Speler'; isHost = !!opts.host;
    const url = opts.url;
    try { ws = new WebSocket(url); } catch (e) { onStatus && onStatus('error', 'Ongeldig serveradres'); return; }
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', room, name, seed: opts.seed >>> 0 })); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      onMessage(m, onStatus);
    };
    ws.onerror = () => { onStatus && onStatus('error', 'Verbinding mislukt'); };
    ws.onclose = () => { clearAvatars(); onStatus && onStatus('closed'); };
  };

  N.disconnect = function () {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    clearAvatars();
  };

  function onMessage(m, onStatus) {
    if (m.t === 'welcome') {
      myId = m.id; isHost = m.host;
      for (const p of m.peers) addAvatar(p.id, p.name);
      // wereld opzetten met de seed en bestaande edits (gebeurt in Main)
      if (window.Main && Main.onNetWelcome) Main.onNetWelcome(m);
      onStatus && onStatus('joined', m);
    } else if (m.t === 'full') {
      onStatus && onStatus('full', m);
      N.disconnect();
    } else if (m.t === 'join') {
      addAvatar(m.id, m.name);
      if (window.UI) UI.toast((m.name || 'Een speler') + ' kwam erbij 👋');
      if (isHost) sendTime();   // nieuwe speler meteen de juiste tijd geven
    } else if (m.t === 'leave') {
      removeAvatar(m.id);
    } else if (m.t === 'host') {
      isHost = (m.id === myId);
    } else if (m.t === 'pose') {
      let a = avatars.get(m.id); if (!a) { addAvatar(m.id); a = avatars.get(m.id); }
      a.tx = m.x; a.ty = m.y; a.tz = m.z; a.tyaw = m.yaw || 0;
    } else if (m.t === 'edit') {
      applyRemoteEdit(m);
    } else if (m.t === 'edits') {
      // edit-historie in stukjes (voor laat-toegetreden spelers)
      if (Array.isArray(m.list)) for (const e of m.list) applyEditRecord(e);
    } else if (m.t === 'time') {
      // alleen de host bepaalt de tijd; gasten volgen (dagteller volgt vanzelf)
      if (!isHost && typeof m.timeSec === 'number') {
        G.timeSec = m.timeSec;
        if (typeof m.dayMin === 'number' && m.dayMin > 0) G.settings.dayMinutes = m.dayMin;
      }
    } else if (m.t === 'chat') {
      if (window.UI) UI.toast((m.name || 'Speler') + ': ' + m.msg);
    }
  }

  // Legt een bewerking vast in de edit-store én past 'm toe op geladen chunks.
  // recordEdit is essentieel: Chunks.setBlock negeert bewerkingen op chunks die
  // (nog) niet geladen zijn, dus zonder dit zou een bouwsel buiten je zichtbereik
  // verloren gaan zodra die chunk instreamt.
  function applyEditRecord(e) {
    if (!window.Chunks) return;
    suppressBroadcast = true;
    G.recordEdit(e.x, e.y, e.z, e.b);
    G.setMeta(e.x, e.y, e.z, e.m || 0);
    Chunks.setBlock(e.x, e.y, e.z, e.b, true, e.m || 0);
    suppressBroadcast = false;
  }

  function applyRemoteEdit(m) {
    if (!window.Chunks) return;
    const prev = Chunks.getBlock(m.x, m.y, m.z);
    applyEditRecord(m);
    // stam weggehaald → laat bijbehorende bladeren ook hier vervallen
    if (m.b === G.B.AIR && G.LOG_BLOCKS && G.LOG_BLOCKS.has(prev) && Chunks.decayLeavesAfterLog) {
      Chunks.decayLeavesAfterLog(m.x, m.y, m.z);
    }
  }

  // Door de speler veroorzaakte edit doorsturen (aangeroepen vanuit player.js)
  N.sendEdit = function (x, y, z, b, meta) {
    if (suppressBroadcast || !N.connected()) return;
    ws.send(JSON.stringify({ t: 'edit', x, y, z, b, m: meta || 0 }));
  };
  N.sendChat = function (msg) { if (N.connected()) ws.send(JSON.stringify({ t: 'chat', msg })); };
  // host deelt de tijd + daglengte zodat iedereen dezelfde dag/nacht ziet
  function sendTime() {
    if (!N.connected()) return;
    ws.send(JSON.stringify({ t: 'time', timeSec: G.timeSec, dayMin: G.settings.dayMinutes }));
  }

  // Per frame: pose sturen + avatars vloeiend interpoleren + host-tijd delen
  N.update = function (dt) {
    if (!N.connected()) return;
    poseTimer -= dt;
    if (poseTimer <= 0 && window.Player) {
      poseTimer = 0.1;
      const p = Player.pos;
      ws.send(JSON.stringify({ t: 'pose', x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +Player.yaw.toFixed(2) }));
    }
    if (isHost) {
      timeTimer -= dt;
      if (timeTimer <= 0) { timeTimer = 2; sendTime(); }
    }
    const k = Math.min(1, dt * 10);
    avatars.forEach((a) => {
      const g = a.group;
      g.position.x += (a.tx - g.position.x) * k;
      g.position.y += (a.ty - g.position.y) * k;
      g.position.z += (a.tz - g.position.z) * k;
      g.rotation.y += (a.tyaw - g.rotation.y) * k;
      if (window.__cam) a.group.children.forEach((c) => { if (c.isSprite) c.quaternion.copy(__cam.quaternion); });
    });
  };

  N.peerCount = function () { return avatars.size; };
  return N;
})();
