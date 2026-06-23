// Tout vit en mémoire vive — rien n'est persisté nulle part
const sessions = {};

function upsertSession(sessionId, data) {
  sessions[sessionId] = {
    ...(sessions[sessionId] ?? {}),
    ...data,
    lastSeen: Date.now(),
  };
}

function removeSession(sessionId) {
  delete sessions[sessionId];
}

function getVisibleSessions() {
  return Object.entries(sessions)
    .filter(([, s]) => s.visible && s.position)
    .map(([sessionId, s]) => ({
      sessionId,
      position: s.position,
      visible: s.visible,
      note: s.note ?? null,
    }));
}

function clearAll() {
  Object.keys(sessions).forEach(k => delete sessions[k]);
}

function sessionCount() {
  return Object.keys(sessions).length;
}

function hasSession(sessionId) {
  return Object.prototype.hasOwnProperty.call(sessions, sessionId);
}

// Supprime les sessions inactives depuis plus de 5 minutes
function pruneStale() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  Object.entries(sessions).forEach(([id, s]) => {
    if (s.lastSeen < cutoff) delete sessions[id];
  });
}

module.exports = { upsertSession, removeSession, getVisibleSessions, clearAll, pruneStale, sessionCount, hasSession };
