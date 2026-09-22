const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const events = require('../events');
const { priceItems, splitVat } = require('../order-pricing');

// "YYYY-MM-DDTHH:MM" als Berlin-Wandzeit -> UTC-Millis (Client-Zeit kann manipuliert sein)
function berlinToUtcMs(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  let utc = guess;
  for (let i = 0; i < 3; i++) {
    const parts = {};
    for (const p of fmt.formatToParts(new Date(utc))) parts[p.type] = p.value;
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, (+parts.hour) % 24, +parts.minute, +parts.second);
    utc = guess + (guess - asUtc);
  }
  return utc;
}
function berlinHourOf(utcMs) {
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(new Date(utcMs));
  return parseInt(s, 10);
}
// Wunschtermin prüfen -> { ok, wishUtc } oder { ok:false, message }
function validateWishTime(wishTime, type, settings) {
  const m = String(wishTime || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return { ok: false, message: 'Ungültiger Wunschtermin.' };
  const wishUtc = berlinToUtcMs(+m[1], +m[2], +m[3], +m[4], +m[5]);
  if (!isFinite(wishUtc)) return { ok: false, message: 'Ungültiger Wunschtermin.' };
  const s = settings || {};
  let lead = parseInt(type === 'abholung' ? s.min_preorder_minutes_pickup : s.min_preorder_minutes_delivery, 10);
  if (!isFinite(lead)) {
    lead = parseInt(s.min_preorder_minutes, 10); // Fallback: alter Einzelwert
    if (!isFinite(lead)) lead = (type === 'abholung' ? 15 : 45);
  }
  lead = Math.max(15, Math.min(240, lead));
  if (wishUtc < Date.now() + lead * 60000 - 60000) {
    return { ok: false, message: 'Der Wunschtermin muss mindestens ' + lead + ' Minuten in der Zukunft liegen.' };
  }
  const maxAhead = (type === 'abholung' ? 7 : 30) * 86400000;
  if (wishUtc > Date.now() + maxAhead) {
    return { ok: false, message: type === 'abholung' ? 'Abholung ist maximal 7 Tage im Voraus buchbar.' : 'Bitte wählen Sie einen früheren Termin.' };
  }
  const h = berlinHourOf(wishUtc);
  if (h < 12) return { ok: false, message: 'Wunschtermine sind nur zwischen 12:00 und 00:00 Uhr möglich.' };
  return { ok: true, wishUtc };
}

// Liefergebiet serverseitig prüfen (Nominatim-Geocoding + OSRM-Fahrstrecke).
// Ergebnis: { km } (km=null -> unverifiziert, fail-open) oder { km, noRoute:true } (keine Fahrstrecke -> nicht lieferbar)
// Zonen kommen aus den Einstellungen (Admin pflegbar), siehe delivery.js
const { getDeliveryZones, findDeliveryZone, DEFAULT_DELIVERY_MINUTES } = require('../delivery');

async function checkDeliveryArea(address, zip, city, settings) {
  const rLat = parseFloat((settings && (settings.restaurant_lat || settings.latitude)) || 53.295344);
  const rLon = parseFloat((settings && (settings.restaurant_lon || settings.longitude)) || 10.391293);
  if (!isFinite(rLat) || !isFinite(rLon)) return { km: null };
  const q = [address, zip, city].filter(Boolean).join(', ');
  if (!q.trim()) return { km: null };
  const fetchOpts = { headers: { 'User-Agent': 'Ammaya-Restaurant-Shop/1.0 (info@ammaya.de)', 'Accept-Language': 'de' }, signal: AbortSignal.timeout(8000) };
  try {
    const geoUrl = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de&q=' + encodeURIComponent(q);
    const geoRes = await fetch(geoUrl, fetchOpts);
    const geo = await geoRes.json();
    if (!Array.isArray(geo) || !geo.length || !isFinite(parseFloat(geo[0].lat))) return { km: null };
    const cLat = parseFloat(geo[0].lat);
    const cLon = parseFloat(geo[0].lon);
    const routeUrl = 'https://router.project-osrm.org/route/v1/driving/' + rLon + ',' + rLat + ';' + cLon + ',' + cLat + '?overview=false';
    const routeRes = await fetch(routeUrl, fetchOpts);
    const route = await routeRes.json();
    if (!route || !route.routes || !route.routes.length || typeof route.routes[0].distance !== 'number') {
      return { km: null, noRoute: true }; // keine Fahrstrecke -> nicht lieferbar
    }
    const km = route.routes[0].distance / 1000;
    return { km: Math.round(km * 10) / 10 };
  } catch (e) {
    console.error('Liefergebiets-Prüfung übersprungen:', e.message);
    return { km: null };
  }
}
function isValidPhone(p) {
  if (p == null) return false;
  const s = String(p).trim();
  if (!/^[+\d\s(][\d\s\-/().]*$/.test(s)) return false;
  let digits = s.replace(/\D/g, '');
  if (digits.slice(0, 2) === '00') digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return false;
  return digits.charAt(0) === '0' || digits.slice(0, 2) === '49';
}

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const settings = res.locals.settings;
  
  res.render('checkout', {
    title: 'Kasse – ' + settings.site_name,
    settings,
    deliveryZones: getDeliveryZones(settings)
  });
});

