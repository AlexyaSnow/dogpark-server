// Heures d'ouverture du parc — à ajuster selon la réalité du terrain
const SCHEDULE = {
  0: { open: 7, close: 21 }, // dimanche
  1: { open: 7, close: 21 }, // lundi
  2: { open: 7, close: 21 },
  3: { open: 7, close: 21 },
  4: { open: 7, close: 21 },
  5: { open: 7, close: 21 }, // vendredi
  6: { open: 7, close: 21 }, // samedi
};

function isParkOpen() {
  if (process.env.FORCE_OPEN === '1') return true; // tests/stress uniquement
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const { open, close } = SCHEDULE[day];
  return hour >= open && hour < close;
}

function getNextCloseTime() {
  const now = new Date();
  const day = now.getDay();
  const { close } = SCHEDULE[day];
  const next = new Date(now);
  next.setHours(close, 0, 0, 0);
  return next;
}

function msUntilClose() {
  return getNextCloseTime() - Date.now();
}

module.exports = { isParkOpen, msUntilClose };
