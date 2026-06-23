const http = require('http');
const { Server } = require('socket.io');
const { isParkOpen, msUntilClose } = require('./parkSchedule');
const {
  upsertSession, removeSession, getVisibleSessions, clearAll, pruneStale,
  sessionCount, hasSession,
} = require('./sessionManager');
const bannedWords = require('./data/bannedWords.json');

const PORT = process.env.PORT || 3001;

// ─── Garde-fous ──────────────────────────────────────────────
const MAX_SESSIONS   = 100;   // plafond d'utilisateurs simultanés (anti-flood)
const MAX_EVENTS_SEC = 25;    // événements/seconde max par socket
const MIN_POS_MS     = 250;   // intervalle min entre 2 positions par socket
const MAX_NOTE_LEN   = 80;    // longueur max d'une note
const BROADCAST_MS   = 1000;  // diffusion groupée : 1 fois/seconde max

// Serveur HTTP avec endpoint /health pour UptimeRobot
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      park: isParkOpen() ? 'open' : 'closed',
      users: sessionCount(),
      ts: Date.now(),
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const io = new Server(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 2048, // 2 Ko : empêche les charges utiles géantes
  pingTimeout: 20000,
});

httpServer.listen(PORT, () => {
  console.log(`🐾 Serveur DogPark démarré sur le port ${PORT}`);
});

// ─── Diffusion groupée (coalescée) ───────────────────────────
// On ne diffuse pas à chaque événement : on marque « sale » et on
// diffuse au plus 1 fois/seconde. Borne le trafic à O(N) au lieu de O(N²).
let dirty = false;
function scheduleBroadcast() { dirty = true; }
setInterval(() => {
  if (dirty) {
    io.emit('users', getVisibleSessions());
    dirty = false;
  }
}, BROADCAST_MS);

// Reset complet à la fermeture du parc
scheduleNightlyReset();

function scheduleNightlyReset() {
  if (!isParkOpen()) {
    clearAll();
    io.emit('park_closed');
  }
  const delay = msUntilClose();
  if (delay > 0) {
    setTimeout(() => {
      clearAll();
      io.emit('park_closed');
      console.log('🌙 Parc fermé — mémoire effacée');
      scheduleNightlyReset();
    }, delay);
  }
}

// Nettoyage des sessions fantômes toutes les 2 minutes
setInterval(pruneStale, 2 * 60 * 1000);

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '');
}

function containsBannedWord(text) {
  if (!text) return false;
  const normalized = normalize(text);
  return [...bannedWords.fr, ...bannedWords.en].some(w => normalized.includes(normalize(w)));
}

// ─── Validation des entrées ──────────────────────────────────
function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 64;
}
function validPosition(p) {
  return p && typeof p.lat === 'number' && typeof p.lng === 'number'
    && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
}
function cleanNote(note) {
  if (note == null) return null;
  if (typeof note !== 'string') return null;
  return note.slice(0, MAX_NOTE_LEN);
}

io.on('connection', socket => {
  if (!isParkOpen()) {
    socket.emit('park_closed');
    socket.disconnect(true);
    return;
  }

  // Anti-flood : compteur d'événements remis à zéro chaque seconde
  socket.data.events = 0;
  socket.data.lastPos = 0;
  const rlTimer = setInterval(() => { socket.data.events = 0; }, 1000);

  // Renvoie false (et coupe le socket) si le débit dépasse la limite
  function rateOk() {
    socket.data.events += 1;
    if (socket.data.events > MAX_EVENTS_SEC) {
      socket.disconnect(true);
      return false;
    }
    return true;
  }

  // Accepte la session si elle existe déjà, ou s'il reste de la place
  function admit(sessionId) {
    if (hasSession(sessionId)) return true;
    if (sessionCount() >= MAX_SESSIONS) {
      socket.emit('park_full', { max: MAX_SESSIONS });
      return false;
    }
    return true;
  }

  socket.on('join', ({ sessionId, visible } = {}) => {
    if (!rateOk() || !validId(sessionId)) return;
    if (!admit(sessionId)) { socket.disconnect(true); return; }
    socket.data.sessionId = sessionId;
    upsertSession(sessionId, { visible: !!visible, note: null });
    scheduleBroadcast();
  });

  socket.on('position', ({ sessionId, position, visible, note } = {}) => {
    if (!rateOk() || !validId(sessionId) || !validPosition(position)) return;
    const now = Date.now();
    if (now - socket.data.lastPos < MIN_POS_MS) return; // throttle position
    socket.data.lastPos = now;
    if (!admit(sessionId)) return;
    const clean = cleanNote(note);
    if (containsBannedWord(clean)) return;
    upsertSession(sessionId, { position, visible: !!visible, note: visible ? clean : null });
    scheduleBroadcast();
  });

  socket.on('visibility', ({ sessionId, visible } = {}) => {
    if (!rateOk() || !validId(sessionId) || !hasSession(sessionId)) return;
    upsertSession(sessionId, { visible: !!visible });
    scheduleBroadcast();
  });

  socket.on('note', ({ sessionId, note } = {}) => {
    if (!rateOk() || !validId(sessionId) || !hasSession(sessionId)) return;
    const clean = cleanNote(note);
    if (containsBannedWord(clean)) {
      socket.emit('note_rejected', { reason: 'banned_word' });
      return;
    }
    upsertSession(sessionId, { note: clean });
    scheduleBroadcast();
  });

  socket.on('leave', ({ sessionId } = {}) => {
    if (!validId(sessionId)) return;
    removeSession(sessionId);
    scheduleBroadcast();
  });

  socket.on('disconnect', () => {
    clearInterval(rlTimer);
    const sessionId = socket.data.sessionId;
    if (sessionId) removeSession(sessionId);
    scheduleBroadcast();
  });
});
