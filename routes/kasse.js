// Theken-Kasse (Admin): Bestellungen am Tresen per Touchscreen aufnehmen.
// Wiederverwendung statt Duplikate:
//  - Produktdaten/Loader aus routes/menu.js (Kategorien, Produkte, Box-/Deal-Listen)
//  - Preis-/Validierungslogik aus order-pricing.js (identisch zur Kunden-Kasse)
//  - Bon + Druck über GET /admin/bestellungen/:id/bon (unverändert, Abholer => kein QR)
// Eigene Regeln (nur Theke): fester Kunde "Theke", immer Abholung/Bar,
// EIN Prozent-Rabatt (discount_percent 0–100, kein Code, keine discounts-Tabelle),
// manuelle Lieferkosten-Whitelist [0, 1, 1.50, 2, 2.50, 3]. Kein DB-Schema-Wechsel.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const events = require('../events');
const { priceItems, splitVat } = require('../order-pricing');
const { loadBoxLists, loadDealLists } = require('./menu');
const { TOPPINGS, BELAG_LABELS, FISH_TOPPINGS, EXTRA_PRICES, KAESERAND } = require('../extras');

const KASSE_FEE_MAX = 999;

// Touch-Oberfläche: alle Kategorien + Produkte (ohne Bilder), Optionen wie im Menü.
router.get('/kasse', auth, async (req, res) => {
  const [categories, products, boxLists, dealLists] = await Promise.all([
    db.all('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order'),
    db.all("SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id IN (SELECT MIN(id) FROM products GROUP BY name) ORDER BY c.sort_order, p.sort_order"),
    loadBoxLists(),
    loadDealLists()
  ]);
  const { resolveGroups } = require('../boxen');
  for (const p of products) {
    const g = resolveGroups(p.slug, boxLists);
    if (g) p.boxGroups = g;
  }
  res.render('admin/kasse', {
    title: 'Kasse – Admin',
    categories,
    products,
    boxLists,
    dealLists,
    pizzaExtras: { toppings: TOPPINGS, labels: BELAG_LABELS, fish: FISH_TOPPINGS, prices: EXTRA_PRICES, kaeserand: KAESERAND }
  });
});

// Theken-Bestellung anlegen (Bar, Abholung, Kunde "Theke").
router.post('/kasse/order', auth, async (req, res) => {
  try {
    const parsedItems = req.body.items;
    if (!Array.isArray(parsedItems) || !parsedItems.length) {
      return res.status(400).json({ success: false, message: 'Keine Positionen.' });
    }
    // Manueller Betrag oder fester Button (UI-Shortcuts in kasse.ejs): ersetzen, nie addieren.
    // Gültig: 0 bis KASSE_FEE_MAX, auf Cent gerundet. Negatives/Unsinn -> 400.
    let fee = parseFloat(String(req.body.fee).replace(',', '.'));
    if (!isFinite(fee)) fee = 0;
    fee = Math.round(fee * 100) / 100;
    if (fee < 0 || fee > KASSE_FEE_MAX) {
      return res.status(400).json({ success: false, message: 'Ungültige Lieferkosten.' });
    }
    let priced;
    try {
      priced = await priceItems(parsedItems);
    } catch (e) {
      return res.status(e && e.status ? e.status : 400).json({ success: false, message: (e && e.message) || 'Ungültige Bestellung' });
    }
    const subtotal = priced.subtotal;
    // Rabatt: EIN Prozentwert aus der Kasse (z.B. 10 = 10%), ersetzt immer den
    // vorherigen Wert (kein Stapeln). Kein Rabattcode, kein Euro-Betrag, kein
    // Eintrag in die discounts-Tabelle. Dieselbe Total/VAT-Mathematik wie online.
    let pctRaw = req.body.discount_percent;
    if (pctRaw === undefined || pctRaw === null || String(pctRaw).trim() === '') pctRaw = '0';
    const discountPercent = parseFloat(String(pctRaw).replace(',', '.'));
    if (!isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      return res.status(400).json({ success: false, message: 'Ungültiger Rabattprozentsatz (0–100).' });
    }
    const kasseDiscount = Math.round(subtotal * discountPercent) / 100;
    const discountLabel = discountPercent > 0
      ? (String(Number.isInteger(discountPercent) ? discountPercent : Math.round(discountPercent * 100) / 100) + '%')
      : null;
    const total = Math.max(0, subtotal + fee - kasseDiscount);
    // Lieferkosten folgen 7 %, Rabatt anteilig je Satz (wie online).
    const { vat7, vat19 } = splitVat(priced.gross7 + fee, priced.gross19, kasseDiscount);
    const orderNumber = 'FEIN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const confirmToken = crypto.randomBytes(32).toString('hex');
    const ins = await db.run(`INSERT INTO orders (order_number, customer_name, customer_email, customer_phone, delivery_address, delivery_city, delivery_zip, notes, items, subtotal, delivery_fee, discount, discount_code, total, payment_method, payment_status, order_status, order_type, vat7, vat19, wish_time, confirm_token, driver_token, delivery_minutes, order_source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25) RETURNING id`,
      [orderNumber, 'Theke', '', null, null, null, null, 'Theken-Bestellung',
      JSON.stringify(priced.items), subtotal, fee, kasseDiscount, discountLabel, total,
      'bar', 'bar', 'neu', 'abholung', vat7, vat19, null, confirmToken, null, null, 'theke']
    );
    const orderId = ins.rows && ins.rows[0] ? ins.rows[0].id : null;
    // Auto-Druck + Admin-Push wie bei Online-Bestellungen (Bon-System unverändert).
    if (orderId) {
      try { events.emit('order:new', { id: orderId }); } catch (e) { /* still */ }
      try { events.emit('order:status', { id: orderId }); } catch (e) { /* still */ }
    }
    res.json({ success: true, id: orderId, orderNumber, total });
  } catch (err) {
    console.error('Kasse order error:', err);
    res.status(500).json({ success: false, message: 'Fehler bei der Bestellung' });
  }
});

