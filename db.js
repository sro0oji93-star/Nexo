const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

types.setTypeParser(1700, parseFloat);
types.setTypeParser(20, parseInt);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ammaya',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

async function get(text, params) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

async function all(text, params) {
  const result = await query(text, params);
  return result.rows;
}

async function run(text, params) {
  const result = await query(text, params);
  return result;
}

// Hero als Single Source für Anzeige-Preise (nur deal-Produkte):
// Übernimmt price1/price2 (+cents, +tag) eines Hero-Slides in sizes+price des verlinkten Deal-Produkts.
// Wird beim Speichern im Admin sowie beim Serverstart aufgerufen. Ungültige Preise -> kein Update.
function parseHeroPrice(intPart, centsPart) {
  const raw = String(intPart || '') + String(centsPart || '');
  if (!raw.trim()) return null;
  let s = raw.replace(/[^\d,\.]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(s);
  return (isFinite(v) && v > 0) ? Math.round(v * 100) / 100 : null;
}

function heroTagLabel(tag, fallback) {
  const t = String(tag || '').trim();
  if (!t) return fallback;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

async function syncDealPricesFromSlide(slide) {
  if (!slide || !slide.button_link) return false;
  const m = String(slide.button_link).match(/\?add=([A-Za-z0-9_-]+)/);
  if (!m || m[1].indexOf('deal-') !== 0) return false;
  const sizes = [];
  const p1 = parseHeroPrice(slide.price1, slide.price1_cents);
  if (p1) sizes.push({ label: heroTagLabel(slide.price1_tag, 'Abholung'), price: p1 });
  const p2 = parseHeroPrice(slide.price2, slide.price2_cents);
  if (p2) sizes.push({ label: heroTagLabel(slide.price2_tag, 'Lieferung'), price: p2 });
  if (sizes.length === 0) return false;
  const min = Math.min.apply(null, sizes.map(function (s) { return s.price; }));
  const r = await query('UPDATE products SET sizes = $1, price = $2 WHERE slug = $3', [JSON.stringify(sizes), min, m[1]]);
  return r.rowCount > 0;
}

async function initialize() {
  await query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      image TEXT,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      price NUMERIC(10,2) NOT NULL,
      old_price NUMERIC(10,2),
      image TEXT,
      ingredients TEXT,
      is_featured INTEGER DEFAULT 0,
      is_available INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT,
      delivery_address TEXT,
      delivery_city TEXT,
      delivery_zip TEXT,
      notes TEXT,
      items TEXT NOT NULL,
      subtotal NUMERIC(10,2) NOT NULL,
      delivery_fee NUMERIC(10,2) DEFAULT 0,
      discount NUMERIC(10,2) DEFAULT 0,
      discount_code TEXT,
      total NUMERIC(10,2) NOT NULL,
      payment_method TEXT DEFAULT 'bar',
      payment_status TEXT DEFAULT 'pending',
      order_status TEXT DEFAULT 'neu',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS discounts (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE,
      type TEXT NOT NULL DEFAULT 'prozent',
      value NUMERIC(10,2) NOT NULL,
      min_order NUMERIC(10,2) DEFAULT 0,
      active INTEGER DEFAULT 1,
      expires_at TIMESTAMP,
      usage_limit INTEGER DEFAULT 0,
      used_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS banners (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT,
      image TEXT,
      link TEXT,
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS testimonials (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      text TEXT NOT NULL,
      image TEXT,
      rating INTEGER DEFAULT 5,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contact_messages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hero_slides (
      id SERIAL PRIMARY KEY,
      sort_order INTEGER DEFAULT 0,
      line1 TEXT DEFAULT '1 GROSSE',
      line2 TEXT DEFAULT 'PIZZA',
      line3 TEXT DEFAULT '+ 4 GETRÄNKE',
      price1 TEXT DEFAULT '19',
      price1_cents TEXT DEFAULT ',99€',
      price1_tag TEXT DEFAULT 'ABHOLUNG',
      price2 TEXT DEFAULT '21',
      price2_cents TEXT DEFAULT ',99€',
      price2_tag TEXT DEFAULT 'LIEFERUNG',
      description TEXT DEFAULT '',
      button_text TEXT DEFAULT 'JETZT BESTELLEN',
      button_link TEXT DEFAULT '/warenkorb',
      bg_image TEXT DEFAULT '/images/revolution/6cbea-bg1.jpg',
      main_image TEXT DEFAULT '/images/revolution/75ec1-big1.png',
      drink_tl TEXT DEFAULT '/images/revolution/f13af-big3.png',
      drink_tr TEXT DEFAULT '/images/revolution/d70da-big4.png',
      drink_br TEXT DEFAULT '/images/revolution/96fdd-big6.png',
      active INTEGER DEFAULT 1
    );

    ALTER TABLE products ADD COLUMN IF NOT EXISTS sizes TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'lieferung';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS printed INTEGER DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS printed_at TIMESTAMP;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat7 NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat19 NUMERIC(10,2) DEFAULT 0;

    CREATE TABLE IF NOT EXISTS visitor_days (
      day TEXT NOT NULL,
      vhash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (day, vhash)
    );
  `);

  // Slug-Reparatur: Admin-Edits haben Box-/Deal-Slugs angehängt ("box-2-45").
  // Box-/Deal-Logik hängt am exakten Slug -> kanonischen Slug wiederherstellen.
  try {
    const canonSlugs = ['box-1', 'box-2', 'box-3', 'mix-milkshake',
      'nexo-mittag-deal', 'nexo-night-deal', 'deal-night-abholung',
      'deal-grosse-pizza-getraenke', 'deal-mix-match', 'deal-grosse-hamburger-getraenk',
      'crepe-nutella', 'crepe-frucht', 'crepe-lotus', 'crepe-oreo', 'crepe-bueno',
      'mini-pancakes', 'mini-waffel'];
    for (const cs of canonSlugs) {
      await query(
        "UPDATE products SET slug = $1 WHERE slug ~ ('^' || $1 || '-[0-9]+$') AND NOT EXISTS (SELECT 1 FROM products WHERE slug = $1)",
        [cs]
      );
    }
  } catch (e) {
    console.error('Slug-Reparatur übersprungen:', e.message);
  }

  const hash = bcrypt.hashSync('admin123', 10);
  await query(
    'INSERT INTO admins (username, password, display_name) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
    ['admin', hash, 'Admin']
  );

  // Notfall-Reset per ENV (für Free-Plan ohne Shell-Zugang):
  // In Render unter Environment ADMIN_RESET_PASSWORD setzen -> nach Deploy ist das Passwort aktiv -> danach Variable wieder löschen.
  const resetUser = process.env.ADMIN_RESET_USER || 'admin';
  const resetPass = process.env.ADMIN_RESET_PASSWORD;
  if (resetPass && resetPass.length >= 6) {
    const resetHash = bcrypt.hashSync(resetPass, 10);
    const upd = await query('UPDATE admins SET password = $1 WHERE username = $2', [resetHash, resetUser]);
    if (upd.rowCount > 0) console.log('Admin-Passwort per ENV zurückgesetzt für: ' + resetUser);
    else console.log('ADMIN_RESET_PASSWORD ignoriert: Benutzer "' + resetUser + '" nicht gefunden.');
  }

  const catCount = (await get('SELECT COUNT(*) as count FROM categories')).count;
  if (catCount === 0) {
    const categories = [
      ['Pizza', 'pizza', 'Steinofenpizza in 4 Größen: 26 cm, 30 cm, Familien Pizza und Party. Alle Pizzen in 26 cm und 30 cm auch als Calzone erhältlich.', 1],
      ['Burger', 'burger', 'Smash Burger frisch für dich gesmasht. Als Menü (+5,00 €) mit Pommes und 0,33 l Softdrink nach Wahl.', 2],
      ['Croque', 'croque', 'Frisch überbackene Croques. Inklusive 1 Sauce nach Wahl.', 3],
      ['Salat', 'salat', 'Frische Salate mit Dressing nach Wahl: Knoblauch, Hausdressing, Yoghurt, American, Kräuter.', 4],
      ['Pasta', 'pasta', 'Italienische Pastagerichte, traditionell und kreativ', 5],
      ['Schnitzel', 'schnitzel', 'Inklusive Pommes oder Kroketten.', 6],
      ['Snacks', 'snacks', 'Menü-Aufpreis +4,00 €: mit Pommes und 0,33 l Softdrink nach Wahl.', 7],
      ['Getränke', 'getraenke', 'Erfrischende Getränke und Erfrischungen', 8],
      ['Snack Rolls', 'snack-rolls', 'Herzhafte gefüllte Rollen, perfekt zum Teilen', 9],
      ['Saucen & Dips', 'saucen-dips', 'Alle Saucen je 2,00 €.', 10],
      ['Dessert', 'dessert', 'Süße Klassiker, Crêpes, Mini Pancakes & Mini Waffeln. Alle Crêpes inklusive 2 Schokoladensorten nach Wahl.', 11],
      ['Beilagen', 'beilagen', 'Knusprige Beilagen für jeden Geschmack.', 12],
      ['Fries', 'fries', 'Knusprige Fries für jeden Geschmack.', 13],
      ['NEXO Box', 'nexo-box', 'Gemeinsam genießen & sparen.', 14],
      ['Kids Menü', 'kids-menue', 'Bei allen Kids-Menüs inklusive: Capri-Sun, Überraschungsei.', 15],
      ['Milkshake', 'milkshake', 'Frisch gemixte Milkshakes.', 16],
      ['Rings', 'rings', 'Inklusive 1 Sauce nach Wahl.', 17],
      ['Wraps', 'wraps', 'Frisch gerollte Wraps mit knackigem Salat.', 18],
      ['Bowls', 'bowls', 'Beilage nach Wahl: Reis oder Pommes. 1 Sauce inklusive, jede weitere +0,80 €.', 19],
      ['Pizza Brötchen', 'pizza-broetchen', '6 oder 12 Stück. Inklusive 1 Sauce nach Wahl.', 20],
      ['NEXO Deals', 'nexo-deals', 'Tageszeit-Angebote: Mittag Deal 12–15 Uhr · Night Deal ab 21:00 Uhr (nur Abholer).', 21],
    ];
    for (const c of categories) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        c
      );
    }
  }

  const prodCount = (await get('SELECT COUNT(*) as count FROM products')).count;
  if (prodCount === 0) {
    const products = [
      [1, 'Margherita', 'margherita', 'Tomatensauce, Oregano', 8.90, null, 'Tomatensauce, Oregano', 1, 1, '[{"label":"26 cm","price":8.9},{"label":"30 cm","price":11.5},{"label":"Familien Pizza","price":19.9},{"label":"Party 60x40","price":27.1}]'],
      [1, 'Mozzarella', 'mozzarella', 'Tomatensauce, Mozzarella, frische Tomaten, Basilikum, Oregano', 10.90, null, 'Tomatensauce, Mozzarella, frische Tomaten, Basilikum, Oregano', 0, 2, '[{"label":"26 cm","price":10.9},{"label":"30 cm","price":13.5},{"label":"Familien Pizza","price":22.9},{"label":"Party 60x40","price":31.9}]'],
      [1, 'Cheese', 'cheese', 'Tomatensauce, verschiedene Käsesorten, Oregano', 10.90, null, 'Tomatensauce, verschiedene Käsesorten, Oregano', 0, 3, '[{"label":"26 cm","price":10.9},{"label":"30 cm","price":13.5},{"label":"Familien Pizza","price":22.9},{"label":"Party 60x40","price":31.9}]'],
      [1, 'Salami', 'salami', 'Tomatensauce, Salami, Oregano', 10.20, null, 'Tomatensauce, Salami, Oregano', 1, 4, '[{"label":"26 cm","price":10.2},{"label":"30 cm","price":12.5},{"label":"Familien Pizza","price":21.5},{"label":"Party 60x40","price":30.5}]'],
      [1, 'Prosciutto', 'prosciutto', 'Tomatensauce, Schinken, Oregano', 10.20, null, 'Tomatensauce, Schinken, Oregano', 0, 5, '[{"label":"26 cm","price":10.2},{"label":"30 cm","price":12.5},{"label":"Familien Pizza","price":21.5},{"label":"Party 60x40","price":30.5}]'],
      [1, 'Funghi', 'funghi', 'Tomatensauce, Champignons, Oregano', 10.20, null, 'Tomatensauce, Champignons, Oregano', 0, 6, '[{"label":"26 cm","price":10.2},{"label":"30 cm","price":12.5},{"label":"Familien Pizza","price":21.5},{"label":"Party 60x40","price":30.5}]'],
      [1, 'Dreiklang', 'dreiklang', 'Tomatensauce, Salami, Schinken, Champignons, Oregano', 12.40, null, 'Tomatensauce, Salami, Schinken, Champignons, Oregano', 1, 7, '[{"label":"26 cm","price":12.4},{"label":"30 cm","price":14.9},{"label":"Familien Pizza","price":23.9},{"label":"Party 60x40","price":33.5}]'],
      [1, 'Hawaii', 'hawaii', 'Tomatensauce, Schinken, Ananas, Oregano', 12.20, null, 'Tomatensauce, Schinken, Ananas, Oregano', 0, 8, '[{"label":"26 cm","price":12.2},{"label":"30 cm","price":14.5},{"label":"Familien Pizza","price":23.5},{"label":"Party 60x40","price":33}]'],
      [1, 'Vegetarisch', 'vegetarisch', 'Tomatensauce, verschiedene Gemüsesorten, Oregano', 12.20, null, 'Tomatensauce, verschiedene Gemüsesorten, Oregano', 0, 9, '[{"label":"26 cm","price":12.2},{"label":"30 cm","price":14.5},{"label":"Familien Pizza","price":23.5},{"label":"Party 60x40","price":33}]'],
      [1, 'Tonno', 'tonno', 'Tomatensauce, Thunfisch, rote Zwiebeln, Oregano', 12.60, null, 'Tomatensauce, Thunfisch, rote Zwiebeln, Oregano', 0, 10, '[{"label":"26 cm","price":12.6},{"label":"30 cm","price":14.9},{"label":"Familien Pizza","price":24},{"label":"Party 60x40","price":33.5}]'],
      [1, 'Scampi', 'scampi', 'Tomatensauce, Scampi, Oregano', 14.20, null, 'Tomatensauce, Scampi, Oregano', 0, 11, '[{"label":"26 cm","price":14.2},{"label":"30 cm","price":16.5},{"label":"Familien Pizza","price":25.5},{"label":"Party 60x40","price":35.9}]'],
      [1, 'Frutti di Mare', 'frutti-di-mare', 'Tomatensauce, Frutti di Mare, Oregano', 14.20, null, 'Tomatensauce, Frutti di Mare, Oregano', 0, 12, '[{"label":"26 cm","price":14.2},{"label":"30 cm","price":16.5},{"label":"Familien Pizza","price":25.5},{"label":"Party 60x40","price":35.9}]'],
      [1, 'Spezial Chicken', 'spezial-chicken', 'Tomatensauce, Hähnchen, Paprika, rote Zwiebeln, Champignons, Oregano', 13.40, null, 'Tomatensauce, Hähnchen, Paprika, rote Zwiebeln, Champignons, Oregano', 1, 13, '[{"label":"26 cm","price":13.4},{"label":"30 cm","price":15.9},{"label":"Familien Pizza","price":24.9},{"label":"Party 60x40","price":34.9}]'],
      [1, 'Chicken Hollandaise', 'chicken-hollandaise', 'Tomatensauce, Hähnchen, Brokkoli, Sauce Hollandaise, Oregano', 13.40, null, 'Tomatensauce, Hähnchen, Brokkoli, Sauce Hollandaise, Oregano', 0, 14, '[{"label":"26 cm","price":13.4},{"label":"30 cm","price":15.9},{"label":"Familien Pizza","price":24.9},{"label":"Party 60x40","price":34.9}]'],
      [1, 'Chicken Curry', 'chicken-curry', 'Tomatensauce, Hähnchen, Ananas, Curry, Oregano', 13.20, null, 'Tomatensauce, Hähnchen, Ananas, Curry, Oregano', 0, 15, '[{"label":"26 cm","price":13.2},{"label":"30 cm","price":15.5},{"label":"Familien Pizza","price":24.5},{"label":"Party 60x40","price":34.5}]'],
      [1, 'Chicken Beef', 'chicken-beef', 'Tomatensauce, Hähnchen, Hackfleisch, Hirtenkäse, Oregano', 14.20, null, 'Tomatensauce, Hähnchen, Hackfleisch, Hirtenkäse, Oregano', 0, 16, '[{"label":"26 cm","price":14.2},{"label":"30 cm","price":16.5},{"label":"Familien Pizza","price":25.5},{"label":"Party 60x40","price":35.9}]'],
      [1, 'BBQ', 'bbq', 'Tomatensauce, Salami, Hackfleisch, BBQ-Sauce, Röstzwiebeln, Oregano', 13.90, null, 'Tomatensauce, Salami, Hackfleisch, BBQ-Sauce, Röstzwiebeln, Oregano', 1, 17, '[{"label":"26 cm","price":13.9},{"label":"30 cm","price":16.2},{"label":"Familien Pizza","price":25.2},{"label":"Party 60x40","price":35.5}]'],
      [1, 'Hot Beef', 'hot-beef', 'Tomatensauce, Hackfleisch, Paprika, Jalapeños, Oregano', 13.60, null, 'Tomatensauce, Hackfleisch, Paprika, Jalapeños, Oregano', 0, 18, '[{"label":"26 cm","price":13.6},{"label":"30 cm","price":15.9},{"label":"Familien Pizza","price":24.9},{"label":"Party 60x40","price":34.9}]'],
      [1, 'Sucuk', 'sucuk', 'Tomatensauce, Sucuk, Peperoni, Ei, Oregano', 13.60, null, 'Tomatensauce, Sucuk, Peperoni, Ei, Oregano', 0, 19, '[{"label":"26 cm","price":13.6},{"label":"30 cm","price":15.9},{"label":"Familien Pizza","price":24.9},{"label":"Party 60x40","price":34.9}]'],
      [1, 'Bacon', 'bacon', 'Tomatensauce, Rinderhackfleisch, BBQ-Sauce, Mozzarella, Bacon, Oregano', 14.20, null, 'Tomatensauce, Rinderhackfleisch, BBQ-Sauce, Mozzarella, Bacon, Oregano', 0, 20, '[{"label":"26 cm","price":14.2},{"label":"30 cm","price":16.5},{"label":"Familien Pizza","price":25.5},{"label":"Party 60x40","price":35.9}]'],
      [1, 'Sucuk Jalapeños', 'sucuk-jalapenos', 'Tomatensauce, Sucuk, Jalapeños, Ei, Oregano', 13.60, null, 'Tomatensauce, Sucuk, Jalapeños, Ei, Oregano', 0, 21, '[{"label":"26 cm","price":13.6},{"label":"30 cm","price":15.9},{"label":"Familien Pizza","price":24.9},{"label":"Party 60x40","price":34.9}]'],
      [1, 'Meat Lovers', 'meat-lovers', 'Tomatensauce, Salami, Schinken, Sucuk, Rinderhackfleisch, Oregano', 14.90, null, 'Tomatensauce, Salami, Schinken, Sucuk, Rinderhackfleisch, Oregano', 1, 22, '[{"label":"26 cm","price":14.9},{"label":"30 cm","price":17.2},{"label":"Familien Pizza","price":26.2},{"label":"Party 60x40","price":36.9}]'],
      [1, 'Hot Dog', 'hot-dog', 'Tomatensauce, Würstchen, Gewürzgurken, Röstzwiebeln, Oregano', 13.20, null, 'Tomatensauce, Würstchen, Gewürzgurken, Röstzwiebeln, Oregano', 0, 23, '[{"label":"26 cm","price":13.2},{"label":"30 cm","price":15.5},{"label":"Familien Pizza","price":24.5},{"label":"Party 60x40","price":34.5}]'],
      [1, 'UFO', 'ufo', 'Tomatensauce, von allem etwas, doppelter Teig, Oregano', 15.20, null, 'Tomatensauce, von allem etwas, doppelter Teig, Oregano', 0, 24, '[{"label":"26 cm","price":15.2},{"label":"30 cm","price":17.5},{"label":"Familien Pizza","price":26.9},{"label":"Party 60x40","price":37.9}]'],
      [1, 'NEXO Wunsch', 'nexo-wunsch', 'Tomatensauce, drei Zutaten nach Wahl, Oregano', 13.60, null, 'Tomatensauce, drei Zutaten nach Wahl, Oregano', 0, 25, '[{"label":"26 cm","price":13.6},{"label":"30 cm","price":15.9},{"label":"Familien Pizza","price":24.9},{"label":"Party 60x40","price":34.9}]'],
      [1, 'NEXO X', 'nexo-x', 'Hollandaise, Crispy Chicken, Mais, Paprika, Knoblauchsauce', 14.20, null, 'Hollandaise, Crispy Chicken, Mais, Paprika, Knoblauchsauce', 0, 26, '[{"label":"26 cm","price":14.2},{"label":"30 cm","price":16.5},{"label":"Familien Pizza","price":25.5},{"label":"Party 60x40","price":35.9}]'],
      [1, 'NEXO Boom', 'nexo-boom', 'Tomatensauce, Salami, Hackfleisch, Paprika, Mais, Hirtenkäse, Oregano', 14.50, null, 'Tomatensauce, Salami, Hackfleisch, Paprika, Mais, Hirtenkäse, Oregano', 1, 27, '[{"label":"26 cm","price":14.5},{"label":"30 cm","price":16.9},{"label":"Familien Pizza","price":25.9},{"label":"Party 60x40","price":36.5}]'],
      [1, 'NEXO Deluxe', 'nexo-deluxe', 'Crème fraîche, Lachs, Paprika, Rucola', 15.20, null, 'Crème fraîche, Lachs, Paprika, Rucola', 0, 28, '[{"label":"26 cm","price":15.2},{"label":"30 cm","price":17.5},{"label":"Familien Pizza","price":26.9},{"label":"Party 60x40","price":37.9}]'],
      [1, 'NEXO Feuer Royale', 'nexo-feuer-royale', 'Tomatensauce, Hackfleisch, Jalapeños, Sauce Hollandaise, Feta, Oregano', 14.50, null, 'Tomatensauce, Hackfleisch, Jalapeños, Sauce Hollandaise, Feta, Oregano', 0, 29, '[{"label":"26 cm","price":14.5},{"label":"30 cm","price":16.9},{"label":"Familien Pizza","price":25.9},{"label":"Party 60x40","price":36.5}]'],
      [1, 'NEXO Goldkrone', 'nexo-goldkrone', 'Tomatensauce, Pute, Brokkoli, Champignons, Sauce Hollandaise, Oregano', 14.20, null, 'Tomatensauce, Pute, Brokkoli, Champignons, Sauce Hollandaise, Oregano', 0, 30, '[{"label":"26 cm","price":14.2},{"label":"30 cm","price":16.5},{"label":"Familien Pizza","price":25.5},{"label":"Party 60x40","price":35.9}]'],
      [2, 'Hamburger Smash', 'hamburger-smash', '110 g Smash Beef, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Burgersauce', 8.90, null, '110 g Smash Beef, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Burgersauce', 0, 4],
      [2, 'Cheeseburger Smash', 'cheeseburger-smash', '110 g Smash Beef, Cheddar, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Burgersauce', 9.90, null, '110 g Smash Beef, Cheddar, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Burgersauce', 1, 5],
      [2, 'Chickenburger', 'chickenburger', 'Crispy Chicken, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Chicken Sauce', 9.90, null, 'Crispy Chicken, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Chicken Sauce', 0, 6],
      [2, 'Fischburger', 'fischburger', 'Fischfilet, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Remoulade', 9.90, null, 'Fischfilet, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Remoulade', 0, 7],
      [2, 'Veggieburger', 'veggieburger', 'Veggie Patty, Salat, Tomate, Veggie Sauce', 8.90, null, 'Veggie Patty, Salat, Tomate, Veggie Sauce', 0, 8],
      [2, 'Double Smash', 'double-smash', '2x 110 g Smash Beef, 2x Cheddar, Zwiebeln, Gewürzgurken, Smash Sauce', 12.90, null, '2x 110 g Smash Beef, 2x Cheddar, Zwiebeln, Gewürzgurken, Smash Sauce', 1, 9],
      [2, 'Triple Smash', 'triple-smash', '3x 110 g Smash Beef, 3x Cheddar, Zwiebeln, Gewürzgurken, Smash Sauce', 16.90, null, '3x 110 g Smash Beef, 3x Cheddar, Zwiebeln, Gewürzgurken, Smash Sauce', 0, 10],
      [2, 'Bacon BBQ Smash', 'bacon-bbq-smash', '2x 110 g Smash Beef, Cheddar, Bacon, Röstzwiebeln, Gewürzgurken, BBQ Sauce', 13.90, null, '2x 110 g Smash Beef, Cheddar, Bacon, Röstzwiebeln, Gewürzgurken, BBQ Sauce', 1, 11],
      [2, 'Mushroom Smash', 'mushroom-smash', '110 g Smash Beef, Champignons, karamellisierte Zwiebeln, Cheddar, Smash Sauce', 10.90, null, '110 g Smash Beef, Champignons, karamellisierte Zwiebeln, Cheddar, Smash Sauce', 0, 12],
      [2, 'Chicken Smash', 'chicken-smash', '110 g Smash Chicken, Cheddar, Zwiebeln, Gewürzgurken, Chicken Sauce', 10.90, null, '110 g Smash Chicken, Cheddar, Zwiebeln, Gewürzgurken, Chicken Sauce', 0, 13],
      [2, 'BoomBurger', 'boomburger', '3x 110 g Smash Beef, 3x Cheddar, Spiegelei, Champignons, Boom Sauce', 17.90, null, '3x 110 g Smash Beef, 3x Cheddar, Spiegelei, Champignons, Boom Sauce', 1, 14],
      [2, 'Beef & Chicken Smash', 'beef-chicken-smash', '110 g Smash Beef, 110 g Smash Chicken, Cheddar, Zwiebeln, Gewürzgurken, NEXO Sauce', 13.90, null, '110 g Smash Beef, 110 g Smash Chicken, Cheddar, Zwiebeln, Gewürzgurken, NEXO Sauce', 0, 15],
      // Hinweis: Produktbilder für neue Burger-Slugs stehen in views/menu.ejs (productImgMap), damit kein Pizza-Fallback angezeigt wird
      [3, 'NEXO Madame', 'nexo-madame', 'Tomate, Käse', 7.90, null, 'Tomate, Käse', 0, 16],
      [3, 'NEXO Mozzarella', 'nexo-mozzarella', 'Mozzarella, Tomate, Käse', 8.50, null, 'Mozzarella, Tomate, Käse', 1, 17],
      [3, 'NEXO Salami', 'nexo-salami', 'Salami, Käse', 8.90, null, 'Salami, Käse', 0, 18],
      [3, 'NEXO Schinken', 'nexo-schinken', 'Schinken, Käse', 8.90, null, 'Schinken, Käse', 0, 19],
      [3, 'NEXO Chicken', 'nexo-chicken', 'Hähnchen, Käse', 9.50, null, 'Hähnchen, Käse', 0, 20],
      [3, 'NEXO Pute', 'nexo-pute', 'Putenbrust, Käse', 9.50, null, 'Putenbrust, Käse', 0, 21],
      [3, 'NEXO Sucuk', 'nexo-sucuk', 'Sucuk, gekochtes Ei, Käse', 9.50, null, 'Sucuk, gekochtes Ei, Käse', 1, 22],
      [3, 'NEXO Camembert', 'nexo-camembert', 'Camembert, Käse, Preiselbeeren', 9.90, null, 'Camembert, Käse, Preiselbeeren', 0, 23],
      [3, 'NEXO Hawaii', 'nexo-hawaii', 'Schinken, Ananas, Käse', 9.50, null, 'Schinken, Ananas, Käse', 0, 24],
      [3, 'NEXO Crispy', 'nexo-crispy', 'Crispy Chicken, Käse', 10.50, null, 'Crispy Chicken, Käse', 1, 25],
      [3, 'NEXO Tuna', 'nexo-tuna', 'Thunfisch, Zwiebeln, Käse', 9.90, null, 'Thunfisch, Zwiebeln, Käse', 0, 26],
      [3, 'NEXO Beef BBQ', 'nexo-beef-bbq', 'Rindfleisch, Käse, BBQ-Sauce', 10.90, null, 'Rindfleisch, Käse, BBQ-Sauce', 1, 27],
      [3, 'NEXO Formaggi', 'nexo-formaggi', '4 Käsesorten', 10.50, null, '4 Käsesorten', 0, 28],
      [4, 'Gemischter Salat', 'gemischter-salat', 'Eisbergsalat, Tomaten, Gurken, Mais. Dressing nach Wahl.', 7.90, null, 'Eisbergsalat, Tomaten, Gurken, Mais', 0, 1, null],
      [4, 'Chicken Salat', 'chicken-salat', 'Gemischter Salat, gegrillte Hähnchenbrust. Dressing nach Wahl.', 10.90, null, 'Gemischter Salat, gegrillte Hähnchenbrust', 1, 2, null],
      [4, 'Chef Salat', 'chef-salat', 'Gemischter Salat, Schinken, Thunfisch, gekochtes Ei. Dressing nach Wahl.', 11.90, null, 'Gemischter Salat, Schinken, Thunfisch, gekochtes Ei', 1, 3, null],
      [4, 'Cheese Salat', 'cheese-salat', 'Gemischter Salat, 3 verschiedene Käsesorten. Dressing nach Wahl.', 10.90, null, 'Gemischter Salat, 3 verschiedene Käsesorten', 0, 4, null],
      [4, 'Tuna Salat', 'tuna-salat', 'Gemischter Salat, Thunfisch, Zwiebeln, Oliven. Dressing nach Wahl.', 10.50, null, 'Gemischter Salat, Thunfisch, Zwiebeln, Oliven', 0, 5, null],
      [4, 'Wunsch Salat', 'wunsch-salat', 'Gemischter Salat, 3 Zutaten nach Wahl. Dressing nach Wahl.', 11.90, null, 'Gemischter Salat, 3 Zutaten nach Wahl', 0, 6, null],
      [5, 'NEXO Napoli', 'nexo-napoli', 'Tomatensauce', 8.90, null, 'Tomatensauce', 1, 1, null],
      [5, 'NEXO Bolognese', 'nexo-bolognese', 'Rinderhack, Tomatensauce', 9.90, null, 'Rinderhack, Tomatensauce', 0, 2, null],
      [5, 'NEXO Feuer', 'nexo-feuer', 'Tomatensauce, Knoblauch, Oliven, Jalapeños', 9.50, null, 'Tomatensauce, Knoblauch, Oliven, Jalapeños', 0, 3, null],
      [5, 'NEXO Fusion', 'nexo-fusion', '2 verschiedene Nudelsorten, Hackfleisch, Crème fraîche, Tomatensoße', 11.50, null, '2 verschiedene Nudelsorten, Hackfleisch, Crème fraîche, Tomatensoße', 0, 4, null],
      [5, 'NEXO Cheese', 'nexo-cheese', 'Vier Käsesorten in Sahnesauce', 11.50, null, 'Vier Käsesorten in Sahnesauce', 0, 5, null],
      [5, 'NEXO Carbonara', 'nexo-carbonara', 'Schinken, Ei, Sahnesauce', 10.50, null, 'Schinken, Ei, Sahnesauce', 1, 6, null],
      [5, 'NEXO Pesto', 'nexo-pesto', 'Hähnchen, Mais, Paprika, Basilikumpestosauce', 11.50, null, 'Hähnchen, Mais, Paprika, Basilikumpestosauce', 0, 7, null],
      [5, 'NEXO Hawaii', 'pasta-hawaii', 'Hähnchen, Ananas, Curry, Sahnesauce', 11.50, null, 'Hähnchen, Ananas, Curry, Sahnesauce', 0, 8, null],
      [5, 'NEXO Gamberi', 'nexo-gamberi', 'Garnelen, Knoblauch, Tomaten, Tomatensauce', 12.90, null, 'Garnelen, Knoblauch, Tomaten, Tomatensauce', 0, 9, null],
      [5, 'NEXO Scampi Royal', 'nexo-scampi-royal', 'Scampi, Knoblauch, Tomaten-Sahnesauce', 13.90, null, 'Scampi, Knoblauch, Tomaten-Sahnesauce', 1, 10, null],
      [5, 'NEXO Wunsch', 'pasta-wunsch', 'Zwei Zutaten und Sauce nach Wahl', 10.90, null, 'Zwei Zutaten und Sauce nach Wahl', 0, 11, null],
      [5, 'NEXO Hähnchen Genuss', 'nexo-haehnchen-genuss', 'Hähnchen, Champignons, Paprika, Zwiebel, Sahnesauce', 11.50, null, 'Hähnchen, Champignons, Paprika, Zwiebel, Sahnesauce', 0, 12, null],
      [5, 'NEXO Deluxe', 'pasta-nexo-deluxe', 'Crispy Chicken, Mais, Paprika, Hollandaise, Sahnesauce', 12.90, null, 'Crispy Chicken, Mais, Paprika, Hollandaise, Sahnesauce', 0, 13, null],
      [5, 'NEXO Signature', 'nexo-signature', 'Hähnchen, Mais, Brokkoli, Sahnesauce', 12.90, null, 'Hähnchen, Mais, Brokkoli, Sahnesauce', 0, 14, null],
      [6, 'Schnitzel Wiener Art', 'schnitzel-wiener-art', 'Schnitzel, Zitrone', 13.90, null, 'Schnitzel, Zitrone', 1, 1, null],
      [6, 'Jägerschnitzel', 'jaegerschnitzel', 'Schnitzel, Champignons, Jägersauce', 15.90, null, 'Schnitzel, Champignons, Jägersauce', 0, 2, null],
      [6, 'Zigeunerschnitzel', 'zigeunerschnitzel', 'Schnitzel, Paprika, Zwiebeln, Paprikasauce', 15.90, null, 'Schnitzel, Paprika, Zwiebeln, Paprikasauce', 0, 3, null],
      [6, 'Schnitzel Hollandaise', 'schnitzel-hollandaise', 'Schnitzel, Brokkoli, Sauce Hollandaise', 16.90, null, 'Schnitzel, Brokkoli, Sauce Hollandaise', 1, 4, null],
      [7, 'Currywurst mit Pommes', 'currywurst-pommes', 'Mit Pommes', 8.90, null, 'Wurst, Curry, Pommes', 1, 1, null],
      [7, 'Chicken Nuggets', 'chicken-nuggets', '6 oder 12 Stück', 6.90, null, 'Hähnchen, Panade', 1, 2, '[{"label":"6 Stk.","price":6.9},{"label":"12 Stk.","price":10.9}]'],
      [7, 'Chicken Wings', 'chicken-wings', '6 oder 12 Stück', 7.90, null, 'Hähnchen', 0, 3, '[{"label":"6 Stk.","price":7.9},{"label":"12 Stk.","price":12.9}]'],
      [7, 'Chili Cheese Nuggets', 'chili-cheese-nuggets', '6 oder 12 Stück', 6.90, null, 'Hähnchen, Chili, Käse', 0, 4, '[{"label":"6 Stk.","price":6.9},{"label":"12 Stk.","price":10.9}]'],
      [7, 'Baked Feta', 'baked-feta', '6 oder 12 Stück', 7.90, null, 'Feta', 0, 5, '[{"label":"6 Stk.","price":7.9},{"label":"12 Stk.","price":11.9}]'],
      [7, 'Chicken Strips', 'chicken-strips', '6 oder 12 Stück', 8.50, null, 'Hähnchen', 0, 6, '[{"label":"6 Stk.","price":8.5},{"label":"12 Stk.","price":13.9}]'],
      [7, 'Frühlingsrollen', 'fruehlingsrollen', '6 oder 12 Stück', 5.90, null, 'Teig, Gemüse', 0, 7, '[{"label":"6 Stk.","price":5.9},{"label":"12 Stk.","price":9.9}]'],
      [7, 'Mozzarella Sticks', 'mozzarella-sticks', '6 oder 12 Stück', 6.90, null, 'Mozzarella, Panade', 0, 8, '[{"label":"6 Stk.","price":6.9},{"label":"12 Stk.","price":11.9}]'],
      [7, 'Zwiebelringe', 'zwiebelringe', '6 oder 12 Stück', 5.50, null, 'Zwiebeln, Panade', 0, 9, '[{"label":"6 Stk.","price":5.5},{"label":"12 Stk.","price":9.5}]'],
      [7, 'Shrimps', 'shrimps', '6 oder 12 Stück', 8.50, null, 'Shrimps, Panade', 0, 10, '[{"label":"6 Stk.","price":8.5},{"label":"12 Stk.","price":13.9}]'],
      [7, 'Muslitos', 'muslitos', '6 oder 12 Stück', 8.50, null, 'Muslitos, Panade', 0, 11, '[{"label":"6 Stk.","price":8.5},{"label":"12 Stk.","price":13.9}]'],
      [7, 'Corn Dog', 'corn-dog', 'Klein oder Groß', 2.99, null, 'Würstchen, Maisteig', 0, 12, '[{"label":"Klein","price":2.99},{"label":"Groß","price":5.9}]'],
      [8, 'Coca Cola', 'coca-cola', 'Eisgekühlte Coca Cola 0,33l', 3.50, null, null, 0, 20],
      [8, 'Fanta', 'fanta', 'Eisgekühlte Fanta 0,33l', 3.50, null, null, 0, 21],
      [8, 'Wasser', 'wasser', 'Natürliches Mineralwasser mit Kohlensäure 0,75l', 3.00, null, null, 0, 22],
      [9, 'Frühlingsrolle', 'fruehlingsrolle', 'Knusprige Frühlingsrollen mit süß-saurer Dippsauce', 6.90, null, 'Teig, Gemüse, Glasnudeln', 0, 23],
      [9, 'Falafel Wrap', 'falafel-wrap', 'Vegetarischer Wrap mit Falafel, Hummus und frischem Gemüse', 8.90, null, 'Falafel, Hummus, Gemüse, Fladenbrot', 0, 24],
      [10, 'Knoblauch', 'knoblauch', '', 2.00, null, '', 0, 1, null],
      [10, 'American', 'american', '', 2.00, null, '', 0, 2, null],
      [10, 'Remoulade', 'remoulade', '', 2.00, null, '', 0, 3, null],
      [10, 'NEXO Haus', 'nexo-haus', 'Unsere Haussauce', 2.00, null, 'Unsere Haussauce', 1, 4, null],
      [10, 'Chili', 'chili', '', 2.00, null, '', 0, 5, null],
      [10, 'BBQ', 'bbq-sauce', '', 2.00, null, '', 0, 6, null],
      [10, 'Curry', 'curry', '', 2.00, null, '', 0, 7, null],
      [11, 'Spaghetti Eis', 'spaghetti-eis', '', 5.50, null, '', 1, 1, null],
      [11, 'Tiramisu', 'tiramisu', '', 5.50, null, '', 0, 2, null],
      [11, 'Cheesecake', 'cheesecake', '', 5.50, null, '', 0, 3, null],
      [11, 'Oreo Choice', 'oreo-choice', 'Oreo Donut oder Oreo Muffin, 1 nach Wahl', 3.90, null, 'Oreo Donut oder Oreo Muffin, 1 nach Wahl', 0, 4, '[{"label":"Oreo Donut","price":3.9},{"label":"Oreo Muffin","price":3.9}]'],
      [11, 'Nutella Pizza', 'nutella-pizza', 'Nutella, Weiße Schokolade', 8.90, null, 'Nutella, Weiße Schokolade', 1, 5, null],
      [11, 'Crêpe Nutella', 'crepe-nutella', 'Nutella, inklusive 2 Schokoladensorten nach Wahl', 7.90, null, 'Nutella, inklusive 2 Schokoladensorten nach Wahl', 0, 6, null],
      [11, 'Crêpe Frucht', 'crepe-frucht', 'Banane, Erdbeeren oder Kiwi nach Wahl, inklusive 2 Schokoladensorten nach Wahl', 8.90, null, 'Banane, Erdbeeren oder Kiwi nach Wahl, inklusive 2 Schokoladensorten nach Wahl', 0, 7, '[{"label":"Banane","price":8.9},{"label":"Erdbeeren","price":8.9},{"label":"Kiwi","price":8.9}]'],
      [11, 'Crêpe Lotus', 'crepe-lotus', 'Lotus, inklusive 2 Schokoladensorten nach Wahl', 8.90, null, 'Lotus, inklusive 2 Schokoladensorten nach Wahl', 0, 8, null],
      [11, 'Crêpe Oreo', 'crepe-oreo', 'Oreo, inklusive 2 Schokoladensorten nach Wahl', 8.90, null, 'Oreo, inklusive 2 Schokoladensorten nach Wahl', 0, 9, null],
      [11, 'Crêpe Bueno', 'crepe-bueno', 'Bueno, inklusive 2 Schokoladensorten nach Wahl', 9.50, null, 'Bueno, inklusive 2 Schokoladensorten nach Wahl', 1, 10, null],
      [11, 'Mini Pancakes', 'mini-pancakes', '10 oder 20 Stück, 2 Toppings nach Wahl: Nutella, Weiße Schokolade, Pistaziencreme, Puderzucker', 7.90, null, '10 oder 20 Stück, 2 Toppings nach Wahl', 1, 11, '[{"label":"10 Stück","price":7.9},{"label":"20 Stück","price":13.9}]'],
      [11, 'Mini Waffel', 'mini-waffel', '10 oder 20 Stück, 2 Toppings nach Wahl: Nutella, Weiße Schokolade, Pistaziencreme, Puderzucker', 7.90, null, '10 oder 20 Stück, 2 Toppings nach Wahl', 0, 12, '[{"label":"10 Stück","price":7.9},{"label":"20 Stück","price":13.9}]'],
      [12, 'Portion Oliven', 'portion-oliven', '', 4.50, null, '', 0, 1, null],
      [12, 'Portion Peperoni oder Jalapeños', 'portion-peperoni-jalapenos', '', 4.50, null, '', 0, 2, null],
      [12, 'Knoblauchbrot mit Käse', 'knoblauchbrot', '', 6.90, null, '', 1, 3, null],
      [12, 'Spezialbrot', 'spezialbrot', 'mit Käse überbacken', 7.50, null, 'mit Käse überbacken', 0, 4, null],
      [12, 'Formaggi Spezialbrot', 'formaggi-spezialbrot', 'mit verschiedenen Käsesorten', 8.50, null, 'mit verschiedenen Käsesorten', 1, 5, null],
      [13, 'Pommes Frites', 'pommes-frites', 'Groß', 5.50, null, 'Kartoffeln', 1, 1, null],
      [13, 'Chili Cheese Fries', 'chili-cheese-fries', '', 6.90, null, '', 0, 2, null],
      [13, 'Hotdog Fries', 'hotdog-fries', '', 8.50, null, '', 0, 3, null],
      [13, 'Kroketten', 'kroketten', '10 Stück', 5.90, null, 'Kartoffeln', 0, 4, null],
      [13, 'Curly Fries', 'curly-fries', '', 5.90, null, '', 0, 5, null],
      [14, 'BOX 1', 'box-1', '2 Cheeseburger oder 2 Chickenburger, 6 Chicken Nuggets, 6 Chicken Wings, Pommes, 3 Saucen', 38.90, null, '2 Cheeseburger oder 2 Chickenburger, 6 Chicken Nuggets, 6 Chicken Wings, Pommes, 3 Saucen', 1, 1, null],
      [14, 'BOX 2', 'box-2', 'Pizza Wunsch Ø 30 cm, 2 Cheeseburger oder 2 Chickenburger, 6 Snacks nach Wahl, Pommes, 3 Saucen', 49.90, null, 'Pizza Wunsch, Cheeseburger oder Chickenburger, Snacks, Pommes, Saucen', 0, 2, null],
      [14, 'BOX 3', 'box-3', 'Pizza Wunsch Ø 30 cm, 1 Cheeseburger oder 1 Chickenburger, Pasta Wunsch, Pommes, 2 Saucen', 38.90, null, 'Pizza Wunsch, Cheeseburger oder Chickenburger, Pasta Wunsch, Pommes, Saucen', 0, 3, null],
      [15, 'Kids Pizza', 'kids-pizza', 'Pizza Ø 22 cm – bitte wählen: Margherita oder Salami', 7.90, null, 'Pizza, Margherita oder Salami', 1, 1, '[{"label":"Margherita","price":7.9},{"label":"Salami","price":7.9}]'],
      [15, 'Kids Nuggets', 'kids-nuggets', '5 Chicken Nuggets, Pommes', 7.50, null, 'Chicken Nuggets, Pommes', 0, 2, null],
      [15, 'Happy Fish', 'happy-fish', '4 Happy Fish, Pommes', 7.90, null, 'Fisch, Pommes', 0, 3, null],
      [16, 'Vanille', 'vanille', '', 5.99, null, '', 0, 1, null],
      [16, 'Schokolade', 'schokolade', '', 5.99, null, '', 0, 2, null],
      [16, 'Banane', 'banane', '', 5.99, null, '', 0, 3, null],
      [16, 'Erdbeere', 'erdbeere', '', 5.99, null, '', 0, 4, null],
      [16, 'Mix Milkshake', 'mix-milkshake', '2 Sorten nach Wahl gemischt', 6.49, null, '2 Sorten nach Wahl gemischt', 1, 5, null],
    ];
    for (const p of products) {
      await query(
        `INSERT INTO products (category_id, name, slug, description, price, old_price, ingredients, is_featured, sort_order, sizes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (slug) DO NOTHING`,
        [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9] || null]
      );
    }
  }

  // Auto-Migration Burger 2026-09-03: immer ausführen, damit Render-DB ohne Shell aktualisiert wird
  // Löscht die 3 alten Burger und stellt die 12 Smash-Burger per Upsert sicher (idempotent, Admin-Bilder bleiben erhalten)
  try {
    const burgerCat = await get("SELECT * FROM categories WHERE slug = 'burger'");
    if (burgerCat) {
      await query('UPDATE categories SET description = $1 WHERE id = $2',
        ['Smash Burger frisch für dich gesmasht. Als Menü (+5,00 €) mit Pommes und 0,33 l Softdrink nach Wahl.', burgerCat.id]);
      await query("DELETE FROM products WHERE category_id = $1 AND slug IN ('classic-burger','cheese-burger','chicken-burger')", [burgerCat.id]);
      const smashBurgers = [
        ['Hamburger Smash', 'hamburger-smash', '110 g Smash Beef, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Burgersauce', 8.90, '110 g Smash Beef, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Burgersauce', 0, 4, '/images/products/img13.jpg'],
        ['Cheeseburger Smash', 'cheeseburger-smash', '110 g Smash Beef, Cheddar, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Burgersauce', 9.90, '110 g Smash Beef, Cheddar, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Burgersauce', 1, 5, '/images/products/img14.jpg'],
        ['Chickenburger', 'chickenburger', 'Crispy Chicken, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Chicken Sauce', 9.90, 'Crispy Chicken, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Chicken Sauce', 0, 6, '/images/products/img13.jpg'],
        ['Fischburger', 'fischburger', 'Fischfilet, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Remoulade', 9.90, 'Fischfilet, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Remoulade', 0, 7, null],
        ['Veggieburger', 'veggieburger', 'Veggie Patty, Salat, Tomate, Veggie Sauce', 8.90, 'Veggie Patty, Salat, Tomate, Veggie Sauce', 0, 8, null],
        ['Double Smash', 'double-smash', '2x 110 g Smash Beef, 2x Cheddar, Zwiebeln, Gewürzgurken, Smash Sauce', 12.90, '2x 110 g Smash Beef, 2x Cheddar, Zwiebeln, Gewürzgurken, Smash Sauce', 1, 9, null],
        ['Triple Smash', 'triple-smash', '3x 110 g Smash Beef, 3x Cheddar, Zwiebeln, Gewürzgurken, Smash Sauce', 16.90, '3x 110 g Smash Beef, 3x Cheddar, Zwiebeln, Gewürzgurken, Smash Sauce', 0, 10, null],
        ['Bacon BBQ Smash', 'bacon-bbq-smash', '2x 110 g Smash Beef, Cheddar, Bacon, Röstzwiebeln, Gewürzgurken, BBQ Sauce', 13.90, '2x 110 g Smash Beef, Cheddar, Bacon, Röstzwiebeln, Gewürzgurken, BBQ Sauce', 1, 11, null],
        ['Mushroom Smash', 'mushroom-smash', '110 g Smash Beef, Champignons, karamellisierte Zwiebeln, Cheddar, Smash Sauce', 10.90, '110 g Smash Beef, Champignons, karamellisierte Zwiebeln, Cheddar, Smash Sauce', 0, 12, null],
        ['Chicken Smash', 'chicken-smash', '110 g Smash Chicken, Cheddar, Zwiebeln, Gewürzgurken, Chicken Sauce', 10.90, '110 g Smash Chicken, Cheddar, Zwiebeln, Gewürzgurken, Chicken Sauce', 0, 13, null],
        ['BoomBurger', 'boomburger', '3x 110 g Smash Beef, 3x Cheddar, Spiegelei, Champignons, Boom Sauce', 17.90, '3x 110 g Smash Beef, 3x Cheddar, Spiegelei, Champignons, Boom Sauce', 1, 14, null],
        ['Beef & Chicken Smash', 'beef-chicken-smash', '110 g Smash Beef, 110 g Smash Chicken, Cheddar, Zwiebeln, Gewürzgurken, NEXO Sauce', 13.90, '110 g Smash Beef, 110 g Smash Chicken, Cheddar, Zwiebeln, Gewürzgurken, NEXO Sauce', 0, 15, null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image] of smashBurgers) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, image=COALESCE(products.image, EXCLUDED.image)`,
          [burgerCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order]
        );
      }
      // Backfill: falls alte Zeilen noch NULL-Bilder haben (z.B. erste Migration), Burger-Bilder nachtragen
      const burgerImgFallback = {
        'fischburger': '/images/products/img13.jpg', 'veggieburger': '/images/products/img14.jpg',
        'double-smash': '/images/products/img14.jpg', 'triple-smash': '/images/products/img13.jpg',
        'bacon-bbq-smash': '/images/products/img14.jpg', 'mushroom-smash': '/images/products/img13.jpg',
        'chicken-smash': '/images/products/img13.jpg', 'boomburger': '/images/products/img14.jpg',
        'beef-chicken-smash': '/images/products/img14.jpg'
      };
      for (const [slug, img] of Object.entries(burgerImgFallback)) {
        await query('UPDATE products SET image = $1 WHERE slug = $2 AND image IS NULL', [img, slug]);
      }
      // Schwarzes Burger-Bild (img15) entfernen: durch normales Burger-Bild ersetzen
      await query("UPDATE products SET image = '/images/products/img13.jpg' WHERE image = '/images/products/img15.jpg' AND category_id = $1", [burgerCat.id]);
    }
  } catch (e) {
    console.error('Burger Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Croque 2026-09-04: 3 alte Croques löschen, 13 NEXO-Croques per Upsert sicherstellen (idempotent)
  try {
    const croqueCat = await get("SELECT * FROM categories WHERE slug = 'croque'");
    if (croqueCat) {
      await query('UPDATE categories SET description = $1 WHERE id = $2',
        ['Frisch überbackene Croques. Inklusive 1 Sauce nach Wahl.', croqueCat.id]);
      await query("DELETE FROM products WHERE category_id = $1 AND slug IN ('croque-monsieur','croque-madame','croque-hawaii')", [croqueCat.id]);
      const nexoCroques = [
        ['NEXO Madame', 'nexo-madame', 'Tomate, Käse', 7.90, 'Tomate, Käse', 0, 16, '/images/products/img7.jpg'],
        ['NEXO Mozzarella', 'nexo-mozzarella', 'Mozzarella, Tomate, Käse', 8.50, 'Mozzarella, Tomate, Käse', 1, 17, '/images/products/img8.jpg'],
        ['NEXO Salami', 'nexo-salami', 'Salami, Käse', 8.90, 'Salami, Käse', 0, 18, '/images/products/img9.jpg'],
        ['NEXO Schinken', 'nexo-schinken', 'Schinken, Käse', 8.90, 'Schinken, Käse', 0, 19, '/images/products/img7.jpg'],
        ['NEXO Chicken', 'nexo-chicken', 'Hähnchen, Käse', 9.50, 'Hähnchen, Käse', 0, 20, '/images/products/img8.jpg'],
        ['NEXO Pute', 'nexo-pute', 'Putenbrust, Käse', 9.50, 'Putenbrust, Käse', 0, 21, '/images/products/img9.jpg'],
        ['NEXO Sucuk', 'nexo-sucuk', 'Sucuk, gekochtes Ei, Käse', 9.50, 'Sucuk, gekochtes Ei, Käse', 1, 22, '/images/products/img7.jpg'],
        ['NEXO Camembert', 'nexo-camembert', 'Camembert, Käse, Preiselbeeren', 9.90, 'Camembert, Käse, Preiselbeeren', 0, 23, '/images/products/img8.jpg'],
        ['NEXO Hawaii', 'nexo-hawaii', 'Schinken, Ananas, Käse', 9.50, 'Schinken, Ananas, Käse', 0, 24, '/images/products/img9.jpg'],
        ['NEXO Crispy', 'nexo-crispy', 'Crispy Chicken, Käse', 10.50, 'Crispy Chicken, Käse', 1, 25, '/images/products/img7.jpg'],
        ['NEXO Tuna', 'nexo-tuna', 'Thunfisch, Zwiebeln, Käse', 9.90, 'Thunfisch, Zwiebeln, Käse', 0, 26, '/images/products/img8.jpg'],
        ['NEXO Beef BBQ', 'nexo-beef-bbq', 'Rindfleisch, Käse, BBQ-Sauce', 10.90, 'Rindfleisch, Käse, BBQ-Sauce', 1, 27, '/images/products/img9.jpg'],
        ['NEXO Formaggi', 'nexo-formaggi', '4 Käsesorten', 10.50, '4 Käsesorten', 0, 28, '/images/products/img7.jpg'],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image] of nexoCroques) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, image=COALESCE(products.image, EXCLUDED.image)`,
          [croqueCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order]
        );
      }
    }
  } catch (e) {
    console.error('Croque Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Pizza 2026-09-04: 30 NEXO-Pizzen mit je 4 Größen (26cm/30cm/Familie/Party) per Upsert (idempotent)
  try {
    const pizzaCat = await get("SELECT * FROM categories WHERE slug = 'pizza'");
    if (pizzaCat) {
      await query('UPDATE categories SET description = $1 WHERE id = $2',
        ['Steinofenpizza in 4 Größen: 26 cm, 30 cm, Familien Pizza und Party. Alle Pizzen in 26 cm und 30 cm auch als Calzone erhältlich.', pizzaCat.id]);
      await query("DELETE FROM products WHERE category_id = $1 AND slug IN ('prosciutto')", [pizzaCat.id]);
      const SZ = (a, b, c, d) => JSON.stringify([{ label: '26 cm', price: a }, { label: '30 cm', price: b }, { label: 'Familien Pizza', price: c }, { label: 'Party 60x40', price: d }]);
      const nexoPizzen = [
        ['Margherita', 'margherita', 'Tomatensauce, Oregano', 8.90, 'Tomatensauce, Oregano', 1, 1, '/images/products/img1.jpg', SZ(8.90, 11.50, 19.90, 27.10)],
        ['Mozzarella', 'mozzarella', 'Tomatensauce, Mozzarella, frische Tomaten, Basilikum, Oregano', 10.90, 'Tomatensauce, Mozzarella, frische Tomaten, Basilikum, Oregano', 0, 2, '/images/products/img1.jpg', SZ(10.90, 13.50, 22.90, 31.90)],
        ['Cheese', 'cheese', 'Tomatensauce, verschiedene Käsesorten, Oregano', 10.90, 'Tomatensauce, verschiedene Käsesorten, Oregano', 0, 3, '/images/products/img2.jpg', SZ(10.90, 13.50, 22.90, 31.90)],
        ['Salami', 'salami', 'Tomatensauce, Salami, Oregano', 10.20, 'Tomatensauce, Salami, Oregano', 1, 4, '/images/products/img2.jpg', SZ(10.20, 12.50, 21.50, 30.50)],
        ['Prosciutto', 'prosciutto', 'Tomatensauce, Schinken, Oregano', 10.20, 'Tomatensauce, Schinken, Oregano', 0, 5, '/images/products/img3.jpg', SZ(10.20, 12.50, 21.50, 30.50)],
        ['Funghi', 'funghi', 'Tomatensauce, Champignons, Oregano', 10.20, 'Tomatensauce, Champignons, Oregano', 0, 6, '/images/products/img1.jpg', SZ(10.20, 12.50, 21.50, 30.50)],
        ['Dreiklang', 'dreiklang', 'Tomatensauce, Salami, Schinken, Champignons, Oregano', 12.40, 'Tomatensauce, Salami, Schinken, Champignons, Oregano', 1, 7, '/images/products/img2.jpg', SZ(12.40, 14.90, 23.90, 33.50)],
        ['Hawaii', 'hawaii', 'Tomatensauce, Schinken, Ananas, Oregano', 12.20, 'Tomatensauce, Schinken, Ananas, Oregano', 0, 8, '/images/products/img3.jpg', SZ(12.20, 14.50, 23.50, 33.00)],
        ['Vegetarisch', 'vegetarisch', 'Tomatensauce, verschiedene Gemüsesorten, Oregano', 12.20, 'Tomatensauce, verschiedene Gemüsesorten, Oregano', 0, 9, '/images/products/img1.jpg', SZ(12.20, 14.50, 23.50, 33.00)],
        ['Tonno', 'tonno', 'Tomatensauce, Thunfisch, rote Zwiebeln, Oregano', 12.60, 'Tomatensauce, Thunfisch, rote Zwiebeln, Oregano', 0, 10, '/images/products/img2.jpg', SZ(12.60, 14.90, 24.00, 33.50)],
        ['Scampi', 'scampi', 'Tomatensauce, Scampi, Oregano', 14.20, 'Tomatensauce, Scampi, Oregano', 0, 11, '/images/products/img3.jpg', SZ(14.20, 16.50, 25.50, 35.90)],
        ['Frutti di Mare', 'frutti-di-mare', 'Tomatensauce, Frutti di Mare, Oregano', 14.20, 'Tomatensauce, Frutti di Mare, Oregano', 0, 12, '/images/products/img1.jpg', SZ(14.20, 16.50, 25.50, 35.90)],
        ['Spezial Chicken', 'spezial-chicken', 'Tomatensauce, Hähnchen, Paprika, rote Zwiebeln, Champignons, Oregano', 13.40, 'Tomatensauce, Hähnchen, Paprika, rote Zwiebeln, Champignons, Oregano', 1, 13, '/images/products/img2.jpg', SZ(13.40, 15.90, 24.90, 34.90)],
        ['Chicken Hollandaise', 'chicken-hollandaise', 'Tomatensauce, Hähnchen, Brokkoli, Sauce Hollandaise, Oregano', 13.40, 'Tomatensauce, Hähnchen, Brokkoli, Sauce Hollandaise, Oregano', 0, 14, '/images/products/img3.jpg', SZ(13.40, 15.90, 24.90, 34.90)],
        ['Chicken Curry', 'chicken-curry', 'Tomatensauce, Hähnchen, Ananas, Curry, Oregano', 13.20, 'Tomatensauce, Hähnchen, Ananas, Curry, Oregano', 0, 15, '/images/products/img1.jpg', SZ(13.20, 15.50, 24.50, 34.50)],
        ['Chicken Beef', 'chicken-beef', 'Tomatensauce, Hähnchen, Hackfleisch, Hirtenkäse, Oregano', 14.20, 'Tomatensauce, Hähnchen, Hackfleisch, Hirtenkäse, Oregano', 0, 16, '/images/products/img2.jpg', SZ(14.20, 16.50, 25.50, 35.90)],
        ['BBQ', 'bbq', 'Tomatensauce, Salami, Hackfleisch, BBQ-Sauce, Röstzwiebeln, Oregano', 13.90, 'Tomatensauce, Salami, Hackfleisch, BBQ-Sauce, Röstzwiebeln, Oregano', 1, 17, '/images/products/img3.jpg', SZ(13.90, 16.20, 25.20, 35.50)],
        ['Hot Beef', 'hot-beef', 'Tomatensauce, Hackfleisch, Paprika, Jalapeños, Oregano', 13.60, 'Tomatensauce, Hackfleisch, Paprika, Jalapeños, Oregano', 0, 18, '/images/products/img1.jpg', SZ(13.60, 15.90, 24.90, 34.90)],
        ['Sucuk', 'sucuk', 'Tomatensauce, Sucuk, Peperoni, Ei, Oregano', 13.60, 'Tomatensauce, Sucuk, Peperoni, Ei, Oregano', 0, 19, '/images/products/img2.jpg', SZ(13.60, 15.90, 24.90, 34.90)],
        ['Bacon', 'bacon', 'Tomatensauce, Rinderhackfleisch, BBQ-Sauce, Mozzarella, Bacon, Oregano', 14.20, 'Tomatensauce, Rinderhackfleisch, BBQ-Sauce, Mozzarella, Bacon, Oregano', 0, 20, '/images/products/img3.jpg', SZ(14.20, 16.50, 25.50, 35.90)],
        ['Sucuk Jalapeños', 'sucuk-jalapenos', 'Tomatensauce, Sucuk, Jalapeños, Ei, Oregano', 13.60, 'Tomatensauce, Sucuk, Jalapeños, Ei, Oregano', 0, 21, '/images/products/img1.jpg', SZ(13.60, 15.90, 24.90, 34.90)],
        ['Meat Lovers', 'meat-lovers', 'Tomatensauce, Salami, Schinken, Sucuk, Rinderhackfleisch, Oregano', 14.90, 'Tomatensauce, Salami, Schinken, Sucuk, Rinderhackfleisch, Oregano', 1, 22, '/images/products/img2.jpg', SZ(14.90, 17.20, 26.20, 36.90)],
        ['Hot Dog', 'hot-dog', 'Tomatensauce, Würstchen, Gewürzgurken, Röstzwiebeln, Oregano', 13.20, 'Tomatensauce, Würstchen, Gewürzgurken, Röstzwiebeln, Oregano', 0, 23, '/images/products/img3.jpg', SZ(13.20, 15.50, 24.50, 34.50)],
        ['UFO', 'ufo', 'Tomatensauce, von allem etwas, doppelter Teig, Oregano', 15.20, 'Tomatensauce, von allem etwas, doppelter Teig, Oregano', 0, 24, '/images/products/img1.jpg', SZ(15.20, 17.50, 26.90, 37.90)],
        ['NEXO Wunsch', 'nexo-wunsch', 'Tomatensauce, drei Zutaten nach Wahl, Oregano', 13.60, 'Tomatensauce, drei Zutaten nach Wahl, Oregano', 0, 25, '/images/products/img2.jpg', SZ(13.60, 15.90, 24.90, 34.90)],
        ['NEXO X', 'nexo-x', 'Hollandaise, Crispy Chicken, Mais, Paprika, Knoblauchsauce', 14.20, 'Hollandaise, Crispy Chicken, Mais, Paprika, Knoblauchsauce', 0, 26, '/images/products/img3.jpg', SZ(14.20, 16.50, 25.50, 35.90)],
        ['NEXO Boom', 'nexo-boom', 'Tomatensauce, Salami, Hackfleisch, Paprika, Mais, Hirtenkäse, Oregano', 14.50, 'Tomatensauce, Salami, Hackfleisch, Paprika, Mais, Hirtenkäse, Oregano', 1, 27, '/images/products/img1.jpg', SZ(14.50, 16.90, 25.90, 36.50)],
        ['NEXO Deluxe', 'nexo-deluxe', 'Crème fraîche, Lachs, Paprika, Rucola', 15.20, 'Crème fraîche, Lachs, Paprika, Rucola', 0, 28, '/images/products/img2.jpg', SZ(15.20, 17.50, 26.90, 37.90)],
        ['NEXO Feuer Royale', 'nexo-feuer-royale', 'Tomatensauce, Hackfleisch, Jalapeños, Sauce Hollandaise, Feta, Oregano', 14.50, 'Tomatensauce, Hackfleisch, Jalapeños, Sauce Hollandaise, Feta, Oregano', 0, 29, '/images/products/img3.jpg', SZ(14.50, 16.90, 25.90, 36.50)],
        ['NEXO Goldkrone', 'nexo-goldkrone', 'Tomatensauce, Pute, Brokkoli, Champignons, Sauce Hollandaise, Oregano', 14.20, 'Tomatensauce, Pute, Brokkoli, Champignons, Sauce Hollandaise, Oregano', 0, 30, '/images/products/img1.jpg', SZ(14.20, 16.50, 25.50, 35.90)],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of nexoPizzen) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=EXCLUDED.sizes, image=COALESCE(products.image, EXCLUDED.image)`,
          [pizzaCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Pizza Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Dessert 2026-09-04: Kategorie anlegen (falls fehlend) + 12 Produkte per Upsert (idempotent)
  try {
    let dessertCat = await get("SELECT * FROM categories WHERE slug = 'dessert'");
    if (!dessertCat) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        ['Dessert', 'dessert', 'Süße Klassiker, Crêpes, Mini Pancakes & Mini Waffeln. Alle Crêpes inklusive 2 Schokoladensorten nach Wahl.', 11]
      );
      dessertCat = await get("SELECT * FROM categories WHERE slug = 'dessert'");
    }
    if (dessertCat) {
      await query('UPDATE categories SET description = $1, sort_order = 11 WHERE id = $2',
        ['Süße Klassiker, Crêpes, Mini Pancakes & Mini Waffeln. Alle Crêpes inklusive 2 Schokoladensorten nach Wahl.', dessertCat.id]);
      const desserts = [
        ['Spaghetti Eis', 'spaghetti-eis', '', 5.50, '', 1, 1, '/images/products/img20.jpg', null],
        ['Tiramisu', 'tiramisu', '', 5.50, '', 0, 2, '/images/products/img19.jpg', null],
        ['Cheesecake', 'cheesecake', '', 5.50, '', 0, 3, '/images/products/img22.jpg', null],
        ['Oreo Choice', 'oreo-choice', 'Oreo Donut oder Oreo Muffin, 1 nach Wahl', 3.90, 'Oreo Donut oder Oreo Muffin, 1 nach Wahl', 0, 4, '/images/products/img21.jpg', '[{"label":"Oreo Donut","price":3.9},{"label":"Oreo Muffin","price":3.9}]'],
        ['Nutella Pizza', 'nutella-pizza', 'Nutella, Weiße Schokolade', 8.90, 'Nutella, Weiße Schokolade', 1, 5, '/images/products/img19.jpg', null],
        ['Crêpe Nutella', 'crepe-nutella', 'Nutella, inklusive 2 Schokoladensorten nach Wahl', 7.90, 'Nutella, inklusive 2 Schokoladensorten nach Wahl', 0, 6, '/images/products/img20.jpg', null],
        ['Crêpe Frucht', 'crepe-frucht', 'Banane, Erdbeeren oder Kiwi nach Wahl, inklusive 2 Schokoladensorten nach Wahl', 8.90, 'Banane, Erdbeeren oder Kiwi nach Wahl, inklusive 2 Schokoladensorten nach Wahl', 0, 7, '/images/products/img21.jpg', '[{"label":"Banane","price":8.9},{"label":"Erdbeeren","price":8.9},{"label":"Kiwi","price":8.9}]'],
        ['Crêpe Lotus', 'crepe-lotus', 'Lotus, inklusive 2 Schokoladensorten nach Wahl', 8.90, 'Lotus, inklusive 2 Schokoladensorten nach Wahl', 0, 8, '/images/products/img22.jpg', null],
        ['Crêpe Oreo', 'crepe-oreo', 'Oreo, inklusive 2 Schokoladensorten nach Wahl', 8.90, 'Oreo, inklusive 2 Schokoladensorten nach Wahl', 0, 9, '/images/products/img19.jpg', null],
        ['Crêpe Bueno', 'crepe-bueno', 'Bueno, inklusive 2 Schokoladensorten nach Wahl', 9.50, 'Bueno, inklusive 2 Schokoladensorten nach Wahl', 1, 10, '/images/products/img20.jpg', null],
        ['Mini Pancakes', 'mini-pancakes', '10 oder 20 Stück, 2 Toppings nach Wahl: Nutella, Weiße Schokolade, Pistaziencreme, Puderzucker', 7.90, '10 oder 20 Stück, 2 Toppings nach Wahl', 1, 11, '/images/products/img21.jpg', '[{"label":"10 Stück","price":7.9},{"label":"20 Stück","price":13.9}]'],
        ['Mini Waffel', 'mini-waffel', '10 oder 20 Stück, 2 Toppings nach Wahl: Nutella, Weiße Schokolade, Pistaziencreme, Puderzucker', 7.90, '10 oder 20 Stück, 2 Toppings nach Wahl', 0, 12, '/images/products/img22.jpg', '[{"label":"10 Stück","price":7.9},{"label":"20 Stück","price":13.9}]'],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of desserts) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [dessertCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Dessert Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Beilagen 2026-09-04: Kategorie anlegen (falls fehlend) + 5 Produkte per Upsert (idempotent)
  try {
    let beilagenCat = await get("SELECT * FROM categories WHERE slug = 'beilagen'");
    if (!beilagenCat) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        ['Beilagen', 'beilagen', 'Knusprige Beilagen für jeden Geschmack.', 12]
      );
      beilagenCat = await get("SELECT * FROM categories WHERE slug = 'beilagen'");
    }
    if (beilagenCat) {
      await query('UPDATE categories SET description = $1, sort_order = 12 WHERE id = $2',
        ['Knusprige Beilagen für jeden Geschmack.', beilagenCat.id]);
      const beilagen = [
        ['Portion Oliven', 'portion-oliven', '', 4.50, '', 0, 1, '/images/products/img4.jpg', null],
        ['Portion Peperoni oder Jalapeños', 'portion-peperoni-jalapenos', '', 4.50, '', 0, 2, '/images/products/img5.jpg', null],
        ['Knoblauchbrot mit Käse', 'knoblauchbrot', '', 6.90, '', 1, 3, '/images/products/img7.jpg', null],
        ['Spezialbrot', 'spezialbrot', 'mit Käse überbacken', 7.50, 'mit Käse überbacken', 0, 4, '/images/products/img8.jpg', null],
        ['Formaggi Spezialbrot', 'formaggi-spezialbrot', 'mit verschiedenen Käsesorten', 8.50, 'mit verschiedenen Käsesorten', 1, 5, '/images/products/img9.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of beilagen) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [beilagenCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Beilagen Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Fries 2026-09-04: Kategorie anlegen (falls fehlend) + 5 Produkte per Upsert (idempotent)
  try {
    let friesCat = await get("SELECT * FROM categories WHERE slug = 'fries'");
    if (!friesCat) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        ['Fries', 'fries', 'Knusprige Fries für jeden Geschmack.', 13]
      );
      friesCat = await get("SELECT * FROM categories WHERE slug = 'fries'");
    }
    if (friesCat) {
      await query('UPDATE categories SET description = $1, sort_order = 13 WHERE id = $2',
        ['Knusprige Fries für jeden Geschmack.', friesCat.id]);
      const fries = [
        ['Pommes Frites', 'pommes-frites', 'Groß', 5.50, 'Kartoffeln', 1, 1, '/images/products/img7.jpg', null],
        ['Chili Cheese Fries', 'chili-cheese-fries', '', 6.90, '', 0, 2, '/images/products/img8.jpg', null],
        ['Hotdog Fries', 'hotdog-fries', '', 8.50, '', 0, 3, '/images/products/img9.jpg', null],
        ['Kroketten', 'kroketten', '10 Stück', 5.90, 'Kartoffeln', 0, 4, '/images/products/img7.jpg', null],
        ['Curly Fries', 'curly-fries', '', 5.90, '', 0, 5, '/images/products/img8.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of fries) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [friesCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Fries Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration NEXO Box 2026-09-04: Kategorie anlegen (falls fehlend) + 3 Boxen per Upsert (idempotent)
  try {
    let boxCat = await get("SELECT * FROM categories WHERE slug = 'nexo-box'");
    if (!boxCat) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        ['NEXO Box', 'nexo-box', 'Gemeinsam genießen & sparen.', 14]
      );
      boxCat = await get("SELECT * FROM categories WHERE slug = 'nexo-box'");
    }
    if (boxCat) {
      await query('UPDATE categories SET description = $1, sort_order = 14 WHERE id = $2',
        ['Gemeinsam genießen & sparen.', boxCat.id]);
      const boxen = [
        ['BOX 1', 'box-1', '2 Cheeseburger oder 2 Chickenburger, 6 Chicken Nuggets, 6 Chicken Wings, Pommes, 3 Saucen', 38.90, '2 Cheeseburger oder 2 Chickenburger, 6 Chicken Nuggets, 6 Chicken Wings, Pommes, 3 Saucen', 1, 1, '/images/products/img16.jpg', null],
        ['BOX 2', 'box-2', 'Pizza Wunsch Ø 30 cm, 2 Cheeseburger oder 2 Chickenburger, 6 Snacks nach Wahl, Pommes, 3 Saucen', 49.90, 'Pizza Wunsch, Cheeseburger oder Chickenburger, Snacks, Pommes, Saucen', 0, 2, '/images/products/img17.jpg', null],
        ['BOX 3', 'box-3', 'Pizza Wunsch Ø 30 cm, 1 Cheeseburger oder 1 Chickenburger, Pasta Wunsch, Pommes, 2 Saucen', 38.90, 'Pizza Wunsch, Cheeseburger oder Chickenburger, Pasta Wunsch, Pommes, Saucen', 0, 3, '/images/products/img18.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of boxen) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [boxCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('NEXO Box Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Kids Menü 2026-09-04: Kategorie anlegen (falls fehlend) + 3 Menüs per Upsert (idempotent)
  try {
    let kidsCat = await get("SELECT * FROM categories WHERE slug = 'kids-menue'");
    if (!kidsCat) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        ['Kids Menü', 'kids-menue', 'Bei allen Kids-Menüs inklusive: Capri-Sun, Überraschungsei.', 15]
      );
      kidsCat = await get("SELECT * FROM categories WHERE slug = 'kids-menue'");
    }
    if (kidsCat) {
      await query('UPDATE categories SET description = $1, sort_order = 15 WHERE id = $2',
        ['Bei allen Kids-Menüs inklusive: Capri-Sun, Überraschungsei.', kidsCat.id]);
      const kids = [
        ['Kids Pizza', 'kids-pizza', 'Pizza Ø 22 cm – bitte wählen: Margherita oder Salami', 7.90, 'Pizza, Margherita oder Salami', 1, 1, '/images/products/img1.jpg', '[{"label":"Margherita","price":7.9},{"label":"Salami","price":7.9}]'],
        ['Kids Nuggets', 'kids-nuggets', '5 Chicken Nuggets, Pommes', 7.50, 'Chicken Nuggets, Pommes', 0, 2, '/images/products/img8.jpg', null],
        ['Happy Fish', 'happy-fish', '4 Happy Fish, Pommes', 7.90, 'Fisch, Pommes', 0, 3, '/images/products/img9.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of kids) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [kidsCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Kids Menü Auto-Migration übersprungen:', e.message);
  }

  // Hero-Buttons (JETZT BESTELLEN) führen in den Warenkorb (nur Standard-Links anfassen)
  try {
    await query("UPDATE hero_slides SET button_link = '/warenkorb' WHERE button_link = '/speisekarte'");
  } catch (e) {
    console.error('Hero-Button-Migration übersprungen:', e.message);
  }

  // Auto-Migration Milkshake 2026-09-04: Kategorie anlegen (falls fehlend) + 5 Shakes per Upsert (idempotent)
  try {
    let shakeCat = await get("SELECT * FROM categories WHERE slug = 'milkshake'");
    if (!shakeCat) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        ['Milkshake', 'milkshake', 'Frisch gemixte Milkshakes.', 16]
      );
      shakeCat = await get("SELECT * FROM categories WHERE slug = 'milkshake'");
    }
    if (shakeCat) {
      await query('UPDATE categories SET description = $1, sort_order = 16 WHERE id = $2',
        ['Frisch gemixte Milkshakes.', shakeCat.id]);
      const shakes = [
        ['Vanille', 'vanille', '', 5.99, '', 0, 1, '/images/products/img22.jpg', null],
        ['Schokolade', 'schokolade', '', 5.99, '', 0, 2, '/images/products/img22.jpg', null],
        ['Banane', 'banane', '', 5.99, '', 0, 3, '/images/products/img22.jpg', null],
        ['Erdbeere', 'erdbeere', '', 5.99, '', 0, 4, '/images/products/img22.jpg', null],
        ['Mix Milkshake', 'mix-milkshake', '2 Sorten nach Wahl gemischt', 6.49, '2 Sorten nach Wahl gemischt', 1, 5, '/images/products/img22.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of shakes) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [shakeCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Milkshake Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Pasta 2026-09-04: 2 alte Pasta löschen, 14 NEXO-Pasta per Upsert (idempotent)
  try {
    const pastaCat = await get("SELECT * FROM categories WHERE slug = 'pasta'");
    if (pastaCat) {
      await query("DELETE FROM products WHERE category_id = $1 AND slug IN ('spaghetti-bolognese','penne-arrabiata')", [pastaCat.id]);
      const pasten = [
        ['NEXO Napoli', 'nexo-napoli', 'Tomatensauce', 8.90, 'Tomatensauce', 1, 1, '/images/products/img10.jpg', null],
        ['NEXO Bolognese', 'nexo-bolognese', 'Rinderhack, Tomatensauce', 9.90, 'Rinderhack, Tomatensauce', 0, 2, '/images/products/img11.jpg', null],
        ['NEXO Feuer', 'nexo-feuer', 'Tomatensauce, Knoblauch, Oliven, Jalapeños', 9.50, 'Tomatensauce, Knoblauch, Oliven, Jalapeños', 0, 3, '/images/products/img10.jpg', null],
        ['NEXO Fusion', 'nexo-fusion', '2 verschiedene Nudelsorten, Hackfleisch, Crème fraîche, Tomatensoße', 11.50, '2 verschiedene Nudelsorten, Hackfleisch, Crème fraîche, Tomatensoße', 0, 4, '/images/products/img11.jpg', null],
        ['NEXO Cheese', 'nexo-cheese', 'Vier Käsesorten in Sahnesauce', 11.50, 'Vier Käsesorten in Sahnesauce', 0, 5, '/images/products/img10.jpg', null],
        ['NEXO Carbonara', 'nexo-carbonara', 'Schinken, Ei, Sahnesauce', 10.50, 'Schinken, Ei, Sahnesauce', 1, 6, '/images/products/img11.jpg', null],
        ['NEXO Pesto', 'nexo-pesto', 'Hähnchen, Mais, Paprika, Basilikumpestosauce', 11.50, 'Hähnchen, Mais, Paprika, Basilikumpestosauce', 0, 7, '/images/products/img10.jpg', null],
        ['NEXO Hawaii', 'pasta-hawaii', 'Hähnchen, Ananas, Curry, Sahnesauce', 11.50, 'Hähnchen, Ananas, Curry, Sahnesauce', 0, 8, '/images/products/img11.jpg', null],
        ['NEXO Gamberi', 'nexo-gamberi', 'Garnelen, Knoblauch, Tomaten, Tomatensauce', 12.90, 'Garnelen, Knoblauch, Tomaten, Tomatensauce', 0, 9, '/images/products/img10.jpg', null],
        ['NEXO Scampi Royal', 'nexo-scampi-royal', 'Scampi, Knoblauch, Tomaten-Sahnesauce', 13.90, 'Scampi, Knoblauch, Tomaten-Sahnesauce', 1, 10, '/images/products/img11.jpg', null],
        ['NEXO Wunsch', 'pasta-wunsch', 'Zwei Zutaten und Sauce nach Wahl', 10.90, 'Zwei Zutaten und Sauce nach Wahl', 0, 11, '/images/products/img10.jpg', null],
        ['NEXO Hähnchen Genuss', 'nexo-haehnchen-genuss', 'Hähnchen, Champignons, Paprika, Zwiebel, Sahnesauce', 11.50, 'Hähnchen, Champignons, Paprika, Zwiebel, Sahnesauce', 0, 12, '/images/products/img11.jpg', null],
        ['NEXO Deluxe', 'pasta-nexo-deluxe', 'Crispy Chicken, Mais, Paprika, Hollandaise, Sahnesauce', 12.90, 'Crispy Chicken, Mais, Paprika, Hollandaise, Sahnesauce', 0, 13, '/images/products/img10.jpg', null],
        ['NEXO Signature', 'nexo-signature', 'Hähnchen, Mais, Brokkoli, Sahnesauce', 12.90, 'Hähnchen, Mais, Brokkoli, Sahnesauce', 0, 14, '/images/products/img11.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of pasten) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [pastaCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Pasta Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Pasta-Deluxe-Fix 2026-09-06: der Pasta-Upsert hat die Pizza-Zeile
  // 'nexo-deluxe' per ON CONFLICT in die Pasta-Kategorie verschoben (mit Pizza-Größen).
  // Pizza-Zeile wiederherstellen + eigene Pasta-Zeile mit eigenem Slug (idempotent).
  try {
    const pizzaCatFix = await get("SELECT * FROM categories WHERE slug = 'pizza'");
    const pastaCatFix = await get("SELECT * FROM categories WHERE slug = 'pasta'");
    if (pizzaCatFix) {
      await query(
        `UPDATE products SET category_id=$1, description='Crème fraîche, Lachs, Paprika, Rucola', price=15.20, ingredients='Crème fraîche, Lachs, Paprika, Rucola', is_featured=0, is_available=1, sort_order=28, sizes=$2, image=COALESCE(products.image, '/images/products/img2.jpg') WHERE slug='nexo-deluxe'`,
        [pizzaCatFix.id, '[{"label":"26 cm","price":15.2},{"label":"30 cm","price":17.5},{"label":"Familien Pizza","price":26.9},{"label":"Party 60x40","price":37.9}]']
      );
    }
    if (pastaCatFix) {
      await query(
        `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
         VALUES ($1,'NEXO Deluxe','pasta-nexo-deluxe','Crispy Chicken, Mais, Paprika, Hollandaise, Sahnesauce',12.90,NULL,'/images/products/img10.jpg','Crispy Chicken, Mais, Paprika, Hollandaise, Sahnesauce',0,1,13,NULL)
         ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=NULL, image=COALESCE(products.image, EXCLUDED.image)`,
        [pastaCatFix.id]
      );
      // Falsche Pasta-Deluxe-Duplikate (mit Pizza-Größen) entfernen
      await query(
        `DELETE FROM products WHERE category_id=$1 AND name='NEXO Deluxe' AND slug != 'pasta-nexo-deluxe' AND sizes IS NOT NULL`,
        [pastaCatFix.id]
      );
    }
  } catch (e) {
    console.error('Pasta-Deluxe-Fix übersprungen:', e.message);
  }

  // Auto-Migration Bild-Komprimierung 2026-09-06: riesige Data-URI-Bilder
  // (z.B. per Datei-Upload) verkleinern, damit die Seiten schnell laden (idempotent)
  try {
    const { shrinkDataUri } = require('./image');
    const jobs = [
      ['hero_slides', 'bg_image'], ['hero_slides', 'main_image'],
      ['hero_slides', 'drink_tl'], ['hero_slides', 'drink_tr'], ['hero_slides', 'drink_br'],
      ['products', 'image'], ['banners', 'image'], ['testimonials', 'image'],
    ];
    for (const [table, col] of jobs) {
      const rows = await all(`SELECT id, ${col} AS val FROM ${table} WHERE ${col} LIKE 'data:image%'`);
      for (const r of rows) {
        if (!r.val || r.val.length < 400 * 1024) continue;
        const smaller = await shrinkDataUri(r.val);
        if (smaller && smaller !== r.val) {
          await query(`UPDATE ${table} SET ${col}=$1 WHERE id=$2`, [smaller, r.id]);
          console.log(`Bild komprimiert: ${table}.${col} id=${r.id} (${Math.round(r.val.length / 1024)}KB -> ${Math.round(smaller.length / 1024)}KB)`);
        }
      }
    }
  } catch (e) {
    console.error('Bild-Komprimierung übersprungen:', e.message);
  }

  // Auto-Migration Eigentümer-Bereich 2026-09-06: Soft-Delete für Bestellungen +
  // Rollen für Admins (bestehende Admins werden Eigentümer). Idempotent.
  try {
    await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_deleted INTEGER DEFAULT 0');
    await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP');
    await query('ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT');
    await query("UPDATE admins SET role = 'owner' WHERE role IS NULL OR role = ''");
    await query("ALTER TABLE admins ALTER COLUMN role SET DEFAULT 'manager'");
  } catch (e) {
    console.error('Eigentümer-Migration übersprungen:', e.message);
  }

  // Auto-Migration Croque-Saucen 2026-09-06: 1 Sauce nach Wahl (inklusive) als Auswahl.
  // Saucenliste kommt aus der Kategorie Saucen & Dips (nur setzen, wenn noch keine Auswahl da ist).
  try {
    const sauceCat = await get("SELECT id FROM categories WHERE slug = 'saucen-dips'");
    const croqueCat = await get("SELECT id FROM categories WHERE slug = 'croque'");
    if (sauceCat && croqueCat) {
      const sauces = await all('SELECT name FROM products WHERE category_id = $1 AND is_available = 1 ORDER BY sort_order', [sauceCat.id]);
      const croques = await all('SELECT id, price FROM products WHERE category_id = $1 AND sizes IS NULL', [croqueCat.id]);
      for (const c of croques) {
        const opts = sauces.map(s => ({ label: 'Sauce: ' + s.name, price: parseFloat(c.price) }));
        if (opts.length) {
          await query('UPDATE products SET sizes = $1 WHERE id = $2', [JSON.stringify(opts), c.id]);
        }
      }
    }
  } catch (e) {
    console.error('Croque-Saucen übersprungen:', e.message);
  }

  // Auto-Migration Salat-Dressing 2026-09-06: 1 Dressing nach Wahl (inklusive) als Auswahl.
  // Nur setzen, wenn noch keine Auswahl da ist.
  try {
    const salatCat = await get("SELECT id FROM categories WHERE slug = 'salat'");
    if (salatCat) {
      const dressings = ['Knoblauch', 'Hausdressing', 'Yoghurt', 'American', 'Kräuter'];
      const salate = await all('SELECT id, price FROM products WHERE category_id = $1 AND sizes IS NULL', [salatCat.id]);
      for (const s of salate) {
        const opts = dressings.map(d => ({ label: 'Dressing: ' + d, price: parseFloat(s.price) }));
        await query('UPDATE products SET sizes = $1 WHERE id = $2', [JSON.stringify(opts), s.id]);
      }
    }
  } catch (e) {
    console.error('Salat-Dressing übersprungen:', e.message);
  }

  // Auto-Migration Schnitzel-Beilage 2026-09-06: 1 Beilage nach Wahl (Pommes oder Kroketten, inklusive).
  // Nur setzen, wenn noch keine Auswahl da ist.
  try {
    const schnitzelCat = await get("SELECT id FROM categories WHERE slug = 'schnitzel'");
    if (schnitzelCat) {
      const beilagen = ['Pommes', 'Kroketten'];
      const schnitzel = await all('SELECT id, price FROM products WHERE category_id = $1 AND sizes IS NULL', [schnitzelCat.id]);
      for (const s of schnitzel) {
        const opts = beilagen.map(b => ({ label: 'Beilage: ' + b, price: parseFloat(s.price) }));
        await query('UPDATE products SET sizes = $1 WHERE id = $2', [JSON.stringify(opts), s.id]);
      }
    }
  } catch (e) {
    console.error('Schnitzel-Beilage übersprungen:', e.message);
  }

  // Auto-Migration Rings-Sauce 2026-09-06: 1 Sauce nach Wahl (inklusive) aus Saucen & Dips.
  // Nur setzen, wenn noch keine Auswahl da ist.
  try {
    const sauceCat2 = await get("SELECT id FROM categories WHERE slug = 'saucen-dips'");
    const ringsCat = await get("SELECT id FROM categories WHERE slug = 'rings'");
    if (sauceCat2 && ringsCat) {
      const sauces2 = await all('SELECT name FROM products WHERE category_id = $1 AND is_available = 1 ORDER BY sort_order', [sauceCat2.id]);
      const rings = await all('SELECT id, price FROM products WHERE category_id = $1 AND sizes IS NULL', [ringsCat.id]);
      for (const r of rings) {
        const opts = sauces2.map(s => ({ label: 'Sauce: ' + s.name, price: parseFloat(r.price) }));
        if (opts.length) {
          await query('UPDATE products SET sizes = $1 WHERE id = $2', [JSON.stringify(opts), r.id]);
        }
      }
    }
  } catch (e) {
    console.error('Rings-Sauce übersprungen:', e.message);
  }

  // Auto-Migration Bowls-Beilage 2026-09-06: 1 Beilage nach Wahl (Reis oder Pommes, inklusive).
  // Nur setzen, wenn noch keine Auswahl da ist.
  try {
    const bowlsCat = await get("SELECT id FROM categories WHERE slug = 'bowls'");
    if (bowlsCat) {
      const beilagen2 = ['Reis', 'Pommes'];
      const bowls = await all('SELECT id, price FROM products WHERE category_id = $1 AND sizes IS NULL', [bowlsCat.id]);
      for (const b of bowls) {
        const opts = beilagen2.map(x => ({ label: 'Beilage: ' + x, price: parseFloat(b.price) }));
        await query('UPDATE products SET sizes = $1 WHERE id = $2', [JSON.stringify(opts), b.id]);
      }
    }
  } catch (e) {
    console.error('Bowls-Beilage übersprungen:', e.message);
  }

  // Auto-Migration Dessert-Auswahl 2026-09-06: Oreo Donut/Muffin + Frucht-Auswahl (Crepe Frucht).
  // Schoko-Boxen (2 Pflicht) kommen aus Code (choco-box), keine DB-Änderung nötig.
  // Nur Größen setzen, wo noch keine sind.
  try {
    await query(`UPDATE products SET sizes = $1 WHERE slug = 'oreo-choice' AND sizes IS NULL`,
      ['[{"label":"Oreo Donut","price":3.9},{"label":"Oreo Muffin","price":3.9}]']);
    const fr = await get("SELECT id, price FROM products WHERE slug = 'crepe-frucht'");
    if (fr) {
      const fopts = ['Banane', 'Erdbeeren', 'Kiwi'].map(n => ({ label: n, price: parseFloat(fr.price) }));
      await query('UPDATE products SET sizes = $1 WHERE id = $2 AND sizes IS NULL', [JSON.stringify(fopts), fr.id]);
    }
  } catch (e) {
    console.error('Dessert-Auswahl übersprungen:', e.message);
  }

  // Textfix BOX 2: "Snack Rolls" → "Snacks" (Auswahl aus der Snacks-Karte)
  try {
    await query("UPDATE products SET description = REPLACE(description, '6 Snack Rolls nach Wahl', '6 Snacks nach Wahl') WHERE slug = 'box-2'");
  } catch (e) {
    console.error('Box-Textfix übersprungen:', e.message);
  }

  // Box-Reparatur: kanonische BOX-Zeilen (Slug box-1/2/3) sicherstellen.
  // Per Admin neu angelegte "BOX"-Duplikate (anderer Slug → keine Konfiguration) entfernen.
  try {
    const boxCat = await get("SELECT id FROM categories WHERE slug = 'nexo-box'");
    if (boxCat) {
      const canon = [
        ['BOX 1', 'box-1', '2 Cheeseburger oder 2 Chickenburger, 6 Chicken Nuggets, 6 Chicken Wings, Pommes, 3 Saucen', 38.90, '2 Cheeseburger oder 2 Chickenburger, 6 Chicken Nuggets, 6 Chicken Wings, Pommes, 3 Saucen', 1, 1, '/images/products/img16.jpg'],
        ['BOX 2', 'box-2', 'Pizza Wunsch Ø 30 cm, 2 Cheeseburger oder 2 Chickenburger, 6 Snacks nach Wahl, Pommes, 3 Saucen', 49.90, 'Pizza Wunsch, Cheeseburger oder Chickenburger, Snacks, Pommes, Saucen', 0, 2, '/images/products/img17.jpg'],
        ['BOX 3', 'box-3', 'Pizza Wunsch Ø 30 cm, 1 Cheeseburger oder 1 Chickenburger, Pasta Wunsch, Pommes, 2 Saucen', 38.90, 'Pizza Wunsch, Cheeseburger oder Chickenburger, Pasta Wunsch, Pommes, Saucen', 0, 3, '/images/products/img18.jpg'],
      ];
      for (const [name, slug, desc, price, ingr, feat, sort, img] of canon) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,NULL)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), sort_order=EXCLUDED.sort_order, image=COALESCE(products.image, EXCLUDED.image)`,
          [boxCat.id, name, slug, desc, price, img, ingr, feat, sort]
        );
        await query('DELETE FROM products WHERE name = $1 AND slug != $2', [name, slug]);
      }
    }
  } catch (e) {
    console.error('Box-Reparatur übersprungen:', e.message);
  }

  // Konsistenz: Namens-Duplikate auf einen Status bringen (wenn eines geschlossen, alle schließen).
  // Sonst zeigen Admin (neueste Zeile) und Menü (älteste verfügbare Zeile) Unterschiedliches.
  try {
    const dupes = await all(`SELECT name FROM products GROUP BY name HAVING COUNT(*) > 1`);
    for (const d of dupes) {
      await query('UPDATE products SET is_available = (SELECT MIN(COALESCE(is_available, 0)) FROM products WHERE name = $1) WHERE name = $1', [d.name]);
      console.log('Duplikat-Status vereinheitlicht:', d.name);
    }
  } catch (e) {
    console.error('Duplikat-Fix übersprungen:', e.message);
  }

  // Auto-Migration Burger-Menü 2026-09-06: Solo oder Menü (+5 €, Pommes + 0,33l Softdrink nach Wahl).
  // Nur setzen, wenn noch keine Auswahl da ist.
  try {
    const burgerCat = await get("SELECT id FROM categories WHERE slug = 'burger'");
    if (burgerCat) {
      const drinks = ['Coca-Cola', 'Fanta', 'Sprite', 'Mezzo Mix', 'Coca-Cola Zero'];
      const burgers = await all('SELECT id, price FROM products WHERE category_id = $1 AND sizes IS NULL', [burgerCat.id]);
      for (const b of burgers) {
        const base = parseFloat(b.price);
        const opts = [];
        for (const d of drinks) {
          opts.push({ label: 'Menü mit ' + d, price: parseFloat((base + 5).toFixed(2)) });
        }
        await query('UPDATE products SET sizes = $1 WHERE id = $2', [JSON.stringify(opts), b.id]);
      }
    }
  } catch (e) {
    console.error('Burger-Menü übersprungen:', e.message);
  }

  // Auto-Migration Burger-Solo-Entfernen 2026-09-06: Solo ist kein Standard mehr,
  // Menü nur auf Wunsch. Solo-Option aus allen Burger-Auswahlen entfernen.
  try {
    const burgerCat3 = await get("SELECT id FROM categories WHERE slug = 'burger'");
    if (burgerCat3) {
      const rows = await all('SELECT id, sizes FROM products WHERE category_id = $1 AND sizes IS NOT NULL', [burgerCat3.id]);
      for (const r of rows) {
        try {
          const arr = JSON.parse(r.sizes);
          if (!Array.isArray(arr)) continue;
          const filtered = arr.filter(o => o.label !== 'Solo');
          if (filtered.length && filtered.length !== arr.length) {
            await query('UPDATE products SET sizes = $1 WHERE id = $2', [JSON.stringify(filtered), r.id]);
          }
        } catch (e) { /* ungültiges JSON ignorieren */ }
      }
    }
  } catch (e) {
    console.error('Burger-Solo-Entfernen übersprungen:', e.message);
  }

  // Auto-Migration Burger-Menü-Update 2026-09-06: Solo-Option entfernen, nur Menü mit Softdrink-Auswahl.
  try {
    const burgerCat2 = await get("SELECT id FROM categories WHERE slug = 'burger'");
    if (burgerCat2) {
      const rows = await all('SELECT id, sizes FROM products WHERE category_id = $1 AND sizes IS NOT NULL', [burgerCat2.id]);
      for (const r of rows) {
        try {
          const arr = JSON.parse(r.sizes);
          if (!Array.isArray(arr)) continue;
          const filtered = arr.filter(o => o.label !== 'Solo');
          if (filtered.length && filtered.length !== arr.length) {
            await query('UPDATE products SET sizes = $1 WHERE id = $2', [JSON.stringify(filtered), r.id]);
          }
        } catch (e) { /* ungültiges JSON ignorieren */ }
      }
    }
  } catch (e) {
    console.error('Burger-Menü-Update übersprungen:', e.message);
  }

  // Auto-Migration Schnitzel 2026-09-04: altes Wiener Schnitzel löschen, 4 neue per Upsert (idempotent)
  try {
    const schnitzelCat = await get("SELECT * FROM categories WHERE slug = 'schnitzel'");
    if (schnitzelCat) {
      await query('UPDATE categories SET description = $1 WHERE id = $2',
        ['Inklusive Pommes oder Kroketten.', schnitzelCat.id]);
      await query("DELETE FROM products WHERE category_id = $1 AND slug IN ('wiener-schnitzel')", [schnitzelCat.id]);
      const schnitzel = [
        ['Schnitzel Wiener Art', 'schnitzel-wiener-art', 'Schnitzel, Zitrone', 13.90, 'Schnitzel, Zitrone', 1, 1, '/images/products/img16.jpg', null],
        ['Jägerschnitzel', 'jaegerschnitzel', 'Schnitzel, Champignons, Jägersauce', 15.90, 'Schnitzel, Champignons, Jägersauce', 0, 2, '/images/products/img17.jpg', null],
        ['Zigeunerschnitzel', 'zigeunerschnitzel', 'Schnitzel, Paprika, Zwiebeln, Paprikasauce', 15.90, 'Schnitzel, Paprika, Zwiebeln, Paprikasauce', 0, 3, '/images/products/img18.jpg', null],
        ['Schnitzel Hollandaise', 'schnitzel-hollandaise', 'Schnitzel, Brokkoli, Sauce Hollandaise', 16.90, 'Schnitzel, Brokkoli, Sauce Hollandaise', 1, 4, '/images/products/img16.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of schnitzel) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [schnitzelCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Schnitzel Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Saucen 2026-09-04: 4 alte Saucen löschen, 7 neue je 2,00 € per Upsert (idempotent)
  try {
    const saucenCat = await get("SELECT * FROM categories WHERE slug = 'saucen-dips'");
    if (saucenCat) {
      await query('UPDATE categories SET description = $1 WHERE id = $2',
        ['Alle Saucen je 2,00 €.', saucenCat.id]);
      await query("DELETE FROM products WHERE category_id = $1 AND slug IN ('ketchup','mayonnaise','knoblauchsauce','chillisauce')", [saucenCat.id]);
      const saucen = [
        ['Knoblauch', 'knoblauch', '', 2.00, '', 0, 1, '/images/products/img9.jpg', null],
        ['American', 'american', '', 2.00, '', 0, 2, '/images/products/img12.jpg', null],
        ['Remoulade', 'remoulade', '', 2.00, '', 0, 3, '/images/products/img9.jpg', null],
        ['NEXO Haus', 'nexo-haus', 'Unsere Haussauce', 2.00, 'Unsere Haussauce', 1, 4, '/images/products/img12.jpg', null],
        ['Chili', 'chili', '', 2.00, '', 0, 5, '/images/products/img9.jpg', null],
        ['BBQ', 'bbq-sauce', '', 2.00, '', 0, 6, '/images/products/img12.jpg', null],
        ['Curry', 'curry', '', 2.00, '', 0, 7, '/images/products/img9.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of saucen) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [saucenCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Saucen Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Salat 2026-09-04: 2 alte Salate löschen, 6 neue per Upsert (idempotent)
  try {
    const salatCat = await get("SELECT * FROM categories WHERE slug = 'salat'");
    if (salatCat) {
      await query('UPDATE categories SET description = $1 WHERE id = $2',
        ['Frische Salate mit Dressing nach Wahl: Knoblauch, Hausdressing, Yoghurt, American, Kräuter.', salatCat.id]);
      await query("DELETE FROM products WHERE category_id = $1 AND slug IN ('griechischer-salat','caesar-salat')", [salatCat.id]);
      const salate = [
        ['Gemischter Salat', 'gemischter-salat', 'Eisbergsalat, Tomaten, Gurken, Mais. Dressing nach Wahl.', 7.90, 'Eisbergsalat, Tomaten, Gurken, Mais', 0, 1, '/images/products/img4.jpg', null],
        ['Chicken Salat', 'chicken-salat', 'Gemischter Salat, gegrillte Hähnchenbrust. Dressing nach Wahl.', 10.90, 'Gemischter Salat, gegrillte Hähnchenbrust', 1, 2, '/images/products/img5.jpg', null],
        ['Chef Salat', 'chef-salat', 'Gemischter Salat, Schinken, Thunfisch, gekochtes Ei. Dressing nach Wahl.', 11.90, 'Gemischter Salat, Schinken, Thunfisch, gekochtes Ei', 1, 3, '/images/products/img4.jpg', null],
        ['Cheese Salat', 'cheese-salat', 'Gemischter Salat, 3 verschiedene Käsesorten. Dressing nach Wahl.', 10.90, 'Gemischter Salat, 3 verschiedene Käsesorten', 0, 4, '/images/products/img5.jpg', null],
        ['Tuna Salat', 'tuna-salat', 'Gemischter Salat, Thunfisch, Zwiebeln, Oliven. Dressing nach Wahl.', 10.50, 'Gemischter Salat, Thunfisch, Zwiebeln, Oliven', 0, 5, '/images/products/img4.jpg', null],
        ['Wunsch Salat', 'wunsch-salat', 'Gemischter Salat, 3 Zutaten nach Wahl. Dressing nach Wahl.', 11.90, 'Gemischter Salat, 3 Zutaten nach Wahl', 0, 6, '/images/products/img5.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of salate) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [salatCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Salat Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Snacks 2026-09-04: alte Snacks löschen, 12 neue per Upsert (idempotent)
  try {
    const snacksCat = await get("SELECT * FROM categories WHERE slug = 'snacks'");
    if (snacksCat) {
      await query('UPDATE categories SET description = $1 WHERE id = $2',
        ['Menü-Aufpreis +4,00 €: mit Pommes und 0,33 l Softdrink nach Wahl.', snacksCat.id]);
      await query("DELETE FROM products WHERE category_id = $1 AND slug IN ('pommes-frites','nachos')", [snacksCat.id]);
      const S6 = (a, b) => JSON.stringify([{ label: '6 Stk.', price: a }, { label: '12 Stk.', price: b }]);
      const snacks = [
        ['Currywurst mit Pommes', 'currywurst-pommes', 'Mit Pommes', 8.90, 'Wurst, Curry, Pommes', 1, 1, '/images/products/img7.jpg', null],
        ['Chicken Nuggets', 'chicken-nuggets', '6 oder 12 Stück', 6.90, 'Hähnchen, Panade', 1, 2, '/images/products/img8.jpg', S6(6.90, 10.90)],
        ['Chicken Wings', 'chicken-wings', '6 oder 12 Stück', 7.90, 'Hähnchen', 0, 3, '/images/products/img9.jpg', S6(7.90, 12.90)],
        ['Chili Cheese Nuggets', 'chili-cheese-nuggets', '6 oder 12 Stück', 6.90, 'Hähnchen, Chili, Käse', 0, 4, '/images/products/img7.jpg', S6(6.90, 10.90)],
        ['Baked Feta', 'baked-feta', '6 oder 12 Stück', 7.90, 'Feta', 0, 5, '/images/products/img8.jpg', S6(7.90, 11.90)],
        ['Chicken Strips', 'chicken-strips', '6 oder 12 Stück', 8.50, 'Hähnchen', 0, 6, '/images/products/img9.jpg', S6(8.50, 13.90)],
        ['Frühlingsrollen', 'fruehlingsrollen', '6 oder 12 Stück', 5.90, 'Teig, Gemüse', 0, 7, '/images/products/img7.jpg', S6(5.90, 9.90)],
        ['Mozzarella Sticks', 'mozzarella-sticks', '6 oder 12 Stück', 6.90, 'Mozzarella, Panade', 0, 8, '/images/products/img8.jpg', S6(6.90, 11.90)],
        ['Zwiebelringe', 'zwiebelringe', '6 oder 12 Stück', 5.50, 'Zwiebeln, Panade', 0, 9, '/images/products/img9.jpg', S6(5.50, 9.50)],
        ['Shrimps', 'shrimps', '6 oder 12 Stück', 8.50, 'Shrimps, Panade', 0, 10, '/images/products/img7.jpg', S6(8.50, 13.90)],
        ['Muslitos', 'muslitos', '6 oder 12 Stück', 8.50, 'Muslitos, Panade', 0, 11, '/images/products/img8.jpg', S6(8.50, 13.90)],
        ['Corn Dog', 'corn-dog', 'Klein oder Groß', 2.99, 'Würstchen, Maisteig', 0, 12, '/images/products/img9.jpg', JSON.stringify([{ label: 'Klein', price: 2.99 }, { label: 'Groß', price: 5.90 }])],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of snacks) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=EXCLUDED.sizes, image=COALESCE(products.image, EXCLUDED.image)`,
          [snacksCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Snacks Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Rings 2026-09-04: Kategorie anlegen (falls fehlend) + 4 Rings per Upsert (idempotent)
  // ① Käsering 10,90 € / ② Bacon Ring 12,90 € / ③ Chicken Ring 12,90 € / ④ Feuerring 13,90 €
  // Inklusive 1 Sauce nach Wahl
  try {
    let ringsCat = await get("SELECT * FROM categories WHERE slug = 'rings'");
    if (!ringsCat) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        ['Rings', 'rings', 'Inklusive 1 Sauce nach Wahl.', 17]
      );
      ringsCat = await get("SELECT * FROM categories WHERE slug = 'rings'");
    }
    if (ringsCat) {
      await query('UPDATE categories SET name = $1, description = $2, sort_order = 17, active = 1 WHERE id = $3',
        ['Rings', 'Inklusive 1 Sauce nach Wahl.', ringsCat.id]);
      const rings = [
        ['① Käsering', 'kaesering', 'Käsefüllung', 10.90, 'Käsefüllung', 1, 1, '/images/products/img7.jpg', null],
        ['② Bacon Ring', 'bacon-ring', 'Bacon · Hackfleisch · BBQ-Sauce · Käsefüllung', 12.90, 'Bacon · Hackfleisch · BBQ-Sauce · Käsefüllung', 1, 2, '/images/products/img8.jpg', null],
        ['③ Chicken Ring', 'chicken-ring', 'Hähnchen · Hollandaise · Käsefüllung', 12.90, 'Hähnchen · Hollandaise · Käsefüllung', 0, 3, '/images/products/img9.jpg', null],
        ['④ Feuerring', 'feuerring', 'Hackfleisch · Jalapeños · Hollandaise · Feta · Käsefüllung', 13.90, 'Hackfleisch · Jalapeños · Hollandaise · Feta · Käsefüllung', 1, 4, '/images/products/img7.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of rings) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [ringsCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Rings Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Hero Deals 2026-09-05: 2 Angebots-Produkte (mit Abholung/Lieferung-Größen) per Upsert (idempotent)
  // + Hero-Buttons auf Direkt-Add (/warenkorb?add=slug) umstellen, damit JETZT BESTELLEN den Deal in den Warenkorb legt
  try {
    let boxCat = await get("SELECT * FROM categories WHERE slug = 'nexo-box'");
    if (!boxCat) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        ['NEXO Box', 'nexo-box', 'Gemeinsam genießen & sparen.', 14]
      );
      boxCat = await get("SELECT * FROM categories WHERE slug = 'nexo-box'");
    }
    if (boxCat) {
      const deals = [
        ['1 Grosse Pizza + 3 Getränke', 'deal-grosse-pizza-getraenke', '1 große Pizza (3 Beläge nach Wahl) + 3 Getränke (0,33 l) nach Wahl', 24.99, 'Pizza, 3 Beläge nach Wahl, 3 Getränke (0,33 l)', 1, 10, '/images/products/img2.jpg', JSON.stringify([{ label: 'Abholung', price: 24.99 }, { label: 'Lieferung', price: 26.99 }])],
        ['Mix or Match Combo Deal', 'deal-mix-match', '1 Burger, 1 kleine Pommes, 1 Dip und 1 Getränk (0,33 l)', 9.99, 'Burger, Pommes, Dip, Getränk (0,33 l)', 0, 11, '/images/products/img14.jpg', JSON.stringify([{ label: 'Abholung', price: 9.99 }, { label: 'Lieferung', price: 11.99 }])],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of deals) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=EXCLUDED.sizes, image=COALESCE(products.image, EXCLUDED.image)`,
          [boxCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
    // Nur plain /warenkorb-Links der beiden Standard-Slides auf Direkt-Add umstellen (Admin-Anpassungen bleiben erhalten)
    await query("UPDATE hero_slides SET button_link = '/warenkorb?add=deal-grosse-pizza-getraenke' WHERE button_link = '/warenkorb' AND sort_order = 0 AND (line2 = 'PIZZA' OR line1 = '1 GROSSE')");
    await query("UPDATE hero_slides SET button_link = '/warenkorb?add=deal-mix-match' WHERE button_link = '/warenkorb' AND sort_order = 1 AND line2 = 'COMBO DEAL'");
  } catch (e) {
    console.error('Hero-Deals Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Hero Hamburger-Deal 2026-09-05: Produkt für "1 GROSSE Hambuger + 1 GETRÄNK" (19,99/21,99)
  // + Slides per Inhalt (nicht per Position) dem passenden Deal zuordnen, damit jede Anzeige ihre eigenen Preise zeigt
  try {
    const boxCat2 = await get("SELECT * FROM categories WHERE slug = 'nexo-box'");
    if (boxCat2) {
      await query(
        `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
         ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=EXCLUDED.sizes, image=COALESCE(products.image, EXCLUDED.image)`,
        [boxCat2.id, '1 Grosser Hamburger + 1 Getränk', 'deal-grosse-hamburger-getraenk', '1 großer Hamburger + 1 Getränk (0,33 l) nach Wahl', 19.99, '/images/products/img14.jpg', 'Hamburger, 1 Getränk (0,33 l)', 0, 12, JSON.stringify([{ label: 'Abholung', price: 19.99 }, { label: 'Lieferung', price: 21.99 }])]
      );
    }
    // Burger-Anzeige (auch mit Tippfehler "Hambuger") -> Hamburger-Deal; Pizza-Anzeige -> Pizza-Deal; Combo -> Mix-Deal
    // (Night-Anzeigen ausgenommen: sie bekommen unten ihren eigenen Deal)
    await query("UPDATE hero_slides SET button_link = '/warenkorb?add=deal-grosse-hamburger-getraenk' WHERE (button_link = '/warenkorb' OR button_link LIKE '/warenkorb?add=%') AND (line2 ILIKE '%ambuger%' OR line2 ILIKE '%burger%') AND line1 NOT ILIKE '%night%' AND line2 NOT ILIKE '%night%'");
    await query("UPDATE hero_slides SET button_link = '/warenkorb?add=deal-grosse-pizza-getraenke' WHERE (button_link = '/warenkorb' OR button_link LIKE '/warenkorb?add=%') AND line2 ILIKE '%pizza%' AND line1 NOT ILIKE '%night%' AND line2 NOT ILIKE '%night%'");
    await query("UPDATE hero_slides SET button_link = '/warenkorb?add=deal-mix-match' WHERE button_link = '/warenkorb' AND line2 ILIKE '%combo%'");
  } catch (e) {
    console.error('Hamburger-Deal Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Night Hero-Deal: eigene Anzeige (Night Deal 5,99 €, nur Abholung) bekommt eigenes Produkt
  // Jede Night-Anzeige zeigt damit ihre eigenen Preise statt der alten Pizza-Preise
  try {
    const boxCat3 = await get("SELECT * FROM categories WHERE slug = 'nexo-box'");
    if (boxCat3) {
      await query(
        `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
         ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=EXCLUDED.sizes, image=COALESCE(products.image, EXCLUDED.image)`,
        [boxCat3.id, 'Night Deal · Pizza Ø 26', 'deal-night-abholung', 'Pizza Ø 26 cm nach Wunsch, bis zu 3 Beläge + 1 Sauce nach Wahl (Fisch & Käserand ausgeschlossen). Nur für Abholer, ab 21:00 Uhr.', 5.99, '/images/products/img3.jpg', 'Pizza 26 cm, 3 Beläge, 1 Sauce nach Wahl', 0, 13, JSON.stringify([{ label: 'Abholung', price: 5.99 }])]
      );
    }
    await query("UPDATE hero_slides SET button_link = '/warenkorb?add=deal-night-abholung' WHERE (button_link = '/warenkorb' OR button_link LIKE '/warenkorb?add=%') AND (line1 ILIKE '%night%' OR line2 ILIKE '%night%' OR line3 ILIKE '%night%')");
  } catch (e) {
    console.error('Night Hero-Deal Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Getränke 2026-09-05: alte Getränke durch Softgetränke-Preisliste ersetzen (idempotent)
  // 0,33 l Dose / 1,0 l: Coca-Cola, Zero, Fanta, Sprite, Mezzo Mix (2,40 / 5,90 €) · 0,5 l Durstlöscher 2,00 € · Red Bull 3,50 €
  try {
    const getrCat = await get("SELECT * FROM categories WHERE slug = 'getraenke'");
    if (getrCat) {
      await query('UPDATE categories SET name = $1, description = $2 WHERE id = $3',
        ['Getränke', 'Softgetränke: Coca-Cola, Fanta, Sprite, Mezzo Mix, Durstlöscher und Red Bull.', getrCat.id]);
      await query("DELETE FROM products WHERE category_id = $1 AND slug IN ('coca-cola','fanta','wasser')", [getrCat.id]);
      const SD = (a, b) => JSON.stringify([{ label: '0,33 l Dose', price: a }, { label: '1,0 l', price: b }]);
      const softgetraenke = [
        ['Coca-Cola', 'coca-cola', '0,33 l Dose oder 1,0 l Flasche', 2.40, '0,33 l Dose oder 1,0 l Flasche', 1, 1, '/images/products/img22.jpg', SD(2.40, 5.90)],
        ['Coca-Cola Zero', 'coca-cola-zero', '0,33 l Dose oder 1,0 l Flasche', 2.40, '0,33 l Dose oder 1,0 l Flasche', 0, 2, '/images/products/img22.jpg', SD(2.40, 5.90)],
        ['Fanta', 'fanta', '0,33 l Dose oder 1,0 l Flasche', 2.40, '0,33 l Dose oder 1,0 l Flasche', 0, 3, '/images/products/img23.jpg', SD(2.40, 5.90)],
        ['Sprite', 'sprite', '0,33 l Dose oder 1,0 l Flasche', 2.40, '0,33 l Dose oder 1,0 l Flasche', 0, 4, '/images/products/img23.jpg', SD(2.40, 5.90)],
        ['Mezzo Mix', 'mezzo-mix', '0,33 l Dose oder 1,0 l Flasche', 2.40, '0,33 l Dose oder 1,0 l Flasche', 0, 5, '/images/products/img22.jpg', SD(2.40, 5.90)],
        ['Durstlöscher', 'durstloescher', '0,5 l', 2.00, '0,5 l', 0, 6, '/images/products/img6.jpg', null],
        ['Red Bull', 'red-bull', '0,25 l Dose', 3.50, '0,25 l Dose', 0, 7, '/images/products/img23.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of softgetraenke) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=EXCLUDED.sizes, image=COALESCE(products.image, EXCLUDED.image)`,
          [getrCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Getränke Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Wraps 2026-09-05: Kategorie anlegen (falls fehlend) + 4 Wraps per Upsert (idempotent)
  // ① Teriyaki Chicken 9,90 € / ② Crispy Chicken 9,90 € / ③ BBQ Beef 10,90 € / ④ Spicy Crispy Chicken 10,90 €
  try {
    let wrapsCat = await get("SELECT * FROM categories WHERE slug = 'wraps'");
    if (!wrapsCat) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        ['Wraps', 'wraps', 'Frisch gerollte Wraps mit knackigem Salat.', 18]
      );
      wrapsCat = await get("SELECT * FROM categories WHERE slug = 'wraps'");
    }
    if (wrapsCat) {
      await query('UPDATE categories SET name = $1, description = $2, sort_order = 18, active = 1 WHERE id = $3',
        ['Wraps', 'Frisch gerollte Wraps mit knackigem Salat.', wrapsCat.id]);
      const wraps = [
        ['① Teriyaki Chicken Wrap', 'teriyaki-chicken-wrap', 'Chicken · Salat · Tomate · rote Zwiebeln · Karotten · Sesam', 9.90, 'Chicken · Salat · Tomate · rote Zwiebeln · Karotten · Sesam', 1, 1, '/images/products/img8.jpg', null],
        ['② Crispy Chicken Wrap', 'crispy-chicken-wrap', 'Crispy Chicken · Salat · Tomate · rote Zwiebeln · Cheddar', 9.90, 'Crispy Chicken · Salat · Tomate · rote Zwiebeln · Cheddar', 0, 2, '/images/products/img7.jpg', null],
        ['③ BBQ Beef Wrap', 'bbq-beef-wrap', 'Beef · Salat · Tomate · rote Zwiebeln · Cheddar · Bacon · Röstzwiebeln', 10.90, 'Beef · Salat · Tomate · rote Zwiebeln · Cheddar · Bacon · Röstzwiebeln', 0, 3, '/images/products/img9.jpg', null],
        ['④ Spicy Crispy Chicken Wrap', 'spicy-crispy-chicken-wrap', 'Crispy Chicken · Salat · Tomate · rote Zwiebeln · Cheddar · Jalapeños · Röstzwiebeln', 10.90, 'Crispy Chicken · Salat · Tomate · rote Zwiebeln · Cheddar · Jalapeños · Röstzwiebeln', 1, 4, '/images/products/img8.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of wraps) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [wrapsCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Wraps Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Bowls 2026-09-05: Kategorie anlegen (falls fehlend) + 4 Bowls per Upsert (idempotent)
  // ① Teriyaki Chicken 15,90 € / ② Crispy Chicken 16,90 € / ③ Beef Bacon 18,90 € / ④ NEXO Scampi 18,90 €
  // Beilage: Reis oder Pommes · 1 Sauce inklusive (NEXO Haus, Knoblauch, BBQ, American, Cheddar), jede weitere +0,80 €
  try {
    let bowlsCat = await get("SELECT * FROM categories WHERE slug = 'bowls'");
    if (!bowlsCat) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        ['Bowls', 'bowls', 'Beilage nach Wahl: Reis oder Pommes. 1 Sauce inklusive, jede weitere +0,80 €.', 19]
      );
      bowlsCat = await get("SELECT * FROM categories WHERE slug = 'bowls'");
    }
    if (bowlsCat) {
      await query('UPDATE categories SET name = $1, description = $2, sort_order = 19, active = 1 WHERE id = $3',
        ['Bowls', 'Beilage nach Wahl: Reis oder Pommes. Sauce nach Wahl: NEXO Haussoße, Knoblauchsoße, BBQ-Soße, American-Soße oder Cheddar-Soße. 1 Sauce inklusive, jede weitere +0,80 €.', bowlsCat.id]);
      const bowls = [
        ['① Teriyaki Chicken Bowl', 'teriyaki-chicken-bowl', 'Teriyaki Chicken · Mais · Karotten · Sesam. Beilage nach Wahl: Reis oder Pommes.', 15.90, 'Teriyaki Chicken · Mais · Karotten · Sesam', 1, 1, '/images/products/img4.jpg', null],
        ['② Crispy Chicken Bowl', 'crispy-chicken-bowl', 'Crispy Chicken · Cheddar · Röstzwiebeln · Mais · Karotten · Sesam. Beilage nach Wahl: Reis oder Pommes.', 16.90, 'Crispy Chicken · Cheddar · Röstzwiebeln · Mais · Karotten · Sesam', 0, 2, '/images/products/img5.jpg', null],
        ['③ Beef Bacon Bowl', 'beef-bacon-bowl', 'Rinderstreifen · Bacon · Cheddar · Mais · Karotten · Sesam. Beilage nach Wahl: Reis oder Pommes.', 18.90, 'Rinderstreifen · Bacon · Cheddar · Mais · Karotten · Sesam', 0, 3, '/images/products/img4.jpg', null],
        ['④ NEXO Scampi Bowl', 'nexo-scampi-bowl', 'Gegrillte Scampi · Knoblauch · Mais · Karotten · Sesam. Beilage nach Wahl: Reis oder Pommes.', 18.90, 'Gegrillte Scampi · Knoblauch · Mais · Karotten · Sesam', 1, 4, '/images/products/img5.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of bowls) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [bowlsCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Bowls Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration Pizza Brötchen 2026-09-05: Kategorie anlegen (falls fehlend) + 7 Sorten per Upsert (idempotent)
  // 6 oder 12 Stück, inklusive 1 Sauce nach Wahl
  try {
    let broetchenCat = await get("SELECT * FROM categories WHERE slug = 'pizza-broetchen'");
    if (!broetchenCat) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        ['Pizza Brötchen', 'pizza-broetchen', '6 oder 12 Stück. Inklusive 1 Sauce nach Wahl.', 20]
      );
      broetchenCat = await get("SELECT * FROM categories WHERE slug = 'pizza-broetchen'");
    }
    if (broetchenCat) {
      await query('UPDATE categories SET name = $1, description = $2, sort_order = 20, active = 1 WHERE id = $3',
        ['Pizza Brötchen', '6 oder 12 Stück. Inklusive 1 Sauce nach Wahl.', broetchenCat.id]);
      const S612 = (a, b) => JSON.stringify([{ label: '6 Stück', price: a }, { label: '12 Stück', price: b }]);
      const broetchen = [
        ['① Pizza Brötchen Käse', 'pizza-broetchen-kaese', 'Käse · Tomatensauce', 6.90, 'Käse · Tomatensauce', 1, 1, '/images/products/img7.jpg', S612(6.90, 11.90)],
        ['② Pizza Brötchen Schinken', 'pizza-broetchen-schinken', 'Schinken · Käse', 7.90, 'Schinken · Käse', 0, 2, '/images/products/img8.jpg', S612(7.90, 13.90)],
        ['③ Pizza Brötchen Pute', 'pizza-broetchen-pute', 'Putenbrust · Käse', 7.90, 'Putenbrust · Käse', 0, 3, '/images/products/img9.jpg', S612(7.90, 13.90)],
        ['④ Pizza Brötchen Salami', 'pizza-broetchen-salami', 'Salami · Käse', 7.90, 'Salami · Käse', 0, 4, '/images/products/img7.jpg', S612(7.90, 13.90)],
        ['⑤ Pizza Brötchen Sucuk', 'pizza-broetchen-sucuk', 'Sucuk · Käse · Zwiebeln', 8.50, 'Sucuk · Käse · Zwiebeln', 0, 5, '/images/products/img8.jpg', S612(8.50, 14.90)],
        ['⑥ Pizza Brötchen Thunfisch', 'pizza-broetchen-thunfisch', 'Thunfisch · Käse · Zwiebeln', 8.50, 'Thunfisch · Käse · Zwiebeln', 0, 6, '/images/products/img9.jpg', S612(8.50, 14.90)],
        ['⑦ Pizza Brötchen Hähnchen', 'pizza-broetchen-haehnchen', 'Hähnchen · Käse · Paprika', 8.90, 'Hähnchen · Käse · Paprika', 0, 7, '/images/products/img7.jpg', S612(8.90, 15.90)],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of broetchen) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=EXCLUDED.sizes, image=COALESCE(products.image, EXCLUDED.image)`,
          [broetchenCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('Pizza-Brötchen Auto-Migration übersprungen:', e.message);
  }

  // Auto-Migration NEXO Deals 2026-09-05: Mittag Deal (12-15 Uhr) + Night Deal (ab 21 Uhr, Abholer) per Upsert (idempotent)
  try {
    let dealsCat = await get("SELECT * FROM categories WHERE slug = 'nexo-deals'");
    if (!dealsCat) {
      await query(
        'INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
        ['NEXO Deals', 'nexo-deals', 'Tageszeit-Angebote: Mittag Deal 12–15 Uhr · Night Deal ab 21:00 Uhr (nur Abholer).', 21]
      );
      dealsCat = await get("SELECT * FROM categories WHERE slug = 'nexo-deals'");
    }
    if (dealsCat) {
      await query('UPDATE categories SET name = $1, description = $2, sort_order = 21, active = 1 WHERE id = $3',
        ['NEXO Deals', 'Tageszeit-Angebote: Mittag Deal 12–15 Uhr · Night Deal ab 21:00 Uhr (nur Abholer).', dealsCat.id]);
      const nexoDeals = [
        ['Mittag Deal · Wunsch-Menü', 'nexo-mittag-deal', 'Pizza Ø 26 cm oder Baguette nach Wunsch, bis zu 3 Beläge nach Wahl (Fisch ausgeschlossen) + 1 Getränk 0,33 l nach Wahl. Nur zur Mittagszeit 12–15 Uhr.', 10.99, 'Pizza oder Baguette, 3 Beläge nach Wahl, Getränk 0,33 l', 1, 1, '/images/products/img2.jpg', null],
      ];
      for (const [name, slug, description, price, ingredients, is_featured, sort_order, image, sizes] of nexoDeals) {
        await query(
          `INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
           VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,1,$9,$10)
           ON CONFLICT (slug) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, description=EXCLUDED.description, price=EXCLUDED.price, ingredients=EXCLUDED.ingredients, is_featured=COALESCE(products.is_featured, EXCLUDED.is_featured), is_available=1, sort_order=EXCLUDED.sort_order, sizes=COALESCE(EXCLUDED.sizes, products.sizes), image=COALESCE(products.image, EXCLUDED.image)`,
          [dealsCat.id, name, slug, description, price, image, ingredients, is_featured, sort_order, sizes]
        );
      }
    }
  } catch (e) {
    console.error('NEXO-Deals Auto-Migration übersprungen:', e.message);
  }

  // Night Deal aus NEXO Deals entfernen (auf Wunsch, Mittag Deal bleibt)
  try {
    await query("DELETE FROM products WHERE slug = 'nexo-night-deal'");
  } catch (e) {
    console.error('Night-Deal-Löschung übersprungen:', e.message);
  }

  // Hero-Preise als Single Source (nur Anzeigen): Deal-Produkte von den Slide-Preisen ableiten
  try {
    const slides = await query("SELECT * FROM hero_slides WHERE button_link LIKE '%?add=deal-%'");
    for (const s of slides.rows) {
      await syncDealPricesFromSlide(s);
    }
  } catch (e) {
    console.error('Hero-Preis-Sync übersprungen:', e.message);
  }

  // Liefergebiet: echte Restaurant-Koordinaten (Pieperstraße 8, 21357 Bardowick) + 15-km-Limit (Zonentabelle)
  // Alte Berlin-Platzhalter (52.520008, 13.404954) und Musteradresse dabei korrigieren
  try {
    await query("UPDATE settings SET value = 'Pieperstraße 8, 21357 Bardowick' WHERE key = 'address' AND value = 'Musterstraße 42, 10117 Berlin'");
    await query("UPDATE settings SET value = '53.295344' WHERE key = 'latitude' AND value = '52.520008'");
    await query("UPDATE settings SET value = '10.391293' WHERE key = 'longitude' AND value = '13.404954'");
    await query("UPDATE settings SET value = '15' WHERE key = 'max_delivery_km' AND value = '12'");
  } catch (e) {
    console.error('Restaurant-Koordinaten-Migration übersprungen:', e.message);
  }

  // Telefon auf echte Nummer umstellen (nur wenn noch der alte Platzhalter drinsteht)
  try {
    await query("UPDATE settings SET value = '04131 4006817' WHERE key = 'phone' AND value = '+49 30 123456789'");
  } catch (e) {
    console.error('Phone-Migration übersprungen:', e.message);
  }

  // Black & Gold Theme: Standard-Rot durch Gold ersetzen (nur wenn noch unberührt)
  try {
    await query("UPDATE settings SET value = '#d4af37' WHERE key = 'primary_color' AND value = '#eb0029'");
    await query("UPDATE settings SET value = '#f5d67b' WHERE key = 'secondary_color' AND value = '#ff4d4d'");
  } catch (e) {
    console.error('Gold-Theme-Migration übersprungen:', e.message);
  }

  // Logo aktivieren (nur wenn noch keins gesetzt ist)
  try {
    await query("UPDATE settings SET value = '/images/nexo-logo.png' WHERE key = 'logo_url' AND (value = '' OR value IS NULL)");
  } catch (e) {
    console.error('Logo-Migration übersprungen:', e.message);
  }

  const defaultSettings = [
    ['site_name', 'Ammaya'],
    ['site_description', 'Ihr Restaurant für Pizza, Burger und mehr'],
    ['address', 'Pieperstraße 8, 21357 Bardowick'],
    ['phone', '04131 4006817'],
    ['email', 'info@ammaya.de'],
    ['opening_hours', 'Mo–So: 11:30 – 22:30'],
    ['delivery_fee', '4.50'],
    ['free_delivery_from', '30.00'],
    ['max_delivery_km', '15'],
    ['restaurant_lat', '53.295344'],
    ['restaurant_lon', '10.391293'],
    ['social_instagram', 'https://instagram.com/ammaya'],
    ['social_facebook', 'https://facebook.com/ammaya'],
    ['social_tiktok', 'https://tiktok.com/@ammaya'],
    ['google_maps_key', 'YOUR_GOOGLE_MAPS_KEY'],
    ['latitude', '53.295344'],
    ['longitude', '10.391293'],

    ['about_title', 'Unsere Philosophie'],
    ['about_text', 'Bei Ammaya vereinen wir internationale Küche mit Leidenschaft. Jedes Gericht wird mit Sorgfalt zubereitet, um Ihnen ein unvergessliches Geschmackserlebnis zu bieten. Wir verwenden ausschließlich frische Zutaten und legen größten Wert auf Qualität.'],
    ['primary_color', '#d4af37'],
    ['secondary_color', '#f5d67b'],
    ['accent_color', '#9c7c1a'],
    ['header_bg', ''],
    ['hero_theme', 'black-gold'],
    ['logo_url', '/images/nexo-logo.png'],
    ['font_family', 'Inter'],
    ['commission_per_order', '0.40'],
  ];
  for (const [key, value] of defaultSettings) {
    await query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, value]
    );
  }

  // Einmalig: alle Empfohlen-Markierungen entfernen (Eigentümer vergibt sie danach selbst).
  // Läuft nur einmal dank Marker – danach bleiben Admin-Änderungen erhalten.
  try {
    const flag = await get("SELECT value FROM settings WHERE key = 'featured_reset_2026_09'");
    if (!flag) {
      await query('UPDATE products SET is_featured = 0 WHERE COALESCE(is_featured, 0) != 0');
      await query("INSERT INTO settings (key, value) VALUES ('featured_reset_2026_09', '1') ON CONFLICT (key) DO NOTHING");
      console.log('Empfohlen-Markierungen zurückgesetzt.');
    }
  } catch (e) {
    console.error('Featured-Reset übersprungen:', e.message);
  }

  // Ensure hero_slides table has correct schema and data
  try {
    const probe = await query(`SELECT COUNT(*) as cnt FROM hero_slides WHERE line1 IS NOT NULL AND line1 != ''`);
    if (probe.rows[0].cnt === 0) {
      // Table has old schema or empty data - drop and recreate
      await query(`DROP TABLE IF EXISTS hero_slides CASCADE`);
    }
  } catch (e) {
    // Column doesn't exist - drop and recreate
    try { await query(`DROP TABLE IF EXISTS hero_slides CASCADE`); } catch (e2) {}
  }
  await query(`
    CREATE TABLE IF NOT EXISTS hero_slides (
      id SERIAL PRIMARY KEY,
      sort_order INTEGER DEFAULT 0,
      line1 TEXT DEFAULT '',
      line2 TEXT DEFAULT '',
      line3 TEXT DEFAULT '',
      price1 TEXT DEFAULT '',
      price1_cents TEXT DEFAULT '',
      price1_tag TEXT DEFAULT '',
      price2 TEXT DEFAULT '',
      price2_cents TEXT DEFAULT '',
      price2_tag TEXT DEFAULT '',
      description TEXT DEFAULT '',
      button_text TEXT DEFAULT 'JETZT BESTELLEN',
      button_link TEXT DEFAULT '/warenkorb',
      bg_image TEXT DEFAULT '',
      main_image TEXT DEFAULT '',
      drink_tl TEXT DEFAULT '',
      drink_tr TEXT DEFAULT '',
      drink_br TEXT DEFAULT '',
      active INTEGER DEFAULT 1
    );
  `);

  // Seed default hero slides
  const existingSlides = await query('SELECT COUNT(*) as cnt FROM hero_slides');
  if (existingSlides.rows[0].cnt === 0) {
    await query(`INSERT INTO hero_slides (sort_order, line1, line2, line3, price1, price1_cents, price1_tag, price2, price2_cents, price2_tag, description, button_text, button_link, bg_image, main_image, drink_tl, drink_tr, drink_br) VALUES (0, '1 GROSSE', 'PIZZA', '+ 4 GETRÄNKE', '19', ',99€', 'ABHOLUNG', '21', ',99€', 'LIEFERUNG', 'Bestellen Sie eine große 3-Belag-Pizza und erhalten Sie 4 Getränke (330ml) gratis!', 'JETZT BESTELLEN', '/warenkorb', '/images/revolution/6cbea-bg1.jpg', '/images/revolution/75ec1-big1.png', '/images/revolution/f13af-big3.png', '/images/revolution/d70da-big4.png', '/images/revolution/96fdd-big6.png')`);
    await query(`INSERT INTO hero_slides (sort_order, line1, line2, line3, price1, price1_cents, price1_tag, price2, price2_cents, price2_tag, description, button_text, button_link, bg_image, main_image, drink_tl, drink_tr, drink_br) VALUES (1, 'MIX OR MATCH', 'COMBO DEAL', 'SPECIAL', '9', ',99€', 'ABHOLUNG', '11', ',99€', 'LIEFERUNG', 'Includes 1 burger, 1 small fries, 1 dip and 1 drink (330ml)', 'JETZT BESTELLEN', '/warenkorb', '/images/revolution/6cbea-bg1.jpg', '/images/revolution/5b6b6-burger.png', '/images/revolution/5fb1e-glass.png', '/images/revolution/6e11b-donut3.png', '/images/revolution/f1de6-donut2.png')`);
  }
}

module.exports = { query, get, all, run, pool, initialize, syncDealPricesFromSlide };
