// Ascend — HTTP + WebSocket server. Serves the client and runs the game rooms.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const G = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json',
};

// ---- Static files -----------------------------------------------------------
const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { urlPath = '/'; }
  if (urlPath === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---- Rooms ------------------------------------------------------------------
const rooms = new Map();
const BOT_NAMES = ['Willow', 'Juniper', 'Sage', 'Maple', 'River', 'Clover', 'Fern', 'Hazel'];
const AUTOPILOT_AFTER_MS = 45_000;

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function newRoom() {
  const room = {
    code: makeCode(), hostId: null, players: [], phase: 'lobby', log: [],
    settings: { target: 500, bonus: true }, round: 0, moveSeq: 0, emptySince: null,
  };
  rooms.set(room.code, room);
  return room;
}

function addPlayer(room, name, ws, isBot = false) {
  const p = {
    id: crypto.randomUUID().slice(0, 8), token: crypto.randomUUID(), name, ws,
    isBot, autopilot: false, connected: !isBot, score: 0, rack: [], color: '#8ec5ff',
  };
  room.players.push(p);
  if (!room.hostId && !isBot) room.hostId = p.id;
  return p;
}

function cleanName(raw) {
  const name = String(raw || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return name || 'Player';
}

function viewFor(room, viewerId) {
  const reveal = room.phase === 'roundOver' || room.phase === 'gameOver';
  const cur = room.phase === 'playing' ? G.currentPlayer(room) : null;
  return {
    code: room.code, phase: room.phase, you: viewerId, hostId: room.hostId,
    settings: room.settings, round: room.round, maxCard: room.maxCard || 40,
    turnId: cur ? cur.id : null,
    players: room.players.map(p => ({
      id: p.id, name: p.name, score: p.score, color: p.color, isBot: p.isBot,
      autopilot: p.autopilot, connected: p.isBot || p.connected,
      rack: (p.id === viewerId || reveal) ? p.rack : null,
    })),
    deckCount: room.deck ? room.deck.length : 0,
    discardTop: room.discard && room.discard.length ? room.discard[room.discard.length - 1] : null,
    discardCount: room.discard ? room.discard.length : 0,
    held: room.held ? {
      from: room.held.from,
      card: (cur && cur.id === viewerId) || room.held.from === 'discard' ? room.held.card : null,
    } : null,
    lastMove: room.lastMove, roundResult: room.roundResult, winnerId: room.winnerId || null,
    log: room.log.slice(-8),
  };
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room) {
  for (const p of room.players) if (p.ws) send(p.ws, { type: 'state', state: viewFor(room, p.id) });
  scheduleBot(room);
}

function broadcastEvent(room, msg) {
  for (const p of room.players) if (p.ws) send(p.ws, msg);
}

// ---- Bots / autopilot -------------------------------------------------------
function scheduleBot(room) {
  if (room.botTimer || room.phase !== 'playing') return;
  const p = G.currentPlayer(room);
  if (!p.isBot && !p.autopilot) return;
  const delay = room.held ? 900 + Math.random() * 500 : 1100 + Math.random() * 900;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (room.phase !== 'playing') return;
    const cur = G.currentPlayer(room);
    if (cur.id !== p.id || (!cur.isBot && !cur.autopilot)) return;
    const plan = G.botPlan(room);
    try {
      if (plan.action === 'draw') G.draw(room, cur.id, plan.from);
      else if (plan.action === 'place') G.place(room, cur.id, plan.slot);
      else G.discardHeld(room, cur.id);
    } catch (e) { console.error('bot error', e); }
    broadcast(room);
  }, delay);
}

function removePlayer(room, playerId) {
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx === -1) return;
  room.players.splice(idx, 1);
  if (room.hostId === playerId) {
    const nextHost = room.players.find(p => !p.isBot);
    room.hostId = nextHost ? nextHost.id : null;
  }
  if (!room.players.some(p => !p.isBot)) {
    clearTimeout(room.botTimer);
    rooms.delete(room.code);
  }
}

