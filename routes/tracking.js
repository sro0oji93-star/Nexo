// Kunden-Sendungsverfolgung + Fahrer-QR – alles über die bestehende SSE-Architektur.
// - Tracking-Seite: /verfolgung/:orderNumber?t=<confirm_token> (Kunden-Token, kein Login)
// - Live-Stream: /verfolgung/stream?tokens=a,b (nur validierte Bestellungen, kein Polling)
// - Fahrer-Scan: /fahrer/:driverToken (genau EINE Aktion: unterwegs markieren + Maps öffnen)
// Getrennt Tokens: Kunden-Token kann NIE Fahrer-Aktionen auslösen (eigene Route + eigenes Token).
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const events = require('../events');
const scheduler = require('../delivery-scheduler');

const router = express.Router();

// QR-Scans begrenzen (Missbrauchsschutz, großzügig für echte Fahrer-Handys).
const fahrerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).send('Zu viele Versuche – bitte später erneut versuchen.'),
});

// GPS-Updates: eigenes Limit (alle ~10s + Spielraum; teilt sich nichts mit dem QR-Limit).
const driverLocLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ success: false, message: 'Zu viele Updates – bitte kurz warten.' }),
});

const ACTIVE_STATI = ['neu', 'in_bearbeitung', 'unterwegs'];
const STATUS_LABEL = {
  neu: 'Bestellung eingegangen',
  in_bearbeitung: 'Bestellung wird zubereitet',
  unterwegs: 'Fahrer ist unterwegs',
  zugestellt: 'Bestellung zugestellt',
  geliefert: 'Bestellung zugestellt',
  storniert: 'Bestellung storniert',
  wartet_auf_zahlung: 'Wartet auf Zahlung'
};

function isActive(order) {
  return !!order && ACTIVE_STATI.indexOf(order.order_status) !== -1;
}

function statusLabel(order) {
  return (order && STATUS_LABEL[order.order_status]) || 'Unbekannt';
}

// Timing-sicherer Token-Vergleich (kein schrittweises Erraten).
function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (e) { return false; }
}

function publicOrder(order) {
  return {
    order_number: order.order_number,
    status: order.order_status,
    label: statusLabel(order),
    active: isActive(order),
    order_type: order.order_type,
    total: order.total,
    delivery_due_at: order.delivery_due_at || null
  };
}

// Fällige Einzelbestellung genau einmal nachziehen (Read-Piggyback-Guard:
// nur beim Tracking-Aufruf, nur diese ID, kein Dauer-Job).
async function flipIfDue(order) {
  if (!order || !isActive(order) || !order.delivery_due_at) return order;
  if (new Date(order.delivery_due_at).getTime() > Date.now()) return order;
  const upd = await db.run(
    "UPDATE orders SET order_status = 'zugestellt' WHERE id = $1 AND order_status IN ('neu', 'in_bearbeitung', 'unterwegs') AND delivery_due_at IS NOT NULL AND delivery_due_at <= NOW()",
    [order.id]
  );
  if (upd && upd.rowCount > 0) {
    order.order_status = 'zugestellt';
    try { events.emit('order:status', { id: order.id }); } catch (e) { /* still */ }
  }
  return order;
}

async function findByTracking(orderNumber, token) {
  const order = await db.get('SELECT * FROM orders WHERE order_number = $1 AND COALESCE(is_deleted,0) = 0', [orderNumber]);
  if (!order || !order.confirm_token) return null;
  if (!tokensEqual(String(token || ''), order.confirm_token)) return null;
  return order;
}