router.post('/', async (req, res) => {
  try {
    const { name, phone, address, city, zip, notes, items, discount_code, orderType } = req.body;
    const payment = req.body.payment === 'online' ? 'online' : 'bar';

    if (!isValidPhone(phone)) {
      return res.status(400).json({ success: false, message: 'Bitte geben Sie eine gültige Telefonnummer an (z. B. 0151 23456789).' });
    }

    const parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    const type = orderType === 'abholung' ? 'abholung' : 'lieferung';
    const email = (req.body.email || '').trim();

    // Wunschtermin prüfen (null = so schnell wie möglich)
    let wishIso = null;
    if (req.body.wish_time) {
      const check = validateWishTime(req.body.wish_time, type, res.locals.settings);
      if (!check.ok) return res.status(400).json({ success: false, message: check.message });
      wishIso = new Date(check.wishUtc).toISOString();
    }

    // Liefergebiet + Zonenpreise serverseitig prüfen (nur Lieferung; Abholung bleibt immer möglich)
    const zones = getDeliveryZones(res.locals.settings);
    const maxKm = zones.length ? zones[zones.length - 1].to : 15;
    let zone = null;
    let areaKm = null;
    if (type === 'lieferung') {
      const area = await checkDeliveryArea(address, zip, city, res.locals.settings);
      const s = res.locals.settings || {};
      const tel = s.phone || '04131 4006817';
      if (area.noRoute) {
        return res.status(400).json({ success: false, message: 'Ihre Adresse ist mit dem Auto leider nicht erreichbar. Bitte rufen Sie uns an: ' + tel + ' – oder wählen Sie Abholung.' });
      }
      if (area.km != null) {
        areaKm = area.km;
        const cap = parseFloat(s.max_delivery_km) || maxKm;
        if (area.km > cap + 1e-9) {
          return res.status(400).json({ success: false, message: 'Ihre Adresse liegt über ' + cap + ' km Fahrstrecke von uns entfernt. Bitte rufen Sie uns an: ' + tel + ' – oder wählen Sie Abholung.' });
        }
        zone = findDeliveryZone(zones, area.km);
      }
    }

    // Positionen zentral bepreisen/prüfen (identische Logik wie Theken-Kasse, siehe order-pricing.js).
    let priced;
    try {
      priced = await priceItems(parsedItems);
    } catch (e) {
      return res.status(e && e.status ? e.status : 400).json({ success: false, message: (e && e.message) || 'Ungültige Bestellung' });
    }
    const calculatedSubtotal = priced.subtotal;
    let gross7 = priced.gross7, gross19 = priced.gross19;
    const hasPickupOnlyDeal = priced.hasPickupOnlyDeal;
    
    const settings = res.locals.settings;
    // Night Deal: Abholung erzwingen (Client-Angabe nicht vertrauen)
    if (hasPickupOnlyDeal && type !== 'abholung') {
      return res.status(400).json({ success: false, message: 'Der Night Deal ist nur für Abholer – bitte Abholung wählen.' });
    }
    // Zonen-Mindestbestellwert prüfen (Zwischensumme vor Rabatt)
    if (zone && calculatedSubtotal < zone.min - 1e-9) {
      const kmTxt = areaKm != null ? String(areaKm).replace('.', ',') + ' km' : '';
      return res.status(400).json({ success: false, message: 'Der Mindestbestellwert für Ihre Entfernung (' + kmTxt + ') beträgt ' + zone.min.toFixed(2).replace('.', ',') + ' €. Bitte fügen Sie noch Artikel hinzu.' });
    }
    // Zonen-Lieferzuschlag (fix je Zone); ohne Zone alte Pauschal-Logik als Fallback
    const deliveryFee = parseFloat(settings.delivery_fee) || 4.50;
    const freeFrom = parseFloat(settings.free_delivery_from) || 0;
    let calculatedDelivery;
    if (type === 'abholung') calculatedDelivery = 0;
    else if (zone) calculatedDelivery = (zone.free > 0 && calculatedSubtotal >= zone.free - 1e-9) ? 0 : zone.fee;
    else calculatedDelivery = calculatedSubtotal >= freeFrom ? 0 : deliveryFee;
    
    let calculatedDiscount = 0;
    let validCode = null;
    if (discount_code) {
      const now = new Date().toISOString().split('T')[0];
      const discount = await db.get(`SELECT * FROM discounts WHERE code = $1 AND active = 1 AND (expires_at IS NULL OR expires_at > $2) AND (usage_limit = 0 OR used_count < usage_limit)`, [discount_code, now]);
      if (discount && (!discount.min_order || calculatedSubtotal >= parseFloat(discount.min_order))) {
        validCode = discount_code;
        calculatedDiscount = discount.type === 'prozent'
          ? (calculatedSubtotal * parseFloat(discount.value) / 100)
          : parseFloat(discount.value);
      }
    }
    
    const calculatedTotal = Math.max(0, calculatedSubtotal + calculatedDelivery - calculatedDiscount);

    // MwSt je Satz aus Bruttototalen (Liefergebühr folgt 7 %, Rabatt anteilig je Satz)
    const { vat7, vat19 } = splitVat(gross7 + calculatedDelivery, gross19, calculatedDiscount);

    const orderNumber = 'FEIN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    // Geheimer Token: schützt die Bestellübersicht (kein Fremdzugriff über die Bestellnummer)
    const confirmToken = crypto.randomBytes(32).toString('hex');

    // Tracking: Lieferzeit der passenden Zone JETZT festschreiben (wird später nie neu berechnet,
    // damit spätere Zonen-Änderungen laufende Bestellungen nicht verfälschen). Fahrer-Token nur
    // für Lieferung – Abholer bekommen nie einen Fahrer-QR.
    const deliveryMinutes = type === 'lieferung'
      ? (zone && isFinite(zone.time) ? zone.time : DEFAULT_DELIVERY_MINUTES)
      : null;
    const driverToken = type === 'lieferung' ? crypto.randomBytes(32).toString('hex') : null;

    // Online-Zahlung: Bestellung parken (kein Druck/Ton), erst Webhook gibt sie frei
    const isOnline = payment === 'online';
    const ins = await db.run(`INSERT INTO orders (order_number, customer_name, customer_email, customer_phone, delivery_address, delivery_city, delivery_zip, notes, items, subtotal, delivery_fee, discount, discount_code, total, payment_method, payment_status, order_status, order_type, vat7, vat19, wish_time, confirm_token, driver_token, delivery_minutes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24) RETURNING id`,
      [orderNumber, name, email, phone, address, city, zip, notes,
      JSON.stringify(parsedItems), calculatedSubtotal, calculatedDelivery, calculatedDiscount, validCode, calculatedTotal,
      payment, isOnline ? 'ausstehend' : 'bar', isOnline ? 'wartet_auf_zahlung' : 'neu', type, vat7, vat19, wishIso, confirmToken, driverToken, deliveryMinutes]
    );
    const orderId = ins.rows && ins.rows[0] ? ins.rows[0].id : null;

    if (validCode) {
      await db.run('UPDATE discounts SET used_count = used_count + 1 WHERE code = $1', [validCode]);
    }

    if (isOnline) {
      try {
        const { createCheckoutSession } = require('./stripe');
        const session = await createCheckoutSession(
          { id: orderId, order_number: orderNumber, total: calculatedTotal, customer_email: email, items: parsedItems, confirm_token: confirmToken }, req
        );
        return res.json({ success: true, orderNumber, confirmToken, stripeUrl: session.url, message: 'Weiter zur Zahlung' });
      } catch (err) {
        console.error('Stripe-Session Fehler:', err.message);
        if (orderId) await db.run("UPDATE orders SET order_status = 'storniert' WHERE id = $1", [orderId]);
        return res.status(500).json({ success: false, message: 'Online-Zahlung derzeit nicht möglich – bitte Barzahlung wählen.' });
      }
    }

    // Admin-Push (SSE): offene Admin-Seiten sofort benachrichtigen (kein Polling nötig).
    // Fire-and-forget: Die Bestellantwort darf nie am Event-Bus scheitern.
    if (orderId) {
      try { events.emit('order:new', { id: orderId }); } catch (e) { /* still */ }
      try { events.emit('order:status', { id: orderId }); } catch (e) { /* still */ }
    }

    res.json({ success: true, orderNumber, confirmToken, message: 'Bestellung erfolgreich aufgegeben!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Fehler bei der Bestellung' });
  }
});

