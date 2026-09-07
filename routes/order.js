const express = require('express');
const router = express.Router();
const db = require('../db');
const { validateExtras } = require('../extras');

// Tageszeit-Angebote: Bestellfenster in Europe/Berlin (Server auf Render läuft in UTC!)
function berlinMinutes() {
  try {
    const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    const parts = s.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  } catch (e) {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
}

const TIME_DEALS = {
  'nexo-mittag-deal': { from: 12 * 60, to: 15 * 60, message: 'Der Mittag Deal ist nur von 12:00 bis 15:00 Uhr bestellbar.' },
  'nexo-night-deal': { from: 21 * 60, to: 24 * 60, message: 'Der Night Deal ist erst ab 21:00 Uhr bestellbar (nur Abholer).' },
  'deal-night-abholung': { from: 21 * 60, to: 24 * 60, message: 'Der Night Deal ist erst ab 21:00 Uhr bestellbar (nur Abholer).' }
};

// Liefergebiet serverseitig prüfen (Nominatim-Geocoding + OSRM-Fahrstrecke).
// Ergebnis: { km } (km=null -> unverifiziert, fail-open) oder { km, noRoute:true } (keine Fahrstrecke -> nicht lieferbar)
// NEXO Lieferservice-Zonen: Fahrstrecke -> Zuschlag + Mindestbestellwert (bis 15 km, darüber Anruf)
const DELIVERY_ZONES = [
  { to: 3, fee: 1.00, min: 15.00 },
  { to: 5, fee: 1.50, min: 20.00 },
  { to: 7, fee: 2.50, min: 25.00 },
  { to: 10, fee: 3.50, min: 30.00 },
  { to: 12, fee: 4.50, min: 35.00 },
  { to: 15, fee: 6.00, min: 40.00 }
];

function findDeliveryZone(km) {
  for (const z of DELIVERY_ZONES) {
    if (km <= z.to + 1e-9) return z;
  }
  return null;
}

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
    settings
  });
});