// --- Live-Stream für Tracking-Seite + Homepage-Widget (SSE, kein Polling) ---
// tokens: komma-getrennte confirm_token. Nur validierte Bestellungen werden gepusht.
// WICHTIG: Diese Route MUSS vor /verfolgung/:orderNumber stehen, sonst frisst
// der :orderNumber-Parameter den Pfad "stream".
router.get('/verfolgung/stream', async (req, res) => {
  const wanted = String(req.query.tokens || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!wanted.length) return res.status(401).end();
  const allowed = new Map(); // confirm_token -> order id
  for (const t of wanted) {
    const row = await db.get('SELECT id, confirm_token FROM orders WHERE confirm_token = $1 AND COALESCE(is_deleted,0) = 0', [t]).catch(() => null);
    if (row && tokensEqual(t, row.confirm_token)) allowed.set(row.confirm_token, row.id);
  }
  if (!allowed.size) return res.status(401).end();

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  async function pushOrder(id) {
    if (![...allowed.values()].includes(id)) return; // strikt: nur eigene Bestellungen
    const order = await db.get('SELECT * FROM orders WHERE id = $1 AND COALESCE(is_deleted,0) = 0', [id]).catch(() => null);
    if (!order || !tokensEqual(order.confirm_token || '', [...allowed.keys()].find((k) => allowed.get(k) === id) || '')) return;
    await flipIfDue(order).catch(() => {});
    res.write('event: status\ndata: ' + JSON.stringify(publicOrder(order)) + '\n\n');
  }

  // Startzustand sofort senden (Catch-up beim Connect).
  for (const id of allowed.values()) {
    try { await pushOrder(id); } catch (e) { /* still */ }
  }

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (e) { /* tot */ }
  }, 25000);

  const onStatus = (payload) => { pushOrder(payload && payload.id).catch(() => {}); };
  events.on('order:status', onStatus);
  req.on('close', () => {
    clearInterval(heartbeat);
    events.removeListener('order:status', onStatus);
  });
});

// --- Tracking-Seite (Kunde, kein Login) ---
router.get('/verfolgung/:orderNumber', async (req, res) => {
  const order = await findByTracking(req.params.orderNumber, req.query.t);
  if (!order) return res.status(404).render('404', { title: 'Bestellung nicht gefunden' });
  await flipIfDue(order).catch(() => {});
  order.wish_display = db.formatWishDisplay(order.wish_time);
  res.render('verfolgung', {
    title: 'Sendungsverfolgung ' + order.order_number,
    order: publicOrder(order),
    trackingToken: order.confirm_token,
    settings: res.locals.settings
  });
});

// --- Fahrer-QR (einheitlich für Online-Lieferung + Telefonbestellung) ---
// One-Time-Use + 30-Minuten-Session, alles serverseitig:
// 1) Erster Scan: Token prüfen -> used_at + Session-Token + Ablauf setzen (atomar),
//    unterwegs/Startzeit/Frist wie bisher speichern, Session-Cookie setzen, Fahrer-Seite zeigen.
// 2) Erneuter Aufruf: nur mit gültigem, nicht abgelaufenem Session-Cookie -> Seite.
//    Sonst: "bereits verwendet / abgelaufen". QR enthält NUR den Token (keine PII).
// Alte Bons/QRs laufen in dasselbe System (driver_token unverändert, neue Spalten nullable).
function getCookie(req, cname) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === cname) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setFahrerCookie(res, orderId, sessToken) {
  const cname = 'fahrer_' + orderId;
  const val = encodeURIComponent(sessToken);
  // 30 Minuten, HttpOnly + Lax (Fahrer-Handy-Browser). Secure nur hinter HTTPS.
  res.setHeader('Set-Cookie', cname + '=' + val + '; Path=/; Max-Age=1800; HttpOnly; SameSite=Lax');
}

function fahrerPageData(order) {
  let items = [];
  try { items = JSON.parse(order.items || '[]'); } catch (e) { items = []; }
  const q = [order.delivery_address, order.delivery_zip, order.delivery_city].filter(Boolean).join(', ');
  const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q || '');
  const tel = String(order.customer_phone || '').replace(/[^+\d]/g, '').slice(0, 20);
  return { order, items, mapsUrl, tel };
}

