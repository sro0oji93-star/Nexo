// Theken-Kasse (Admin): Bestellungen am Tresen per Touchscreen aufnehmen.
// Wiederverwendung statt Duplikate:
//  - Produktdaten/Loader aus routes/menu.js (Kategorien, Produkte, Box-/Deal-Listen)
//  - Preis-/Validierungslogik aus order-pricing.js (identisch zur Kunden-Kasse)
//  - Bon + Druck über GET /admin/bestellungen/:id/bon (unverändert, Abholer => kein QR)
// Eigene Regeln (nur Theke): fester Kunde "Theke", immer Abholung/Bar, kein Rabatt,
// manuelle Lieferkosten-Whitelist [0, 1, 1.50, 2, 2.50, 3]. Kein DB-Schema-Wechsel.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const events = require('../events');
const { priceItems, splitVat } = require('../order-pricing');
const { loadBoxLists, loadDealLists } = require('./menu');
const { TOPPINGS, FISH_TOPPINGS, EXTRA_PRICES, KAESERAND } = require('../extras');

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
    pizzaExtras: { toppings: TOPPINGS, fish: FISH_TOPPINGS, prices: EXTRA_PRICES, kaeserand: KAESERAND }
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
    const total = Math.max(0, subtotal + fee);
    // Lieferkosten folgen 7 % (wie online), Rabatt gibt es an der Theke nicht.
    const { vat7, vat19 } = splitVat(priced.gross7 + fee, priced.gross19, 0);
    const orderNumber = 'FEIN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const confirmToken = crypto.randomBytes(32).toString('hex');
    const ins = await db.run(`INSERT INTO orders (order_number, customer_name, customer_email, customer_phone, delivery_address, delivery_city, delivery_zip, notes, items, subtotal, delivery_fee, discount, discount_code, total, payment_method, payment_status, order_status, order_type, vat7, vat19, wish_time, confirm_token, driver_token, delivery_minutes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24) RETURNING id`,
      [orderNumber, 'Theke', '', null, null, null, null, 'Theken-Bestellung',
      JSON.stringify(priced.items), subtotal, fee, 0, null, total,
      'bar', 'bar', 'neu', 'abholung', vat7, vat19, null, confirmToken, null, null]
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

module.exports = router;