// ---------- Telefonbestellung (nur Lieferung, kein Payment-Selector, kein Rabatt) ----------
// Wiederverwendung: Produkte/Loader aus menu.js, priceItems/splitVat aus order-pricing.js,
// Zonen/Geocoding-Logik aus order.js (identisch zu Online). Snapshot: Kundendaten werden
// zum Erstellungszeitpunkt in die order-Zeile kopiert (alte Bestellungen bleiben unverändert).
const { getDeliveryZones, findDeliveryZone, DEFAULT_DELIVERY_MINUTES } = require('../delivery');

function normalizePhone(p) {
  let digits = String(p || '').replace(/\D/g, '');
  if (digits.slice(0, 2) === '00') digits = digits.slice(2);
  if (digits.slice(0, 2) === '49') digits = '0' + digits.slice(2);
  return digits;
}

// Touch-Oberfläche + Kundenformular (Admin only, auth). Zonen für Lieferkosten-Vorschau.
router.get('/kasse/telefon', auth, async (req, res) => {
  const [categories, products, boxLists, dealLists] = await Promise.all([
    db.all('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order'),
    db.all("SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id IN (SELECT MIN(id) FROM products GROUP BY name) ORDER BY c.sort_order, p.sort_order"),
    loadBoxLists(),
    loadDealLists()
  ]);
  const { resolveGroups } = require('../boxen');
  for (const p of products) {
    const g = resolveGroups(p.slug, boxLists);
    if (g) p.boxGroups = g;
  }
  res.render('admin/telefon', {
    title: 'Telefonbestellung – Admin',
    categories,
    products,
    boxLists,
    dealLists,
    deliveryZones: getDeliveryZones(res.locals.settings),
    pizzaExtras: { toppings: TOPPINGS, labels: BELAG_LABELS, fish: FISH_TOPPINGS, prices: EXTRA_PRICES, kaeserand: KAESERAND }
  });
});

// Kunde per Telefon suchen (Admin only, exakt 1 Query).
router.get('/kasse/telefon/kunde', auth, async (req, res) => {
  const norm = normalizePhone(req.query.phone);
  if (!norm) return res.json({ success: true, found: false });
  const row = await db.get('SELECT * FROM customers WHERE phone_norm = $1', [norm]);
  if (!row) return res.json({ success: true, found: false });
  res.json({ success: true, found: true, kunde: row });
});

// Kunde anlegen/aktualisieren (Admin only, Upsert per phone_norm).
router.post('/kasse/telefon/kunde', auth, async (req, res) => {
  try {
    const { isValidPhone } = require('./order');
    const phone = String(req.body.phone || '').trim();
    const name = String(req.body.name || '').trim();
    if (!isValidPhone(phone)) return res.status(400).json({ success: false, message: 'Ungültige Telefonnummer.' });
    if (!name) return res.status(400).json({ success: false, message: 'Bitte Namen eingeben.' });
    const norm = normalizePhone(phone);
    const strasse = String(req.body.strasse || '').trim().slice(0, 120);
    const hausnummer = String(req.body.hausnummer || '').trim().slice(0, 20);
    const plz = String(req.body.plz || '').trim().slice(0, 10);
    const ort = String(req.body.ort || '').trim().slice(0, 80);
    if (!strasse || !hausnummer || !plz || !ort) {
      return res.status(400).json({ success: false, message: 'Bitte vollständige Adresse eingeben.' });
    }
    const up = await db.run(`INSERT INTO customers (phone, phone_norm, name, strasse, hausnummer, plz, ort, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (phone_norm) DO UPDATE SET phone = $1, name = $3, strasse = $4, hausnummer = $5, plz = $6, ort = $7, updated_at = NOW()
      RETURNING *`, [phone, norm, name, strasse, hausnummer, plz, ort]);
    res.json({ success: true, kunde: up.rows[0] });
  } catch (err) {
    console.error('Telefon kunde error:', err);
    res.status(500).json({ success: false, message: 'Fehler beim Speichern' });
  }
});

