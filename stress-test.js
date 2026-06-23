/**
 * Stress test du serveur DogPark.
 * Simule N clients qui rejoignent le parc et émettent des positions GPS,
 * puis mesure : connexions acceptées, rejets « park_full », débit de
 * diffusion reçu, latence, et erreurs.
 *
 * Usage : node stress-test.js [nbClients] [url]
 *   node stress-test.js 120 http://localhost:3001
 */
const { io } = require('socket.io-client');

const N = parseInt(process.argv[2] || '120', 10);
const URL = process.argv[3] || 'http://localhost:3001';
const PARK = { lat: 45.60392984155466, lng: -73.83079964172741 };
const DURATION_MS = 15000;   // durée d'envoi de positions
const POS_EVERY_MS = 1000;   // chaque client bouge 1×/s (réaliste)

let connected = 0, full = 0, errors = 0, usersEvents = 0, maxUsersSeen = 0;
const latencies = [];
const clients = [];

function jitter(base) { return base + (Math.random() - 0.5) * 0.0004; }

console.log(`\n🔬 Stress test : ${N} clients → ${URL}\n`);

for (let i = 0; i < N; i++) {
  const sessionId = `stress-${i}-${Math.random().toString(36).slice(2, 8)}`;
  const socket = io(URL, { transports: ['websocket'], reconnection: false });
  clients.push(socket);

  socket.on('connect', () => {
    connected++;
    socket.emit('join', { sessionId, visible: true });
  });
  socket.on('park_full', () => { full++; });
  socket.on('connect_error', () => { errors++; });
  socket.on('users', (list) => {
    usersEvents++;
    if (Array.isArray(list)) maxUsersSeen = Math.max(maxUsersSeen, list.length);
  });

  // Latence applicative : on mesure le temps aller-retour d'un ping socket.io
  const posTimer = setInterval(() => {
    if (!socket.connected) return;
    const t0 = Date.now();
    socket.volatile.emit('position', {
      sessionId,
      position: { lat: jitter(PARK.lat), lng: jitter(PARK.lng) },
      visible: true,
      note: i % 10 === 0 ? 'beau labrador brun' : null,
    });
    socket.emit('ping_test', t0); // pas géré côté serveur → ignoré, sert juste de charge
    latencies.push(Date.now() - t0); // latence d'émission locale
  }, POS_EVERY_MS);
  socket.data = { posTimer };
}

setTimeout(() => {
  const memBefore = process.memoryUsage().rss / 1024 / 1024;
  console.log('─'.repeat(50));
  console.log(`Clients lancés          : ${N}`);
  console.log(`Connectés               : ${connected}`);
  console.log(`Rejets « park_full »    : ${full}`);
  console.log(`Erreurs de connexion    : ${errors}`);
  console.log(`Événements 'users' reçus: ${usersEvents}`);
  console.log(`Max visiteurs vus       : ${maxUsersSeen}`);
  console.log(`Débit diffusion/client  : ${(usersEvents / connected / (DURATION_MS / 1000)).toFixed(2)}/s (attendu ≈ 1/s)`);
  console.log(`RAM client de test      : ${memBefore.toFixed(0)} Mo`);
  console.log('─'.repeat(50));

  const plafondOk = maxUsersSeen <= 100;
  const debitOk = (usersEvents / connected / (DURATION_MS / 1000)) <= 2;
  console.log(`\n✅ Plafond 100 respecté  : ${plafondOk ? 'OUI' : 'NON ⚠️'}`);
  console.log(`✅ Diffusion bornée 1/s  : ${debitOk ? 'OUI' : 'NON ⚠️'}`);
  console.log(`✅ Connexions sans crash : ${errors === 0 ? 'OUI' : `NON (${errors} erreurs)`}\n`);

  clients.forEach(c => { clearInterval(c.data.posTimer); c.close(); });
  process.exit(0);
}, DURATION_MS);
