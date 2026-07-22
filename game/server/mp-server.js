// Blokkenwereld multiplayer-relay — afhankelijkheidsvrij (pure Node).
// Implementeert het WebSocket-protocol met alleen 'http' + 'crypto', zodat je
// geen npm-pakketten hoeft te installeren. Start met:  node server/mp-server.js
//
// De wereld is deterministisch op basis van de seed; de server relayt daarom
// alleen spelerposities en blok-wijzigingen. Max 5 spelers per kamer.
'use strict';
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT ? +process.env.PORT : 8080;
const MAX_PER_ROOM = 5;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const rooms = new Map();   // room -> { seed, hostId, clients:Map(id->client), edits:[] }
let nextId = 1;

function log(...a) { console.log('[mp]', ...a); }

// ---- WebSocket-frames ----
function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6);
  }
  header[0] = 0x81;   // FIN + tekstframe
  return Buffer.concat([header, payload]);
}

function send(client, obj) {
  try { client.sock.write(encodeFrame(JSON.stringify(obj))); } catch (e) { /* dichte socket */ }
}

// parse zoveel volledige frames als er in de buffer zitten; retourneert rest
function parseFrames(buf, onMsg, onClose) {
  let off = 0;
  while (off + 2 <= buf.length) {
    const b0 = buf[off], b1 = buf[off + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) { if (p + 2 > buf.length) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (p + 8 > buf.length) break; len = buf.readUInt32BE(p + 4); p += 8; }
    let mask = null;
    if (masked) { if (p + 4 > buf.length) break; mask = buf.slice(p, p + 4); p += 4; }
    if (p + len > buf.length) break;   // frame nog niet compleet
    const data = buf.slice(p, p + len);
    if (masked) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    off = p + len;
    if (opcode === 0x8) { onClose(); return buf.slice(off); }        // close
    if (opcode === 0x1 || opcode === 0x0) { onMsg(data.toString('utf8')); }
    // opcode 0x9 (ping) / 0xA (pong) negeren we
  }
  return buf.slice(off);
}

function broadcast(room, obj, exceptId) {
  const r = rooms.get(room);
  if (!r) return;
  for (const c of r.clients.values()) if (c.id !== exceptId) send(c, obj);
}

function leave(client) {
  const r = rooms.get(client.room);
  if (!r) return;
  r.clients.delete(client.id);
  broadcast(client.room, { t: 'leave', id: client.id });
  log('leave', client.id, 'room', client.room, '→', r.clients.size, 'over');
  if (r.clients.size === 0) { rooms.delete(client.room); log('room', client.room, 'gesloten'); }
  else if (client.id === r.hostId) { r.hostId = r.clients.keys().next().value; broadcast(client.room, { t: 'host', id: r.hostId }); }
}

function handleMessage(client, txt) {
  let m; try { m = JSON.parse(txt); } catch (e) { return; }
  if (m.t === 'join') {
    const roomName = (m.room || 'wereld').slice(0, 32);
    let r = rooms.get(roomName);
    if (!r) { r = { seed: (m.seed >>> 0) || 1337, hostId: client.id, clients: new Map(), edits: [] }; rooms.set(roomName, r); }
    if (r.clients.size >= MAX_PER_ROOM) { send(client, { t: 'full', max: MAX_PER_ROOM }); return; }
    client.room = roomName; client.name = (m.name || 'Speler').slice(0, 20);
    const peers = [...r.clients.values()].map((c) => ({ id: c.id, name: c.name }));
    r.clients.set(client.id, client);
    send(client, { t: 'welcome', id: client.id, seed: r.seed, host: client.id === r.hostId, peers, edits: r.edits });
    broadcast(roomName, { t: 'join', id: client.id, name: client.name }, client.id);
    log('join', client.id, client.name, 'room', roomName, '(' + r.clients.size + '/' + MAX_PER_ROOM + ')');
  } else if (!client.room) {
    return;   // nog niet in een kamer
  } else if (m.t === 'pose') {
    broadcast(client.room, { t: 'pose', id: client.id, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, tp: m.tp }, client.id);
  } else if (m.t === 'edit') {
    const r = rooms.get(client.room);
    if (r) {
      r.edits.push({ x: m.x, y: m.y, z: m.z, b: m.b, m: m.m || 0 });
      if (r.edits.length > 200000) r.edits.shift();
      broadcast(client.room, { t: 'edit', x: m.x, y: m.y, z: m.z, b: m.b, m: m.m || 0 }, client.id);
    }
  } else if (m.t === 'time') {
    const r = rooms.get(client.room);
    if (r && client.id === r.hostId) broadcast(client.room, { t: 'time', timeSec: m.timeSec }, client.id);
  } else if (m.t === 'chat') {
    broadcast(client.room, { t: 'chat', id: client.id, name: client.name, msg: ('' + m.msg).slice(0, 120) });
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Blokkenwereld multiplayer-relay draait. Verbind via WebSocket.\n');
});

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');

  const client = { id: nextId++, sock, room: null, name: '' };
  let buf = Buffer.alloc(0);
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    buf = parseFrames(buf, (txt) => handleMessage(client, txt), () => { leave(client); sock.destroy(); });
  });
  sock.on('close', () => leave(client));
  sock.on('error', () => leave(client));
});

server.listen(PORT, () => log('luistert op poort ' + PORT + ' (max ' + MAX_PER_ROOM + ' per kamer)'));
