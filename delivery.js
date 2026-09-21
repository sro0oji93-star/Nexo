// Lieferservice-Zonen: eine Quelle für Server (order.js) und Kasse (checkout.ejs).
// Zonen stehen in settings.delivery_zones als JSON (Admin pflegbar), sonst Defaults.
const DEFAULT_ZONES = [
  { to: 3, fee: 1.00, min: 10.00, free: 20.00, time: 10 },
  { to: 6, fee: 2.00, min: 15.00, free: 25.00, time: 12 },
  { to: 9, fee: 3.00, min: 20.00, free: 30.00, time: 15 },
  { to: 12, fee: 3.50, min: 25.00, free: 0, time: 18 },
  { to: 15, fee: 4.50, min: 30.00, free: 0, time: 20 }
];

// Richtwert wenn keine Zone passt/konfiguriert ist (Minuten, inkl. Zubereitung).
const DEFAULT_DELIVERY_MINUTES = 15;

// Feste Lieferzeiten der Standard-Zonen (nach Entfernung). Wird für Backfill
// und als Fallback je Zone benutzt – bestehende gültige time-Werte bleiben immer.
const KNOWN_ZONE_TIMES = { 3: 10, 6: 12, 9: 15, 12: 18, 15: 20 };

function defaultTimeFor(to) {
  const t = KNOWN_ZONE_TIMES[Number(to)];
  return isFinite(t) ? t : DEFAULT_DELIVERY_MINUTES;
}

// Fehlende/ungültige time-Werte ergänzen (nur diese!), Rest unverändert lassen.
// Gibt { zones, changed } zurück – Preise/Entfernungen werden nie angefasst.
function fillMissingZoneTimes(arr) {
  let changed = false;
  const zones = arr.map((z) => {
    const cur = parseInt(z && z.time, 10);
    if (isFinite(cur) && cur >= 5 && cur <= 180) return z;
    changed = true;
    return Object.assign({}, z, { time: defaultTimeFor(z && z.to) });
  });
  return { zones, changed };
}

function getDeliveryZones(settings) {
  try {
    const raw = settings && settings.delivery_zones;
    if (!raw) return DEFAULT_ZONES;
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr) || !arr.length || arr.length > 10) return DEFAULT_ZONES;
    const clean = arr
      .map(z => {
        let time = parseInt(z.time, 10);
        if (!isFinite(time)) time = defaultTimeFor(z.to);
        time = Math.max(5, Math.min(180, time));
        return { to: parseFloat(z.to), fee: parseFloat(z.fee), min: parseFloat(z.min), free: parseFloat(z.free) || 0, time };
      })
      .filter(z => [z.to, z.fee, z.min, z.free].every(isFinite) && z.to > 0 && z.fee >= 0 && z.min >= 0 && z.free >= 0)
      .sort((a, b) => a.to - b.to);
    if (!clean.length) return DEFAULT_ZONES;
    return clean.map(z => ({ to: z.to, fee: Math.round(z.fee * 100) / 100, min: Math.round(z.min * 100) / 100, free: Math.round(z.free * 100) / 100, time: z.time }));
  } catch (e) {
    return DEFAULT_ZONES;
  }
}

function findDeliveryZone(zones, km) {
  for (const z of zones) {
    if (km <= z.to + 1e-9) return z;
  }
  return null;
}

module.exports = { DEFAULT_ZONES, DEFAULT_DELIVERY_MINUTES, KNOWN_ZONE_TIMES, defaultTimeFor, fillMissingZoneTimes, getDeliveryZones, findDeliveryZone };