// ---- Message handling -------------------------------------------------------
function handle(ws, msg) {
  const ctx = ws.ctx; // { room, player } once joined
  const room = ctx && ctx.room;
  const me = ctx && ctx.player;
  const isHost = room && me && room.hostId === me.id;
  const fail = (text) => send(ws, { type: 'error', message: text });

  switch (msg.type) {
    case 'create': {
      const r = newRoom();
      const p = addPlayer(r, cleanName(msg.name), ws);
      ws.ctx = { room: r, player: p };
      G.log(r, `${p.name} opened the room.`);
      send(ws, { type: 'joined', code: r.code, token: p.token, id: p.id });
      return broadcast(r);
    }
    case 'join': {
      const r = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!r) return fail("Couldn't find a room with that code.");
      if (r.phase !== 'lobby') return fail('That game has already started.');
      if (r.players.length >= 4) return fail('That room is full (4 players max).');
      const p = addPlayer(r, cleanName(msg.name), ws);
      ws.ctx = { room: r, player: p };
      G.log(r, `${p.name} joined.`);
      send(ws, { type: 'joined', code: r.code, token: p.token, id: p.id });
      broadcastEvent(r, { type: 'arrived', playerId: p.id });
      return broadcast(r);
    }
    case 'resume': {
      const r = rooms.get(String(msg.code || '').toUpperCase());
      const p = r && r.players.find(x => x.token === msg.token);
      if (!p) return send(ws, { type: 'resumeFailed' });
      if (p.ws && p.ws !== ws) { try { p.ws.close(); } catch {} }
      p.ws = ws; p.connected = true; p.autopilot = false; clearTimeout(p.awayTimer);
      ws.ctx = { room: r, player: p };
      r.emptySince = null;
      send(ws, { type: 'joined', code: r.code, token: p.token, id: p.id });
      return broadcast(r);
    }
  }

  if (!room || !me) return fail('Join a room first.');

  try {
    switch (msg.type) {
      case 'leave': {
        if (room.phase === 'lobby') {
          G.log(room, `${me.name} left.`);
          removePlayer(room, me.id);
        } else {
          me.connected = false; me.autopilot = true; me.ws = null;
          G.log(room, `${me.name} left — autopilot is playing for them.`);
        }
        ws.ctx = null;
        if (rooms.has(room.code)) broadcast(room);
        return;
      }
      case 'settings': {
        if (!isHost || room.phase !== 'lobby') return fail('Only the host can change settings in the lobby.');
        if ([100, 200, 300, 500].includes(msg.target)) room.settings.target = msg.target;
        if (typeof msg.bonus === 'boolean') room.settings.bonus = msg.bonus;
        return broadcast(room);
      }
      case 'addBot': {
        if (!isHost || room.phase !== 'lobby') return fail('Only the host can add bots.');
        if (room.players.length >= 4) return fail('The table is full.');
        const used = new Set(room.players.map(p => p.name));
        const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot';
        addPlayer(room, name, null, true);
        G.log(room, `${name} (bot) sat down.`);
        return broadcast(room);
      }
      case 'kick': {
        if (!isHost || room.phase !== 'lobby') return fail('Only the host can do that.');
        const target = room.players.find(p => p.id === msg.playerId);
        if (!target || target.id === me.id) return;
        if (target.ws) { send(target.ws, { type: 'kicked' }); target.ws.ctx = null; }
        removePlayer(room, target.id);
        return broadcast(room);
      }
      case 'start': {
        if (!isHost) return fail('Only the host can start the game.');
        if (room.phase !== 'lobby') return;
        G.startGame(room);
        return broadcast(room);
      }
      case 'draw': G.draw(room, me.id, msg.from); return broadcast(room);
      case 'place': G.place(room, me.id, msg.slot); return broadcast(room);
      case 'discard': G.discardHeld(room, me.id); return broadcast(room);
      case 'nextRound': {
        if (!isHost) return fail('Waiting for the host to deal the next round.');
        if (room.phase !== 'roundOver') return;
        G.startRound(room);
        return broadcast(room);
      }
      case 'backToLobby': {
        if (!isHost || room.phase !== 'gameOver') return;
        room.phase = 'lobby';
        room.players = room.players.filter(p => p.isBot || p.connected);
        room.players.forEach(p => { p.score = 0; p.rack = []; p.autopilot = false; });
        room.roundResult = null; room.lastMove = null; room.held = null; room.winnerId = null;
        return broadcast(room);
      }
      case 'react': {
        const emoji = ['👋', '😮', '😅', '🎉', '🙏', '😎'].includes(msg.emoji) ? msg.emoji : null;
        if (!emoji) return;
        const now = Date.now();
        if (me.lastReact && now - me.lastReact < 700) return;
        me.lastReact = now;
        return broadcastEvent(room, { type: 'reaction', playerId: me.id, emoji });
      }
      default: return fail('Unknown action.');
    }
  } catch (e) {
    if (e instanceof G.GameError) return fail(e.message);
    console.error(e);
    return fail('Something went wrong.');
  }
}

// ---- WebSocket server -------------------------------------------------------
const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    handle(ws, msg);
  });
  ws.on('close', () => {
    const ctx = ws.ctx;
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.ws !== ws) return; // replaced by a newer connection
    player.ws = null;
    player.connected = false;
    if (room.phase === 'lobby') {
      // Give them a moment to refresh the page before freeing the seat.
      player.awayTimer = setTimeout(() => {
        if (!player.connected && rooms.has(room.code) && room.phase === 'lobby') {
          removePlayer(room, player.id);
          if (rooms.has(room.code)) broadcast(room);
        }
      }, 20_000);
    } else {
      player.awayTimer = setTimeout(() => {
        if (!player.connected && rooms.has(room.code)) {
          player.autopilot = true;
          G.log(room, `${player.name} is away — autopilot is playing for them.`);
          broadcast(room);
        }
      }, AUTOPILOT_AFTER_MS);
    }
    if (rooms.has(room.code)) broadcast(room);
  });
});

// Keep connections alive through proxies, and tidy up abandoned rooms.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = room.players.some(p => !p.isBot && p.connected);
    if (anyone) { room.emptySince = null; continue; }
    room.emptySince = room.emptySince || now;
    if (now - room.emptySince > 30 * 60_000) { clearTimeout(room.botTimer); rooms.delete(code); }
  }
}, 25_000);

server.listen(PORT, () => {
  console.log(`\n  ✦ Ascend is running at http://localhost:${PORT}\n`);
});