router.get('/fahrer/:token', fahrerLimiter, async (req, res) => {
  const token = String(req.params.token || '');
  const order = await db.get('SELECT * FROM orders WHERE driver_token = $1 AND COALESCE(is_deleted,0) = 0', [token]);
  // Absichtlich 404 für alles Ungültige (kein Unterschied verraten): falscher Token,
  // Kunden-Token, Abholer-Bestellung (hat nie einen driver_token), gelöschte.
  if (!order || !tokensEqual(token, order.driver_token || '') || order.order_type !== 'lieferung') {
    return res.status(404).render('404', { title: 'Nicht gefunden' });
  }
  if (order.fahrer_revoked) {
    return res.status(410).render('fahrer', { title: 'QR ungültig', fahrerError: 'revoked' });
  }
  const cname = 'fahrer_' + order.id;
  const cookieSess = getCookie(req, cname);
  // Erster Scan: Token verbrauchen + Session erzeugen (atomar gegen Doppel-Scan).
  if (!order.fahrer_used_at) {
    const sessToken = crypto.randomBytes(32).toString('hex');
    const upd = await db.run(
      "UPDATE orders SET fahrer_used_at = NOW(), fahrer_session_token = $1, fahrer_session_expires_at = NOW() + INTERVAL '30 minutes' WHERE id = $2 AND fahrer_used_at IS NULL RETURNING fahrer_session_expires_at",
      [sessToken, order.id]
    );
    if (!upd || upd.rowCount === 0) {
      // Gleichzeitiger Zweit-Scan: ohne gültige Session ablehnen.
      return res.status(410).render('fahrer', { title: 'QR bereits verwendet', fahrerError: 'used' });
    }
    if (!order.driver_started_at) {
      const mins = (order.delivery_minutes != null && isFinite(order.delivery_minutes)) ? order.delivery_minutes : 15;
      const upd2 = await db.run(
        "UPDATE orders SET order_status = 'unterwegs', driver_started_at = NOW(), delivery_due_at = NOW() + (($1 + 2) * INTERVAL '1 minute') WHERE id = $2 AND driver_started_at IS NULL RETURNING delivery_due_at",
        [mins, order.id]
      );
      if (upd2 && upd2.rowCount > 0) {
        try { events.emit('order:status', { id: order.id }); } catch (e) { /* still */ }
        const due = upd2.rows && upd2.rows[0] ? upd2.rows[0].delivery_due_at : null;
        if (due) { try { scheduler.arm(order.id, due); } catch (e) { /* Timer folgt per Boot */ } }
      }
    }
    setFahrerCookie(res, order.id, sessToken);
    const fresh = await db.get('SELECT * FROM orders WHERE id = $1', [order.id]);
    return res.render('fahrer', Object.assign({ title: 'Fahrer – ' + order.order_number, trackingOn: trackingOn(res.locals.settings) }, fahrerPageData(fresh || order)));
  }
  // Token bereits verbraucht: nur mit gültiger, nicht abgelaufener Session weiter.
  const sessOk = cookieSess && order.fahrer_session_token
    && tokensEqual(cookieSess, order.fahrer_session_token)
    && order.fahrer_session_expires_at && new Date(order.fahrer_session_expires_at).getTime() > Date.now();
  if (sessOk) {
    return res.render('fahrer', Object.assign({ title: 'Fahrer – ' + order.order_number, trackingOn: trackingOn(res.locals.settings) }, fahrerPageData(order)));
  }
  const expired = order.fahrer_session_expires_at && new Date(order.fahrer_session_expires_at).getTime() <= Date.now();
  return res.status(410).render('fahrer', { title: expired ? 'Sitzung abgelaufen' : 'QR bereits verwendet', fahrerError: expired ? 'expired' : 'used' });
});

module.exports = router;
module.exports.STATUS_LABEL = STATUS_LABEL;
module.exports.ACTIVE_STATI = ACTIVE_STATI;

// --- Fahrer Live-Tracking (Trip-basiert, Memory-only) ---
// WICHTIG: GPS wird NIE in der DB gespeichert (kein History, kein INSERT).
// Trip-Status lebt nur in dieser Map: orderId -> { phase, lat, lon, acc, ts, orderNumber }.
// phases: 'to_customer' (Shop -> Kunde) | 'returning' (Kunde -> Shop nach "Zugestellt").
// Ende: Radius um den Shop (nur in 'returning') -> löschen + 'driver:returned'.
// Toggle OFF / Session-Ende / Timeout -> löschen + 'driver:stopped'.
const trips = new Map();

