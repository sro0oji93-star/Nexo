// Gemeinsame Bestellpreis-Logik für Kunden-Kasse (/bestellung) und Theken-Kasse (/admin/kasse).
// MECHANISCH aus routes/order.js extrahiert (keine Logikänderung):
//  - priceItems(parsedItems): prüft + bepreist Positionen, wirft { status, message } statt res.json.
//  - splitVat(gross7, gross19, discount): MwSt-Split 7 %/19 % (Liefergebühr folgt 7 %).
// Aufrufer übergeben bereits geparste Items; das zurückgegebene items-Array ist
// dasselbe (in-place bereinigt: echte Preise, qty clamp, Server-Extras).
const db = require('./db');
const { validateBox, BOX_SLUGS, validateDeal, DEAL_SLUG, validatePasta, PASTA_WUNSCH_SLUG } = require('./boxen');
const { validateExtras, TOPPINGS } = require('./extras');

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

// Wert des im Menü/Deal enthaltenen Softdrinks (0,33 l = 3,50 €). Dieser Anteil
// unterliegt 19 % MwSt (Getränk), der Rest der Speisen 7 %.
const BEVERAGE_19 = 3.50;

function fail(message) {
  throw { status: 400, message };
}

async function priceItems(parsedItems) {
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
  // Listen für NEXO Box-Konfiguration – einmal laden
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
      toppings: TOPPINGS,
      'pizza-broetchen': await boxNames('pizza-broetchen')
    };
  }
  for (const item of parsedItems) {
    const product = await db.get('SELECT p.id, p.slug, p.price, p.sizes, p.is_available, c.slug AS catslug FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = $1', [item.id]);
    if (!product) {
      fail('Produkt nicht gefunden: ' + item.name);
    }
    if (!product.is_available) {
      fail('Zurzeit ausverkauft: ' + item.name + ' – bitte aus dem Warenkorb entfernen.');
    }
    if (product.slug === 'nexo-night-deal' || product.slug === 'deal-night-abholung') hasPickupOnlyDeal = true;
    // Tageszeit-Angebote serverseitig prüfen (Client-Zeit kann manipuliert sein)
    const rule = TIME_DEALS[product.slug];
    if (rule && (nowBerlinMin < rule.from || nowBerlinMin >= rule.to)) {
      fail(rule.message);
    }
    let realPrice;
    // Getränkeanteil im Menü/Deal (19 % MwSt) – wird pro Position gesetzt
    let beveragePart = 0;
    // NEXO Box: Konfiguration serverseitig prüfen (alles inklusive, Preis fix)
    if (item.box && item.box.slug && BOX_SLUGS.includes(item.box.slug)) {
      const found = await db.get('SELECT id, price FROM products WHERE id = $1 AND slug = $2', [item.id, item.box.slug]);
      if (!found) {
        fail('Produkt nicht gefunden: ' + item.name);
      }
      const check = validateBox(item.box.slug, item.box.choices, boxLists);
      if (!check.ok) {
        fail(check.error + ' (' + item.name + ')');
      }
      realPrice = parseFloat(found.price);
      item.extras = check.lines;
      delete item.box;
      delete item.size;
      delete item.menue;
      delete item.sauce;
      delete item.sauces;
    } else if (item.box) {
      fail('Ungültige Box für: ' + item.name);
    } else if (item.deal && item.deal.slug === DEAL_SLUG) {
      // Mittag Deal: Konfiguration serverseitig prüfen (alles inklusive, Preis fix)
      const found = await db.get('SELECT id, price FROM products WHERE id = $1 AND slug = $2', [item.id, item.deal.slug]);
      if (!found) {
        fail('Produkt nicht gefunden: ' + item.name);
      }
      const check = validateDeal(item.deal.choices, dealLists);
      if (!check.ok) {
        fail(check.error + ' (' + item.name + ')');
      }
      realPrice = parseFloat(found.price);
      item.extras = check.lines;
      // Deal enthält ein Getränk 0,33 l -> 19 %-Anteil abtrennen (nur wenn Dealpreis den Wert deckt)
      beveragePart = Math.min(BEVERAGE_19, realPrice);
      delete item.deal;
      delete item.size;
      delete item.menue;
      delete item.sauce;
      delete item.sauces;
      delete item.chocos;
    } else if (item.deal) {
      fail('Ungültiger Deal für: ' + item.name);
    } else if (item.size && product.sizes) {
      const sizes = JSON.parse(product.sizes);
      const matchedSize = sizes.find(s => s.label === item.size.label && parseFloat(s.price) === parseFloat(item.size.price));
      if (!matchedSize) {
        fail('Ungültige Größe für: ' + item.name);
      }
      realPrice = parseFloat(matchedSize.price);
      // Extras & Beläge (Pizza): serverseitig gegen Preisliste prüfen.
      // Nur NEXO Wunsch: erste 3 Beläge gratis (alle anderen Pizzen: alles kostenpflichtig).
      try {
        const validated = validateExtras(item.size.label, item.extras, { wunsch: product.slug === 'nexo-wunsch' });
        item.extras = validated.extras;
        realPrice = parseFloat((realPrice + validated.total).toFixed(2));
      } catch (e) {
        fail('Ungültige Extras für: ' + item.name);
      }
      // Menü-Aufpreise mit Softdrink: Snacks (+4 €) und Burger (+5 €, per catsslug 'burger').
      // Der Getränkanteil (0,33 l = 3,50 €) unterliegt 19 % MwSt, der Rest 7 %.
      if (item.menue && item.menue.drink) {
        const menueDrinks = ['Coca-Cola', 'Fanta', 'Sprite', 'Mezzo Mix', 'Coca-Cola Zero'];
        const isSnacksMenue = product.catslug === 'snacks' && menueDrinks.includes(item.menue.drink);
        // Burger-Menü: Client sendet { drink: true }; catsslug muss 'burger' sein
        const isBurgerMenue = product.catslug === 'burger' && item.menue.drink === true;
        if (!isSnacksMenue && !isBurgerMenue) {
          fail('Ungültiges Menü für: ' + item.name);
        }
        if (isSnacksMenue) {
          item.extras.push({ name: 'Menü mit ' + item.menue.drink, price: 4.00 });
          realPrice = parseFloat((realPrice + 4).toFixed(2));
        } else {
          item.extras.push({ name: 'Menü mit Pommes + Softdrink', price: 0 });
        }
        beveragePart = Math.min(BEVERAGE_19, realPrice);
        delete item.menue;
      } else {
        delete item.menue;
      }
      // Gratis-Sauce (Rings, Pizza Brötchen): Name gegen Saucen-Liste prüfen, Preis 0
      if (typeof item.sauce === 'string' && item.sauce) {
        if ((product.catslug !== 'rings' && product.catslug !== 'pizza-broetchen') || !validSauces.includes(item.sauce)) {
          fail('Ungültige Sauce für: ' + item.name);
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
          fail('Ungültige Saucen für: ' + item.name);
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
          fail('Ungültige Schoko-Auswahl für: ' + item.name);
        }
        const cleanChoc = [...new Set(item.chocos)].filter(s => CHOCO_LIST.includes(s));
        if (cleanChoc.length !== 2) {
          fail('Bitte 2 Schoko-Sorten wählen (' + item.name + ')');
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
          fail('Ungültige Sauce für: ' + item.name);
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
          fail('Ungültige Schoko-Auswahl für: ' + item.name);
        }
        const cleanChoc2 = [...new Set(item.chocos)].filter(s => CHOCO_LIST.includes(s));
        if (cleanChoc2.length !== 2) {
          fail('Bitte 2 Schoko-Sorten wählen (' + item.name + ')');
        }
        item.extras = cleanChoc2.map(sn => ({ name: 'Schoko: ' + sn, price: 0 }));
        item.chocos = cleanChoc2;
      } else {
        delete item.chocos;
      }
    }
    // Pasta: Nudelsorte Pflicht (+ Sauce bei NEXO Wunsch), alles inklusive
    if (product.catslug === 'pasta') {
      const needSauce = product.slug === PASTA_WUNSCH_SLUG;
      const check = validatePasta(item.pasta, needSauce);
      if (!check.ok) {
        fail(check.error + ' (' + item.name + ')');
      }
      item.extras = check.lines;
      delete item.pasta;
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
    // MwSt-Basis je Satz sammeln (Getränke 19 %, alles andere inkl. Milkshakes 7 %).
    // beveragePart (z.B. 3,50 € Softdrink im Menü/Deal) zählt zu 19 %.
    if (product.catslug === 'getraenke') {
      gross19 += realPrice * qty;
    } else {
      gross19 += beveragePart * qty;
      gross7 += (realPrice - beveragePart) * qty;
    }
  }
  return { items: parsedItems, subtotal: calculatedSubtotal, gross7, gross19, hasPickupOnlyDeal };
}

// MwSt je Satz aus Bruttototalen (Liefergebühr folgt 7 %, Rabatt anteilig je Satz).
// Aufrufer addiert die Liefergebühr VORHER zu gross7 (wie bisher: gross7 += delivery).
function splitVat(gross7, gross19, discount) {
  const grossAll = gross7 + gross19;
  let base7 = gross7, base19 = gross19;
  if (discount > 0 && grossAll > 0) {
    base7 = Math.max(0, gross7 - discount * gross7 / grossAll);
    base19 = Math.max(0, gross19 - discount * gross19 / grossAll);
  }
  const vat7 = Math.round((base7 - base7 / 1.07) * 100) / 100;
  const vat19 = Math.round((base19 - base19 / 1.19) * 100) / 100;
  return { vat7, vat19 };
}

module.exports = { priceItems, splitVat, berlinMinutes, TIME_DEALS, BEVERAGE_19 };