// Telefonbestellung anlegen (immer Lieferung, Zone wie online, kein Rabatt, Zahlung 'telefon').
router.post('/kasse/telefon/order', auth, async (req, res) => {
  try {
    const { isValidPhone, checkDeliveryArea } = require('./order');
    const parsedItems = req.body.items;
    if (!Array.isArray(parsedItems) || !parsedItems.length) {
      return res.status(400).json({ success: false, message: 'Keine Positionen.' });
    }
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    const strasse = String(req.body.strasse || '').trim().slice(0, 120);
    const hausnummer = String(req.body.hausnummer || '').trim().slice(0, 20);
    const plz = String(req.body.plz || '').trim().slice(0, 10);
    const ort = String(req.body.ort || '').trim().slice(0, 80);
    const notes = String(req.body.notes || '').trim().slice(0, 500);
    if (!name) return res.status(400).json({ success: false, message: 'Bitte Kundennamen eingeben.' });
    if (!isValidPhone(phone)) return res.status(400).json({ success: false, message: 'Ungültige Telefonnummer.' });
    if (!strasse || !hausnummer || !plz || !ort) {
      return res.status(400).json({ success: false, message: 'Bitte vollständige Lieferadresse eingeben.' });
    }
    const address = (strasse + ' ' + hausnummer).trim();
    let priced;
    try {
      priced = await priceItems(parsedItems);
    } catch (e) {
      return res.status(e && e.status ? e.status : 400).json({ success: false, message: (e && e.message) || 'Ungültige Bestellung' });
    }
    if (priced.hasPickupOnlyDeal) {
      return res.status(400).json({ success: false, message: 'Der Night Deal ist nur für Abholer.' });
    }
    // Lieferzone + Gebühr EXAKT wie Online (order.js): Geocoding/OSRM, Zonenpreise, Mindestwert.
    const settings = res.locals.settings || {};
    const zones = getDeliveryZones(settings);
    const area = await checkDeliveryArea(address, plz, ort, settings);
    const tel = settings.phone || '04131 4006817';
    if (area.noRoute) {
      return res.status(400).json({ success: false, message: 'Adresse mit dem Auto nicht erreichbar. Bitte prüfen: ' + tel });
    }
    let zone = null;
    if (area.km != null) {
      const cap = parseFloat(settings.max_delivery_km) || (zones.length ? zones[zones.length - 1].to : 15);
      if (area.km > cap + 1e-9) {
        return res.status(400).json({ success: false, message: 'Adresse liegt über ' + cap + ' km Fahrstrecke.' });
      }
      zone = findDeliveryZone(zones, area.km);
    }
    const subtotal = priced.subtotal;
    if (zone && subtotal < zone.min - 1e-9) {
      return res.status(400).json({ success: false, message: 'Mindestbestellwert ' + zone.min.toFixed(2).replace('.', ',') + ' € nicht erreicht.' });
    }
    const deliveryFee = parseFloat(settings.delivery_fee) || 4.50;
    const freeFrom = parseFloat(settings.free_delivery_from) || 0;
    const fee = zone ? ((zone.free > 0 && subtotal >= zone.free - 1e-9) ? 0 : zone.fee) : (subtotal >= freeFrom ? 0 : deliveryFee);
    const total = Math.max(0, subtotal + fee); // kein Rabatt für Telefonbestellung
    const { vat7, vat19 } = splitVat(priced.gross7 + fee, priced.gross19, 0);
    const deliveryMinutes = (zone && isFinite(zone.time)) ? zone.time : DEFAULT_DELIVERY_MINUTES;
    const orderNumber = 'FEIN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const confirmToken = crypto.randomBytes(32).toString('hex');
    const driverToken = crypto.randomBytes(32).toString('hex');
    const custRow = await db.get('SELECT id FROM customers WHERE phone_norm = $1', [normalizePhone(phone)]).catch(() => null);
    const ins = await db.run(`INSERT INTO orders (order_number, customer_name, customer_email, customer_phone, delivery_address, delivery_city, delivery_zip, notes, items, subtotal, delivery_fee, discount, discount_code, total, payment_method, payment_status, order_status, order_type, vat7, vat19, wish_time, confirm_token, driver_token, delivery_minutes, order_source, customer_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26) RETURNING id`,
      [orderNumber, name, '', phone, address, ort, plz, notes || null,
      JSON.stringify(priced.items), subtotal, fee, 0, null, total,
      'telefon', 'telefon', 'neu', 'lieferung', vat7, vat19, null, confirmToken, driverToken, deliveryMinutes, 'telefon', custRow ? custRow.id : null]
    );
    const orderId = ins.rows && ins.rows[0] ? ins.rows[0].id : null;
    if (orderId) {
      try { events.emit('order:new', { id: orderId }); } catch (e) { /* still */ }
      try { events.emit('order:status', { id: orderId }); } catch (e) { /* still */ }
    }
    res.json({ success: true, id: orderId, orderNumber, total, deliveryFee: fee });
  } catch (err) {
    console.error('Telefon order error:', err);
    res.status(500).json({ success: false, message: 'Fehler bei der Bestellung' });
  }
});

module.exports = router;