function trackingOn(settings) {
  return String((settings || {}).live_tracking) === '1';
}

function shopCoords(settings) {
  const s = settings || {};
  const lat = parseFloat(s.restaurant_lat || s.latitude);
  const lon = parseFloat(s.restaurant_lon || s.longitude);
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function trackingRadiusM(settings) {
  const r = parseFloat((settings || {}).live_tracking_radius);
  if (!isFinite(r)) return 75;
  return Math.max(20, Math.min(500, r));
}

function haversineM(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const t = Math.PI / 180;
  const dLat = (bLat - aLat) * t;
  const dLon = (bLon - aLon) * t;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function tripPublic(orderId) {
  const t = trips.get(orderId);
  if (!t) return null;
  return { orderId, orderNumber: t.orderNumber, phase: t.phase, addr: t.addr || '', lat: t.lat, lon: t.lon, acc: t.acc, ts: t.ts };
}

function tripSnapshot() {
  const out = [];
  for (const id of trips.keys()) {
    const p = tripPublic(id);
    if (p) out.push(p);
  }
  return out;
}

function stopTrip(orderId, reason) {
  if (!trips.has(orderId)) return false;
  const t = trips.get(orderId);
  trips.delete(orderId);
  try { events.emit(reason === 'returned' ? 'driver:returned' : 'driver:stopped', { id: orderId, orderNumber: t.orderNumber, ended: reason }); } catch (e) { /* still */ }
  return true;
}

// Kill-Switch (Toggle OFF): alle Trips sofort beenden (Admin-Map räumt live auf).
function stopAllTrips() {
  const ids = [...trips.keys()];
  for (const id of ids) stopTrip(id, 'stopped');
  return ids.length;
}

// Veraltete Trips (Fahrer hat Seite geschlossen): nach 5 Min. Funkstille beenden. Memory-only, kein DB-Zugriff.
setInterval(() => {
  try {
    const now = Date.now();
    for (const [id, t] of trips) {
      if (now - t.ts > 5 * 60 * 1000) stopTrip(id, 'stopped');
    }
  } catch (e) { /* still */ }
}, 60 * 1000);

// Gemeinsame Prüfung für Tracking-POSTs: Token + Session + Toggle.
// Gibt { order } zurück oder sendet direkt die Fehlerantwort (false).
// orderId kommt IMMER aus dem Server-Lookup (Token), nie aus dem Client-Body.
async function loadTrackingOrder(req, res, settings) {
  const token = String(req.params.token || '');
  const order = await db.get('SELECT * FROM orders WHERE driver_token = $1 AND COALESCE(is_deleted,0) = 0', [token]).catch(() => null);
  if (!order || !tokensEqual(token, order.driver_token || '') || order.order_type !== 'lieferung' || order.fahrer_revoked) {
    res.status(404).json({ success: false });
    return false;
  }
  if (order.order_status === 'storniert') {
    res.status(410).json({ success: false, message: 'Bestellung storniert' });
    return false;
  }
  const cname = 'fahrer_' + order.id;
  const cookieSess = getCookie(req, cname);
  const sessOk = cookieSess && order.fahrer_session_token
    && tokensEqual(cookieSess, order.fahrer_session_token)
    && order.fahrer_session_expires_at && new Date(order.fahrer_session_expires_at).getTime() > Date.now();
  if (!sessOk || !order.fahrer_used_at) {
    res.status(410).json({ success: false, message: 'Sitzung ungültig' });
    return false;
  }
  // Sichere Sliding-Verlängerung: nur wenn < 5 Min. übrig (NICHT bei jedem GPS-Update).
  try {
    const remain = new Date(order.fahrer_session_expires_at).getTime() - Date.now();
    if (remain < 5 * 60 * 1000) {
      const sessToken = crypto.randomBytes(32).toString('hex');
      await db.run("UPDATE orders SET fahrer_session_token = $1, fahrer_session_expires_at = NOW() + INTERVAL '30 minutes' WHERE id = $2", [sessToken, order.id]);
      setFahrerCookie(res, order.id, sessToken);
    }
  } catch (e) { /* still – Ablauf bleibt wie bisher */ }
  if (!trackingOn(settings)) {
    stopTrip(order.id, 'stopped');
    res.status(403).json({ success: false, tracking: false, message: 'Live-Tracking deaktiviert' });
    return false;
  }
  return { order };
}

// POST /fahrer/:token/location – GPS-Update (alle ~10s), Memory-only.
router.post('/fahrer/:token/location', driverLocLimiter, async (req, res) => {
  const found = await loadTrackingOrder(req, res, res.locals.settings);
  if (!found) return;
  const order = found.order;
  const lat = parseFloat(req.body && req.body.lat);
  const lon = parseFloat(req.body && req.body.lon);
  const acc = req.body && req.body.acc != null ? parseFloat(req.body.acc) : null;
  if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ success: false, message: 'Ungültige Koordinaten' });
  }
  const now = Date.now();
  let trip = trips.get(order.id);
  if (!trip) {
    // Trip-Start (nach QR-Scan): Phase aus Order-Status rekonstruieren (Restart-sicher).
    // Adresse einmalig aus der ohnehin geladenen Bestellung übernehmen (kein Extra-Query).
    const addrParts = [order.delivery_address, order.delivery_zip, order.delivery_city].filter(Boolean);
    trip = {
      phase: order.order_status === 'zugestellt' ? 'returning' : 'to_customer',
      orderNumber: order.order_number, addr: addrParts.join(', '), lat: 0, lon: 0, acc: null, ts: now
    };
    trips.set(order.id, trip);
  }
  trip.lat = lat;
  trip.lon = lon;
  trip.acc = (acc != null && isFinite(acc) && acc >= 0) ? acc : null;
  trip.ts = now;
  try { events.emit('driver:location', tripPublic(order.id)); } catch (e) { /* still */ }
  // Ankunft am Shop? Nur in 'returning' + brauchbare Genauigkeit.
  const shop = shopCoords(res.locals.settings);
  if (trip.phase === 'returning' && shop && (trip.acc == null || trip.acc <= 100)) {
    const d = haversineM(lat, lon, shop.lat, shop.lon);
    if (d <= trackingRadiusM(res.locals.settings)) {
      stopTrip(order.id, 'returned');
      return res.json({ success: true, returned: true });
    }
  }
  res.json({ success: true, phase: trip.phase });
});

