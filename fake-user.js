/**
 * Simule un utilisateur présent au parc (visible, avec une note),
 * pour tester le mode spectateur. Reste connecté jusqu'à Ctrl+C.
 */
const { io } = require('socket.io-client');
const s = io('http://localhost:3001', { transports: ['websocket'], reconnection: false });
const sessionId = 'demo-labrador';
const PARK = { lat: 45.60392984155466, lng: -73.83079964172741 };

s.on('connect', () => {
  s.emit('join', { sessionId, visible: true });
  setInterval(() => {
    s.emit('position', {
      sessionId,
      position: { lat: PARK.lat + 0.0001, lng: PARK.lng + 0.0001 },
      visible: true,
      note: 'beau labrador brun',
    });
  }, 1000);
  console.log('Utilisateur de démo présent : "beau labrador brun"');
});
