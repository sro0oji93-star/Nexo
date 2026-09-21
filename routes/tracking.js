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

// --- Fahrer-QR: genau EINE Aktion (idempotent) ---
// 1) Token prüfen 2) unterwegs + Startzeit + Frist speichern 3) Google Maps öffnen.
// Kein "Zugestellt"-Knopf, kein GPS, keine App. Erneutes Scannen ändert nichts.
router.get('/fahrer/:token', fahrerLimiter, async (req, res) => {
  const token = String(req.params.token || '');
  const order = await db.get('SELECT * FROM orders WHERE driver_token = $1 AND COALESCE(is_deleted,0) = 0', [token]);
  // Absichtlich 404 für alles Ungültige (kein Unterschied verraten): falscher Token,
  // Kunden-Token, Abholer-Bestellung (hat nie einen driver_token), gelöschte.
  if (!order || !tokensEqual(token, order.driver_token || '') || order.order_type !== 'lieferung') {
    return res.status(404).render('404', { title: 'Nicht gefunden' });
  }
  if (!order.driver_started_at) {
    const mins = (order.delivery_minutes != null && isFinite(order.delivery_minutes)) ? order.delivery_minutes : 15;
    const upd = await db.run(
      "UPDATE orders SET order_status = 'unterwegs', driver_started_at = NOW(), delivery_due_at = NOW() + (($1 + 2) * INTERVAL '1 minute') WHERE id = $2 AND driver_started_at IS NULL RETURNING delivery_due_at",
      [mins, order.id]
    );
    if (upd && upd.rowCount > 0) {
      try { events.emit('order:status', { id: order.id }); } catch (e) { /* still */ }
      const due = upd.rows && upd.rows[0] ? upd.rows[0].delivery_due_at : null;
      if (due) { try { scheduler.arm(order.id, due); } catch (e) { /* Timer folgt per Boot */ } }
    }
  }
  const q = [order.delivery_address, order.delivery_zip, order.delivery_city].filter(Boolean).join(', ');
  const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q || '');
  return res.redirect(302, mapsUrl);
});

module.exports = router;
module.exports.STATUS_LABEL = STATUS_LABEL;
module.exports.ACTIVE_STATI = ACTIVE_STATI;