router.post('/rabatt-pruefen', async (req, res) => {
  const { code, subtotal } = req.body;
  const now = new Date().toISOString().split('T')[0];
  const discount = await db.get(`SELECT * FROM discounts WHERE code = $1 AND active = 1 AND (expires_at IS NULL OR expires_at > $2) AND (usage_limit = 0 OR used_count < usage_limit)`, [code, now]);
  
  if (!discount) return res.json({ valid: false, message: 'Rabattcode ungültig oder abgelaufen' });
  
  if (discount.min_order > 0 && subtotal < discount.min_order) {
    return res.json({ valid: false, message: 'Mindestbestellwert von ' + discount.min_order.toFixed(2) + ' € nicht erreicht' });
  }
  
  let discountValue = 0;
  if (discount.type === 'prozent') {
    discountValue = (subtotal * discount.value / 100);
  } else {
    discountValue = discount.value;
  }
  
  res.json({ valid: true, value: parseFloat(discountValue.toFixed(2)), type: discount.type, message: 'Rabatt angewendet!' });
});

router.get('/bestellung/:orderNumber', async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE order_number = $1', [req.params.orderNumber]);
  if (!order) return res.status(404).render('404', { title: 'Bestellung nicht gefunden' });
  // Schutz vor Fremdzugriff (IDOR): nur mit gültigem Bestätigungs-Token sichtbar
  const token = req.query.t || '';
  const expected = order.confirm_token || '';
  let tokenOk = false;
  if (token && expected && token.length === expected.length) {
    try { tokenOk = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected)); } catch (e) { tokenOk = false; }
  }
  if (!tokenOk) return res.status(404).render('404', { title: 'Bestellung nicht gefunden' });
  order.wish_display = db.formatWishDisplay(order.wish_time);

  const settings = res.locals.settings;

  // Rechnung für alle normalen Online-Bestellungen – nie für Theke (siehe invoice.js).
  const { isKasseOrder } = require('./invoice');
  res.render('order-confirmation', {
    title: 'Bestellung ' + order.order_number + ' – ' + settings.site_name,
    order,
    settings,
    showInvoice: !isKasseOrder(order)
  });
});

module.exports = router;