// POST /fahrer/:token/delivered – "Zugestellt": Ziel wechselt Kunde -> Shop (GPS bleibt an, kein Löschen).
router.post('/fahrer/:token/delivered', fahrerLimiter, async (req, res) => {
  const found = await loadTrackingOrder(req, res, res.locals.settings);
  if (!found) return;
  const order = found.order;
  if (['neu', 'in_bearbeitung', 'unterwegs', 'zugestellt'].indexOf(order.order_status) === -1) {
    return res.status(409).json({ success: false, message: 'Status passt nicht' });
  }
  const upd = await db.run(
    "UPDATE orders SET order_status = 'zugestellt' WHERE id = $1 AND order_status IN ('neu', 'in_bearbeitung', 'unterwegs') AND COALESCE(is_deleted,0) = 0",
    [order.id]
  ).catch(() => null);
  if (upd && upd.rowCount > 0) {
    try { events.emit('order:status', { id: order.id }); } catch (e) { /* still */ }
  }
  const trip = trips.get(order.id);
  if (trip && trip.phase !== 'returning') {
    trip.phase = 'returning';
    trip.ts = Date.now();
    try { events.emit('driver:location', tripPublic(order.id)); } catch (e) { /* still */ }
  }
  try { scheduler.clear(order.id); } catch (e) { /* still */ }
  res.json({ success: true, phase: 'returning' });
});

module.exports.trips = trips;
module.exports.tripPublic = tripPublic;
module.exports.tripSnapshot = tripSnapshot;
module.exports.stopTrip = stopTrip;
module.exports.stopAllTrips = stopAllTrips;
module.exports.trackingOn = trackingOn;
module.exports.shopCoords = shopCoords;
module.exports.trackingRadiusM = trackingRadiusM;
module.exports.haversineM = haversineM;
