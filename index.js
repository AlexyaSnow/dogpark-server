const http = require('http');
const { Server } = require('socket.io');
const { isParkOpen, msUntilClose } = require('./parkSchedule');
const { upsertSession, removeSession, getVisibleSessions, clearAll, pruneStale } = require('./sessionManager');
const bannedWords = require('./data/bannedWords.json');

const PORT = process.env.PORT || 3001;

// Serveur HTTP avec endpoint /health pour UptimeRobot
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', park: isParkOpen() ? 'open' : 'closed', ts: Date.now() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const io = new Server(httpServer, {
  cors: { origin: '*' },
});

httpServer.listen(PORT, () => {
  console.log(`🐾 Serveur DogPark démarré sur le port ${PORT}`);
});

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

function broadcast(io) {
  const users = getVisibleSessions();
  io.emit('users', users);
}

io.on('connection', socket => {
  console.log(`+ connecté: ${socket.id}`);

  if (!isParkOpen()) {
    socket.emit('park_closed');
    socket.disconnect();
    return;
  }

  socket.on('join', ({ sessionId, visible }) => {
    socket.data.sessionId = sessionId;
    upsertSession(sessionId, { visible, note: null });
    broadcast(io);
  });

  socket.on('position', ({ sessionId, position, visible, note }) => {
    if (containsBannedWord(note)) return;
    upsertSession(sessionId, { position, visible, note: visible ? note : null });
    broadcast(io);
  });

  socket.on('visibility', ({ sessionId, visible }) => {
    upsertSession(sessionId, { visible });
    broadcast(io);
  });

  socket.on('note', ({ sessionId, note }) => {
    if (containsBannedWord(note)) {
      socket.emit('note_rejected', { reason: 'banned_word' });
      return;
    }
    upsertSession(sessionId, { note });
    broadcast(io);
  });

  socket.on('leave', ({ sessionId }) => {
    removeSession(sessionId);
    broadcast(io);
  });

  socket.on('disconnect', () => {
    const sessionId = socket.data.sessionId;
    if (sessionId) removeSession(sessionId);
    broadcast(io);
    console.log(`- déconnecté: ${socket.id}`);
  });
});