router.post('/', async (req, res) => {
  try {
    const { name, email, phone, address, city, zip, notes, items, discount_code, orderType } = req.body;
    const payment = req.body.payment === 'online' ? 'online' : 'bar';

    if (!isValidPhone(phone)) {
      return res.status(400).json({ success: false, message: 'Bitte geben Sie eine gültige Telefonnummer an (z. B. 0151 23456789).' });
    }

    const parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    const type = orderType === 'abholung' ? 'abholung' : 'lieferung';

    // Liefergebiet + Zonenpreise serverseitig prüfen (nur Lieferung; Abholung bleibt immer möglich)
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
        const cap = parseFloat(s.max_delivery_km) || 15;
        if (area.km > cap + 1e-9) {
          return res.status(400).json({ success: false, message: 'Ihre Adresse liegt über 15 km Fahrstrecke von uns entfernt. Bitte rufen Sie uns an: ' + tel + ' – oder wählen Sie Abholung.' });
        }
        zone = findDeliveryZone(area.km);
      }
    }

    let calculatedSubtotal = 0;
    let gross7 = 0, gross19 = 0; // MwSt-Bruttobasen je Steuersatz
    const nowBerlinMin = berlinMinutes();
    let hasPickupOnlyDeal = false;
    // Saucenliste für Gratis-Sauce (Rings, Pizza Brötchen) – einmal laden
    const sauceCatRow = await db.get("SELECT id FROM categories WHERE slug = 'saucen-dips'");
    const validSauces = sauceCatRow
      ? (await db.all('SELECT name FROM products WHERE category_id = $1', [sauceCatRow.id])).map(r => r.name)
      : [];
    // Schoko-Liste Dessert (Crêpes, Mini Pancakes/Waffel) – fest, inkl. je 2 Pflicht
    const CHOCO_LIST = ['Nutella', 'Weiße Schokolade', 'Pistaziencreme', 'Puderzucker'];
    // Listen für NEXO Box-Konfiguration – einmal laden
    const { validateBox, BOX_SLUGS, validateDeal, DEAL_SLUG } = require('../boxen');
    const { TOPPINGS } = require('../extras');
    // Croque-Sorten für Mittag-Deal-Prüfung – einmal laden
    const needDealLists = parsedItems.some(it => it && it.deal);
    let dealLists = null;
    if (needDealLists) {
      dealLists = {
        croques: (await db.all(
          "SELECT name FROM products WHERE category_id = (SELECT id FROM categories WHERE slug = 'croque') AND is_available = 1 ORDER BY sort_order"
        )).map(r => r.name)
      };
    }
    const needBoxLists = parsedItems.some(it => it && it.box);
    let boxLists = null;
    if (needBoxLists) {
      const boxNames = async (slug) => (await db.all(
        "SELECT name FROM products WHERE category_id = (SELECT id FROM categories WHERE slug = $1) AND is_available = 1 ORDER BY sort_order", [slug]
      )).map(r => r.name);
      boxLists = {
        sauces: validSauces,
        snacks: await boxNames('snacks'),
        pastas: await boxNames('pasta'),
        toppings: TOPPINGS
      };
    }
    for (const item of parsedItems) {
      const product = await db.get('SELECT p.id, p.slug, p.price, p.sizes, p.is_available, c.slug AS catslug FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = $1', [item.id]);
      if (!product) {
        return res.status(400).json({ success: false, message: 'Produkt nicht gefunden: ' + item.name });
      }
      if (!product.is_available) {
        return res.status(400).json({ success: false, message: 'Zurzeit ausverkauft: ' + item.name + ' – bitte aus dem Warenkorb entfernen.' });
      }
      if (product.slug === 'nexo-night-deal' || product.slug === 'deal-night-abholung') hasPickupOnlyDeal = true;
      // Tageszeit-Angebote serverseitig prüfen (Client-Zeit kann manipuliert sein)
      const rule = TIME_DEALS[product.slug];
      if (rule && (nowBerlinMin < rule.from || nowBerlinMin >= rule.to)) {
        return res.status(400).json({ success: false, message: rule.message });
      }
      let realPrice;
      // NEXO Box: Konfiguration serverseitig prüfen (alles inklusive, Preis fix)
      if (item.box && item.box.slug && BOX_SLUGS.includes(item.box.slug)) {
        const found = await db.get('SELECT id, price FROM products WHERE id = $1 AND slug = $2', [item.id, item.box.slug]);
        if (!found) {
          return res.status(400).json({ success: false, message: 'Produkt nicht gefunden: ' + item.name });
        }
        const check = validateBox(item.box.slug, item.box.choices, boxLists);
        if (!check.ok) {
          return res.status(400).json({ success: false, message: check.error + ' (' + item.name + ')' });
        }
        realPrice = parseFloat(found.price);
        item.extras = check.lines;
        delete item.box;
        delete item.size;
        delete item.menue;
        delete item.sauce;
        delete item.sauces;
      } else if (item.box) {
        return res.status(400).json({ success: false, message: 'Ungültige Box für: ' + item.name });
      } else if (item.deal && item.deal.slug === DEAL_SLUG) {
        // Mittag Deal: Konfiguration serverseitig prüfen (alles inklusive, Preis fix)
        const found = await db.get('SELECT id, price FROM products WHERE id = $1 AND slug = $2', [item.id, item.deal.slug]);
        if (!found) {
          return res.status(400).json({ success: false, message: 'Produkt nicht gefunden: ' + item.name });
        }
        const check = validateDeal(item.deal.choices, dealLists);
        if (!check.ok) {
          return res.status(400).json({ success: false, message: check.error + ' (' + item.name + ')' });
        }
        realPrice = parseFloat(found.price);
        item.extras = check.lines;
        delete item.deal;
        delete item.size;
        delete item.menue;
        delete item.sauce;
        delete item.sauces;
        delete item.chocos;
      } else if (item.deal) {
        return res.status(400).json({ success: false, message: 'Ungültiger Deal für: ' + item.name });
      } else if (item.size && product.sizes) {
        const sizes = JSON.parse(product.sizes);
        const matchedSize = sizes.find(s => s.label === item.size.label && parseFloat(s.price) === parseFloat(item.size.price));
        if (!matchedSize) {
          return res.status(400).json({ success: false, message: 'Ungültige Größe für: ' + item.name });
        }
        realPrice = parseFloat(matchedSize.price);
        // Extras & Beläge (Pizza): serverseitig gegen Preisliste prüfen
        try {
          const { extras, total } = validateExtras(item.size.label, item.extras);
          item.extras = extras;
          realPrice = parseFloat((realPrice + total).toFixed(2));
        } catch (e) {
          return res.status(400).json({ success: false, message: 'Ungültige Extras für: ' + item.name });
        }
        // Snacks-Menü (+4 € mit Softdrink): nur für Snacks, Drink aus fester Liste
        if (item.menue && item.menue.drink) {
          const menueDrinks = ['Coca-Cola', 'Fanta', 'Sprite', 'Mezzo Mix', 'Coca-Cola Zero'];
          if (product.catslug !== 'snacks' || !menueDrinks.includes(item.menue.drink)) {
            return res.status(400).json({ success: false, message: 'Ungültiges Menü für: ' + item.name });
          }
          item.extras.push({ name: 'Menü mit ' + item.menue.drink, price: 4.00 });
          realPrice = parseFloat((realPrice + 4).toFixed(2));
          delete item.menue;
        } else {
          delete item.menue;
        }
        // Gratis-Sauce (Rings, Pizza Brötchen): Name gegen Saucen-Liste prüfen, Preis 0
        if (typeof item.sauce === 'string' && item.sauce) {
          if ((product.catslug !== 'rings' && product.catslug !== 'pizza-broetchen') || !validSauces.includes(item.sauce)) {
            return res.status(400).json({ success: false, message: 'Ungültige Sauce für: ' + item.name });
          }
          item.extras.push({ name: 'Sauce: ' + item.sauce, price: 0 });
          delete item.sauce;
        } else {
          delete item.sauce;
        }
        // Bowls-Saucen: 1× inklusive, jede weitere +0,80 €
        const BOWL_SAUCES = ['NEXO Haussoße', 'Knoblauchsoße', 'BBQ-Soße', 'American-Soße', 'Cheddar-Soße'];
        if (item.sauces && item.sauces.length) {
          if (product.catslug !== 'bowls') {
            return res.status(400).json({ success: false, message: 'Ungültige Saucen für: ' + item.name });
          }
          const clean = [...new Set(item.sauces)].filter(s => BOWL_SAUCES.includes(s));
          if (!clean.length) {
            delete item.sauces;
          } else {
            clean.forEach((sn, si) => item.extras.push({ name: 'Sauce: ' + sn, price: si === 0 ? 0 : 0.80 }));
            realPrice = parseFloat((realPrice + 0.80 * (clean.length - 1)).toFixed(2));
            item.sauces = clean;
          }
        } else {
          delete item.sauces;
        }
        // Schoko-Box Dessert: genau 2 Pflicht (inklusive), nur Dessert
        if (item.chocos && item.chocos.length) {
          if (product.catslug !== 'dessert') {
            return res.status(400).json({ success: false, message: 'Ungültige Schoko-Auswahl für: ' + item.name });
          }
          const cleanChoc = [...new Set(item.chocos)].filter(s => CHOCO_LIST.includes(s));
          if (cleanChoc.length !== 2) {
            return res.status(400).json({ success: false, message: 'Bitte 2 Schoko-Sorten wählen (' + item.name + ')' });
          }
          cleanChoc.forEach(sn => item.extras.push({ name: 'Schoko: ' + sn, price: 0 }));
          item.chocos = cleanChoc;
        } else {
          delete item.chocos;
        }
      } else {
        realPrice = parseFloat(product.price);
        delete item.extras;
        delete item.menue;
        // Gratis-Sauce auch ohne Größe möglich (Rings)
        if (typeof item.sauce === 'string' && item.sauce) {
          if ((product.catslug !== 'rings' && product.catslug !== 'pizza-broetchen') || !validSauces.includes(item.sauce)) {
            return res.status(400).json({ success: false, message: 'Ungültige Sauce für: ' + item.name });
          }
          item.extras = [{ name: 'Sauce: ' + item.sauce, price: 0 }];
          delete item.sauce;
        } else {
          delete item.sauce;
        }
        delete item.sauces;
        // Schoko-Box Dessert: genau 2 Pflicht (inklusive), nur Dessert
        if (item.chocos && item.chocos.length) {
          if (product.catslug !== 'dessert') {
            return res.status(400).json({ success: false, message: 'Ungültige Schoko-Auswahl für: ' + item.name });
          }
          const cleanChoc2 = [...new Set(item.chocos)].filter(s => CHOCO_LIST.includes(s));
          if (cleanChoc2.length !== 2) {
            return res.status(400).json({ success: false, message: 'Bitte 2 Schoko-Sorten wählen (' + item.name + ')' });
          }
          item.extras = cleanChoc2.map(sn => ({ name: 'Schoko: ' + sn, price: 0 }));
          item.chocos = cleanChoc2;
        } else {
          delete item.chocos;
        }
      }
      // Notiz pro Position (aus der Kasse), max. 200 Zeichen
      if (typeof item.note === 'string' && item.note.trim()) {
        item.note = item.note.trim().slice(0, 200);
      } else {
        delete item.note;
      }
      const qty = Math.max(1, Math.min(20, parseInt(item.qty) || 1));
      item.price = realPrice;
      item.qty = qty;
      calculatedSubtotal += realPrice * qty;
      // MwSt-Basis je Satz sammeln (Getränke 19 %, alles andere inkl. Milkshakes 7 %)
      if (product.catslug === 'getraenke') gross19 += realPrice * qty;
      else gross7 += realPrice * qty;
    }
    
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
    else if (zone) calculatedDelivery = zone.fee;
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
    gross7 += calculatedDelivery;
    const grossAll = gross7 + gross19;
    let base7 = gross7, base19 = gross19;
    if (calculatedDiscount > 0 && grossAll > 0) {
      base7 = Math.max(0, gross7 - calculatedDiscount * gross7 / grossAll);
      base19 = Math.max(0, gross19 - calculatedDiscount * gross19 / grossAll);
    }
    const vat7 = Math.round((base7 - base7 / 1.07) * 100) / 100;
    const vat19 = Math.round((base19 - base19 / 1.19) * 100) / 100;

    const orderNumber = 'FEIN-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    // Online-Zahlung: Bestellung parken (kein Druck/Ton), erst Webhook gibt sie frei
    const isOnline = payment === 'online';
    const ins = await db.run(`INSERT INTO orders (order_number, customer_name, customer_email, customer_phone, delivery_address, delivery_city, delivery_zip, notes, items, subtotal, delivery_fee, discount, discount_code, total, payment_method, payment_status, order_status, order_type, vat7, vat19)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id`,
      [orderNumber, name, email, phone, address, city, zip, notes,
      JSON.stringify(parsedItems), calculatedSubtotal, calculatedDelivery, calculatedDiscount, validCode, calculatedTotal,
      payment, isOnline ? 'ausstehend' : 'bar', isOnline ? 'wartet_auf_zahlung' : 'neu', type, vat7, vat19]
    );
    const orderId = ins.rows && ins.rows[0] ? ins.rows[0].id : null;

    if (validCode) {
      await db.run('UPDATE discounts SET used_count = used_count + 1 WHERE code = $1', [validCode]);
    }

    if (isOnline) {
      try {
        const { createCheckoutSession } = require('./stripe');
        const session = await createCheckoutSession(
          { id: orderId, order_number: orderNumber, total: calculatedTotal, customer_email: email, items: parsedItems }, req
        );
        return res.json({ success: true, orderNumber, stripeUrl: session.url, message: 'Weiter zur Zahlung' });
      } catch (err) {
        console.error('Stripe-Session Fehler:', err.message);
        if (orderId) await db.run("UPDATE orders SET order_status = 'storniert' WHERE id = $1", [orderId]);
        return res.status(500).json({ success: false, message: 'Online-Zahlung derzeit nicht möglich – bitte Barzahlung wählen.' });
      }
    }

    res.json({ success: true, orderNumber, message: 'Bestellung erfolgreich aufgegeben!' });
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
  
  const settings = res.locals.settings;
  
  res.render('order-confirmation', {
    title: 'Bestellung ' + order.order_number + ' – ' + settings.site_name,
    order,
    settings
  });
});

module.exports = router;
