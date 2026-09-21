// Liefer-Abschluss ohne Dauer-Polling: ein One-Shot-Timer pro aktiver Lieferung.
// Source of Truth ist IMMER delivery_due_at in Postgres (nicht der Speicher):
//  - Bei Fahrer-Scan wird genau ein Timer bis zur Fälligkeit gestellt.
//  - Bei Serverstart (Render-Restart/Redeploy) werden überfällige Bestellungen
//    sofort abgeschlossen und laufende Timer neu gestellt (Boot-Catch-up).
//  - Im Leerlauf (keine aktiven Lieferungen) läuft KEINE einzige Query.
//  - Das bedingte UPDATE ist idempotent: Doppel-Feuer ändert nichts.
const db = require('./db');
const events = require('./events');

const FINALIZABLE = ['neu', 'in_bearbeitung', 'unterwegs'];
const timers = new Map();

function emitStatus(id) {
  try { events.emit('order:status', { id }); } catch (e) { /* still */ }
}

// Alle fälligen Lieferungen genau einmal auf 'zugestellt' setzen.
async function completeDueOrders() {
  const r = await db.run(
    "UPDATE orders SET order_status = 'zugestellt' WHERE order_type = 'lieferung' AND order_status IN ('neu', 'in_bearbeitung', 'unterwegs') AND delivery_due_at IS NOT NULL AND delivery_due_at <= NOW() RETURNING id"
  );
  const ids = (r && r.rows ? r.rows : []).map((x) => x.id);
  for (const id of ids) {
    if (timers.has(id)) { clearTimeout(timers.get(id)); timers.delete(id); }
    emitStatus(id);
  }
  return ids;
}

function clear(orderId) {
  if (timers.has(orderId)) { clearTimeout(timers.get(orderId)); timers.delete(orderId); }
}

// Timer für genau EINE Lieferung stellen (überschreibt still einen alten).
function arm(orderId, dueAt) {
  clear(orderId);
  const ms = new Date(dueAt).getTime() - Date.now();
  if (!(ms > 0)) {
    // Bereits fällig (z.B. lange Render-Pause): einmalig nachholen statt Timer.
    completeDueOrders().catch((e) => console.error('Liefer-Abschluss Fehler:', e.message));
    return;
  }
  const t = setTimeout(() => {
    timers.delete(orderId);
    completeDueOrders().catch((e) => console.error('Liefer-Abschluss Fehler:', e.message));
  }, ms);
  if (t && typeof t.unref === 'function') t.unref();
  timers.set(orderId, t);
}

// Beim Serverstart: Überfälliges sofort abschließen, Laufendes neu timen.
async function start() {
  try {
    await completeDueOrders();
  } catch (e) {
    console.error('Liefer-Abschluss (Catch-up) übersprungen:', e.message);
  }
  let rows = [];
  try {
    rows = await db.all(
      "SELECT id, delivery_due_at FROM orders WHERE order_type = 'lieferung' AND order_status IN ('neu', 'in_bearbeitung', 'unterwegs') AND delivery_due_at > NOW() ORDER BY delivery_due_at"
    );
  } catch (e) {
    console.error('Liefer-Timer Re-Arm übersprungen:', e.message);
    return;
  }
  for (const r of rows) {
    try { arm(r.id, r.delivery_due_at); } catch (e) { /* einzelne überspringen */ }
  }
  if (rows.length) console.log('Liefer-Timer gestellt für ' + rows.length + ' aktive Lieferung(en).');
}

module.exports = { arm, clear, start, completeDueOrders };
