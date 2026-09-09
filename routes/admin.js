const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const slugify = require('slugify');
const auth = require('../middleware/auth');
const { optimizeUpload } = require('../image');

const storage = multer.memoryStorage();
const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const fileFilter = (req, file, cb) => {
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Nur Bilder (JPEG, PNG, GIF, WebP, SVG) sind erlaubt'), false);
  }
};
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024, fieldSize: 10 * 1024 * 1024 }, fileFilter });

router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Admin Login', error: null, csrfToken: req.session.csrfToken || '' });
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await db.get('SELECT * FROM admins WHERE username = $1', [username]);
    if (admin && bcrypt.compareSync(password, admin.password)) {
      req.session.admin = { id: admin.id, username: admin.username, display_name: admin.display_name };
      req.session.save(err => {
        if (err) return res.status(500).send('Session save error');
        return res.redirect('/admin');
      });
    } else {
      res.render('admin/login', { title: 'Admin Login', error: 'Ungültige Anmeldedaten' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Ein Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

router.get('/', auth, async (req, res) => {
  const stats = {
    products: (await db.get('SELECT COUNT(*) as count FROM products')).count,
    categories: (await db.get('SELECT COUNT(*) as count FROM categories')).count,
    orders: (await db.get('SELECT COUNT(*) as count FROM orders WHERE COALESCE(is_deleted,0) = 0')).count,
    pending: (await db.get("SELECT COUNT(*) as count FROM orders WHERE (order_status = 'neu' OR order_status = 'in_bearbeitung') AND COALESCE(is_deleted,0) = 0")).count,
    revenue: (await db.get("SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE order_status != 'storniert' AND COALESCE(is_deleted,0) = 0")).total,
    recentOrders: await db.all('SELECT * FROM orders WHERE COALESCE(is_deleted,0) = 0 ORDER BY created_at DESC LIMIT 5'),
    unreadMessages: (await db.get("SELECT COUNT(*) as count FROM contact_messages WHERE is_read = 0")).count
  };
  const settings = res.locals.settings;
  res.render('admin/dashboard', { title: 'Dashboard – Admin', stats, settings });
});

router.get('/produkte/pizza-groesen', auth, async (req, res) => {
  const products = await db.all("SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE c.name = 'Pizza' ORDER BY p.name");
  res.render('admin/pizza-sizes', { title: 'Pizza-Größen – Admin', products });
});

router.post('/produkte/pizza-groesen', auth, async (req, res) => {
  const { size_label, size_price } = req.body;
  const sizes = [];
  if (Array.isArray(size_label)) {
    for (let i = 0; i < size_label.length; i++) {
      if (size_label[i].trim() && parseFloat(size_price[i])) {
        sizes.push({ label: size_label[i].trim(), price: parseFloat(size_price[i]) });
      }
    }
  }
  const sizesJson = sizes.length ? JSON.stringify(sizes) : null;
  await db.run("UPDATE products SET sizes = $1 WHERE category_id = (SELECT id FROM categories WHERE name = 'Pizza')", [sizesJson]);
  res.redirect('/admin/produkte/pizza-groesen');
});

router.get('/produkte', auth, async (req, res) => {
  const products = await db.all('SELECT DISTINCT ON (p.name) p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id ORDER BY p.name, p.id DESC');
  const categories = await db.all('SELECT * FROM categories ORDER BY sort_order');
  res.render('admin/products', { title: 'Produkte – Admin', products, categories, duplicate: req.query.duplicate === '1', toggled: req.query.toggled || null, toggledState: req.query.state || null });
});

router.post('/produkte', auth, upload.single('image'), async (req, res) => {
  const { name, category_id, description, price, old_price, ingredients, is_featured, is_available, sort_order, sizes } = req.body;
  const slug = slugify(name, { lower: true, strict: true });
  const image = req.file ? await optimizeUpload(req.file.buffer, req.file.mimetype) : null;
  const existing = await db.get('SELECT id FROM products WHERE name = $1', [name]);
  if (existing) {
    return res.redirect('/admin/produkte?duplicate=1');
  }
  let sizesJson = null;
  if (sizes) {
    try { sizesJson = JSON.stringify(JSON.parse(sizes)); } catch (e) { sizesJson = null; }
  }
  await db.run(`INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, is_available, sort_order, sizes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [category_id || null, name, slug + '-' + Date.now(), description, price, old_price || null,
    image, ingredients, is_featured ? 1 : 0, is_available ? 1 : 0, sort_order || 0, sizesJson]
  );
  res.redirect('/admin/produkte');
});

router.post('/produkte/bearbeiten/:id', auth, upload.single('image'), async (req, res) => {
  const { name, category_id, description, price, old_price, ingredients, is_featured, is_available, sort_order, sizes } = req.body;
  const product = await db.get('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!product) return res.status(404).send('Produkt nicht gefunden');
  const slug = product.slug; // Slug bleibt stabil (Box-/Deal-/Größen-Logik hängt am exakten Slug)
  const image = req.file ? await optimizeUpload(req.file.buffer, req.file.mimetype) : product.image;
  let sizesJson = product.sizes;
  if (sizes !== undefined) {
    try { sizesJson = JSON.stringify(JSON.parse(sizes)); } catch (e) { sizesJson = product.sizes; }
  }
  await db.run(`UPDATE products SET category_id=$1, name=$2, slug=$3, description=$4, price=$5, old_price=$6, image=$7, ingredients=$8, is_featured=$9, is_available=$10, sort_order=$11, sizes=$12 WHERE id=$13`,
    [category_id || null, name, slug, description, price, old_price || null, image, ingredients,
    is_featured ? 1 : 0, is_available ? 1 : 0, sort_order || 0, sizesJson, req.params.id]
  );
  res.redirect('/admin/produkte');
});

router.post('/produkte/loeschen/:id', auth, async (req, res) => {
  await db.run('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.redirect('/admin/produkte');
});

// Schnell-Umschalter Verfügbar/Ausverkauft (gilt für alle Namens-Duplikate, damit Menü + Admin immer übereinstimmen)
router.post('/produkte/verfuegbarkeit/:id', auth, async (req, res) => {
  const p = await db.get('SELECT id, name, is_available FROM products WHERE id = $1', [req.params.id]);
  if (!p) return res.redirect('/admin/produkte');
  const next = p.is_available ? 0 : 1;
  await db.run('UPDATE products SET is_available = $1 WHERE name = $2', [next, p.name]);
  res.redirect('/admin/produkte?toggled=' + encodeURIComponent(p.name) + '&state=' + next);
});

router.get('/kategorien', auth, async (req, res) => {
  const categories = await db.all('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count FROM categories c ORDER BY sort_order');
  res.render('admin/categories', { title: 'Kategorien – Admin', categories });
});

router.post('/kategorien', auth, async (req, res) => {
  const { name, description, sort_order } = req.body;
  const slug = slugify(name, { lower: true, strict: true }) + '-' + Date.now();
  await db.run('INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4)',
    [name, slug, description, sort_order || 0]);
  res.redirect('/admin/kategorien');
});

router.post('/kategorien/bearbeiten/:id', auth, async (req, res) => {
  const { name, description, sort_order, active } = req.body;
  await db.run('UPDATE categories SET name=$1, description=$2, sort_order=$3, active=$4 WHERE id=$5',
    [name, description, sort_order || 0, active ? 1 : 0, req.params.id]);
  res.redirect('/admin/kategorien');
});

router.post('/kategorien/loeschen/:id', auth, async (req, res) => {
  await db.run('DELETE FROM categories WHERE id = $1', [req.params.id]);
  res.redirect('/admin/kategorien');
});

router.get('/bestellungen', auth, async (req, res) => {
  const status = req.query.status || 'alle';
  let datum = typeof req.query.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.datum)
    ? req.query.datum
    : new Date().toISOString().slice(0, 10);
  let orders;
  if (status === 'alle') {
    orders = await db.all('SELECT * FROM orders WHERE COALESCE(is_deleted,0) = 0 AND created_at::date = $1 ORDER BY created_at DESC', [datum]);
  } else {
    orders = await db.all('SELECT * FROM orders WHERE order_status = $1 AND COALESCE(is_deleted,0) = 0 AND created_at::date = $2 ORDER BY created_at DESC', [status, datum]);
  }
  const dayCount = orders.length;
  const dayRevenue = orders.filter(o => o.order_status !== 'storniert').reduce((s, o) => s + parseFloat(o.total || 0), 0);
  res.render('admin/orders', { title: 'Bestellungen – Admin', orders, currentStatus: status, datum, dayCount, dayRevenue });
});

router.post('/bestellungen/status/:id', auth, async (req, res) => {
  const { status } = req.body;
  await db.run('UPDATE orders SET order_status = $1 WHERE id = $2 AND COALESCE(is_deleted,0) = 0', [status, req.params.id]);
  res.redirect('/admin/bestellungen');
});

// --- Auto-Print + Sound: neue Bestellungen seit last_id abfragen (Admin-PC pollt alle paar Sekunden) ---
router.get('/api/neue-bestellungen', auth, async (req, res) => {
  try {
    const lastId = parseInt(req.query.last_id, 10) || 0;
    const rows = await db.all(
      "SELECT * FROM orders WHERE id > $1 AND order_status = 'neu' AND COALESCE(is_deleted,0) = 0 AND COALESCE(printed,0) = 0 ORDER BY id ASC LIMIT 20",
      [lastId]
    );
    const orders = rows.map(o => {
      let items = [];
      try { items = JSON.parse(o.items); } catch (e) { items = []; }
      return { ...o, items };
    });
    const maxIdRow = await db.get('SELECT COALESCE(MAX(id), 0) as max_id FROM orders');
    res.json({ success: true, orders, max_id: maxIdRow ? maxIdRow.max_id : lastId });
  } catch (err) {
    console.error('neue-bestellungen error:', err);
    res.status(500).json({ success: false, message: 'Fehler beim Abrufen' });
  }
});

// Als gedruckt markieren (damit kein Doppel-Druck bei mehreren Tabs/PCs)
router.post('/api/bestellungen/:id/gedruckt', auth, async (req, res) => {
  try {
    await db.run('UPDATE orders SET printed = 1, printed_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('gedruckt error:', err);
    res.status(500).json({ success: false });
  }
});

// Thermo-Bon (80mm) für TM-T88V – wird im versteckten Iframe gedruckt
router.get('/bestellungen/:id/bon', auth, async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = $1 AND COALESCE(is_deleted,0) = 0', [req.params.id]);
  if (!order) return res.status(404).send('Bestellung nicht gefunden');
  try { order.items = JSON.parse(order.items); } catch (e) { order.items = []; }
  const settings = res.locals.settings;
  res.render('admin/bon', { order, settings });
});

router.get('/bestellungen/:id', auth, async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = $1 AND COALESCE(is_deleted,0) = 0', [req.params.id]);
  if (!order) return res.status(404).send('Bestellung nicht gefunden');
  order.items = JSON.parse(order.items);
  const settings = res.locals.settings;
  res.render('admin/order-detail', { title: 'Bestellung ' + order.order_number, order, settings });
});

router.post('/bestellungen/loeschen/:id', auth, async (req, res) => {
  // Soft-Delete: Bestellung bleibt für den Eigentümer sichtbar + provisionspflichtig
  await db.run('UPDATE orders SET is_deleted = 1, deleted_at = NOW() WHERE id = $1', [req.params.id]);
  res.redirect('/admin/bestellungen');
});

router.get('/rabatte', auth, async (req, res) => {
  const discounts = await db.all('SELECT * FROM discounts ORDER BY created_at DESC');
  res.render('admin/discounts', { title: 'Rabatte – Admin', discounts });
});

router.post('/rabatte', auth, async (req, res) => {
  const { code, type, value, min_order, usage_limit, expires_at } = req.body;
  await db.run('INSERT INTO discounts (code, type, value, min_order, usage_limit, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [code.toUpperCase(), type, value, min_order || 0, usage_limit || 0, expires_at || null]);
  res.redirect('/admin/rabatte');
});

router.post('/rabatte/loeschen/:id', auth, async (req, res) => {
  await db.run('DELETE FROM discounts WHERE id = $1', [req.params.id]);
  res.redirect('/admin/rabatte');
});

router.get('/banner', auth, async (req, res) => {
  const banners = await db.all('SELECT * FROM banners ORDER BY sort_order');
  res.render('admin/banners', { title: 'Banner – Admin', banners });
});

router.post('/banner', auth, upload.single('image'), async (req, res) => {
  const { title, subtitle, link, sort_order } = req.body;
  const image = req.file ? await optimizeUpload(req.file.buffer, req.file.mimetype) : null;
  await db.run('INSERT INTO banners (title, subtitle, image, link, sort_order) VALUES ($1, $2, $3, $4, $5)',
    [title, subtitle, image, link, sort_order || 0]);
  res.redirect('/admin/banner');
});

router.post('/banner/loeschen/:id', auth, async (req, res) => {
  await db.run('DELETE FROM banners WHERE id = $1', [req.params.id]);
  res.redirect('/admin/banner');
});

router.get('/testimonials', auth, async (req, res) => {
  const testimonials = await db.all('SELECT * FROM testimonials ORDER BY created_at DESC');
  res.render('admin/testimonials', { title: 'Testimonials – Admin', testimonials });
});

router.post('/testimonials', auth, upload.single('image'), async (req, res) => {
  const { name, text, rating } = req.body;
  const image = req.file ? await optimizeUpload(req.file.buffer, req.file.mimetype) : null;
  await db.run('INSERT INTO testimonials (name, text, rating, image) VALUES ($1, $2, $3, $4)',
    [name, text, rating || 5, image]);
  res.redirect('/admin/testimonials');
});

router.post('/testimonials/bearbeiten/:id', auth, upload.single('image'), async (req, res) => {
  const { name, text, rating, active } = req.body;
  const t = await db.get('SELECT * FROM testimonials WHERE id = $1', [req.params.id]);
  if (!t) return res.status(404).send('Testimonial nicht gefunden');
  const image = req.file ? await optimizeUpload(req.file.buffer, req.file.mimetype) : t.image;
  await db.run('UPDATE testimonials SET name=$1, text=$2, rating=$3, image=$4, active=$5 WHERE id=$6',
    [name, text, rating || 5, image, active ? 1 : 0, req.params.id]);
  res.redirect('/admin/testimonials');
});

router.post('/testimonials/loeschen/:id', auth, async (req, res) => {
  await db.run('DELETE FROM testimonials WHERE id = $1', [req.params.id]);
  res.redirect('/admin/testimonials');
});

// Einfaches Preis-Feld ("10,99" / "10.99 €" / "10") -> { zahl, cents } für Slide-Template.
// "" = kein Preis (wird nicht angezeigt). Bestehende DB-Werte bleiben unberührt.
function parseSlidePreis(v) {
  if (v == null || !String(v).trim()) return { zahl: '', cents: '' };
  const n = parseFloat(String(v).replace(/[€\s]/g, '').replace(',', '.'));
  if (!isFinite(n) || n < 0) return { zahl: '', cents: '' };
  const parts = (Math.round(n * 100) / 100).toFixed(2).split('.');
  return { zahl: parts[0], cents: parts[1] === '00' ? '€' : ',' + parts[1] + '€' };
}

router.get('/einstellungen', auth, async (req, res) => {
  const settings = res.locals.settings;
  const { getDeliveryZones } = require('../delivery');
  const zones = getDeliveryZones(settings);
  const slides = await db.all('SELECT * FROM hero_slides ORDER BY sort_order');
  const dealProducts = await db.all(
    "SELECT name, slug FROM products WHERE category_id = (SELECT id FROM categories WHERE slug = 'nexo-deals') ORDER BY sort_order"
  ).catch(() => []);
  const dealLinks = [
    { label: 'NEXO Deals (Kategorie)', value: '/speisekarte/kategorie/nexo-deals' },
    ...dealProducts.map(p => ({ label: p.name + ' (direkt)', value: '/warenkorb?add=' + p.slug })),
    { label: 'Speisekarte', value: '/speisekarte' },
    { label: 'Warenkorb', value: '/warenkorb' }
  ];
  const success = req.flash && req.flash.success ? req.flash.success : null;
  if (req.flash) req.flash.success = null;
  res.render('admin/settings', { title: 'Einstellungen – Admin', settings, slides, dealLinks, zones, success });
});

router.post('/einstellungen', auth, async (req, res) => {
  const allowed = ['site_name','site_description','address','phone','email','opening_hours','delivery_fee','free_delivery_from','max_delivery_km','restaurant_lat','restaurant_lon','social_instagram','social_facebook','social_tiktok','about_title','about_text','latitude','longitude','primary_color','secondary_color','accent_color','header_bg','hero_theme','logo_url','font_family'];
  const isHexColor = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      let val = req.body[key];
      if (['primary_color','secondary_color','accent_color','header_bg'].includes(key)) {
        if (key === 'header_bg' && (val === '' || val === null)) {
          // empty = default header background, allowed
        } else if (!isHexColor(val)) {
          continue; // skip invalid colors to avoid breaking CSS
        }
      }
      if (key === 'hero_theme' && !['black-gold','banner'].includes(val)) continue;
      await db.run('UPDATE settings SET value = $1 WHERE key = $2', [val, key]);
    }
  }
  // Lieferzonen-Tabelle (Bis km / Mindestbestellwert / Lieferkosten / Gratis ab)
  if (req.body.zone_to !== undefined) {
    const toArr = Array.isArray(req.body.zone_to) ? req.body.zone_to : [req.body.zone_to];
    const feeArr = Array.isArray(req.body.zone_fee) ? req.body.zone_fee : [req.body.zone_fee];
    const minArr = Array.isArray(req.body.zone_min) ? req.body.zone_min : [req.body.zone_min];
    const freeArr = Array.isArray(req.body.zone_free) ? req.body.zone_free : [req.body.zone_free];
    const zones = [];
    for (let i = 0; i < Math.min(toArr.length, 10); i++) {
      const to = parseFloat(String(toArr[i] || '').replace(',', '.'));
      const fee = parseFloat(String(feeArr[i] || '').replace(',', '.'));
      const min = parseFloat(String(minArr[i] || '').replace(',', '.'));
      const free = parseFloat(String(freeArr[i] || '').replace(',', '.')) || 0;
      if (!isFinite(to) || to <= 0 || !isFinite(fee) || fee < 0 || !isFinite(min) || min < 0 || !isFinite(free) || free < 0) continue;
      zones.push({ to, fee: Math.round(fee * 100) / 100, min: Math.round(min * 100) / 100, free: Math.round(free * 100) / 100 });
    }
    zones.sort((a, b) => a.to - b.to);
    if (zones.length) {
      await db.run('UPDATE settings SET value = $1 WHERE key = $2', [JSON.stringify(zones), 'delivery_zones']);
    }
  }
  req.flash = req.flash || {};
  req.flash.success = 'Einstellungen wurden erfolgreich gespeichert!';
  req.session.save(err => {
    if (err) console.error('Session save error:', err);
    res.redirect('/admin/einstellungen');
  });
});

router.get('/kontakt', auth, async (req, res) => {
  const messages = await db.all('SELECT * FROM contact_messages ORDER BY created_at DESC');
  res.render('admin/contact', { title: 'Kontaktnachrichten – Admin', messages });
});

router.post('/kontakt/gelesen/:id', auth, async (req, res) => {
  await db.run('UPDATE contact_messages SET is_read = 1 WHERE id = $1', [req.params.id]);
  res.redirect('/admin/kontakt');
});

router.post('/kontakt/loeschen/:id', auth, async (req, res) => {
  await db.run('DELETE FROM contact_messages WHERE id = $1', [req.params.id]);
  res.redirect('/admin/kontakt');
});

const hsUpload = upload.fields([
  { name: 'bg_image_file', maxCount: 1 },
  { name: 'main_image_file', maxCount: 1 },
  { name: 'drink_tl_file', maxCount: 1 },
  { name: 'drink_tr_file', maxCount: 1 },
  { name: 'drink_br_file', maxCount: 1 }
]);

async function imgVal(files, field, textVal) {
  if (files && files[field] && files[field][0]) {
    return optimizeUpload(files[field][0].buffer, files[field][0].mimetype);
  }
  return textVal || '';
}

router.post('/einstellungen/hero-slides', auth, hsUpload, async (req, res) => {
  const { line1, line2, line3, preis1, preis1_tag, preis2, preis2_tag, description, button_text, button_link, sort_order } = req.body;
  const p1 = parseSlidePreis(preis1), p2 = parseSlidePreis(preis2);
  const price1 = p1.zahl, price1_cents = p1.cents, price2 = p2.zahl, price2_cents = p2.cents;
  await db.run(`INSERT INTO hero_slides (sort_order, line1, line2, line3, price1, price1_cents, price1_tag, price2, price2_cents, price2_tag, description, button_text, button_link, bg_image, main_image, drink_tl, drink_tr, drink_br) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [sort_order || 0, line1 || '', line2 || '', line3 || '', price1, price1_cents, preis1_tag || '', price2, price2_cents, preis2_tag || '', description || '', button_text || 'JETZT BESTELLEN', button_link || '/warenkorb',
    await imgVal(req.files, 'bg_image_file', req.body.bg_image) || '/images/revolution/6cbea-bg1.jpg',
    await imgVal(req.files, 'main_image_file', req.body.main_image) || '/images/revolution/75ec1-big1.png',
    await imgVal(req.files, 'drink_tl_file', req.body.drink_tl),
    await imgVal(req.files, 'drink_tr_file', req.body.drink_tr),
    await imgVal(req.files, 'drink_br_file', req.body.drink_br)]);
  // Anzeige-Preise sind Single Source: Deal-Produkt sofort von den Slide-Preisen ableiten
  try {
    await db.syncDealPricesFromSlide({ button_link: button_link || '/warenkorb', price1, price1_cents, price1_tag: preis1_tag || '', price2, price2_cents, price2_tag: preis2_tag || '' });
  } catch (e) {
    console.error('Deal-Preis-Sync übersprungen:', e.message);
  }
  req.flash = req.flash || {};
  req.flash.success = 'Slide wurde erstellt!';
  req.session.save(() => res.redirect('/admin/einstellungen'));
});

router.post('/einstellungen/hero-slides/bearbeiten/:id', auth, hsUpload, async (req, res) => {
  const slide = await db.get('SELECT * FROM hero_slides WHERE id = $1', [req.params.id]);
  if (!slide) return res.status(404).send('Slide nicht gefunden');
  const { line1, line2, line3, preis1, preis1_tag, preis2, preis2_tag, description, button_text, button_link, sort_order, active, remove_bg_image, remove_main_image, remove_drink_tl, remove_drink_tr, remove_drink_br } = req.body;
  const pe1 = parseSlidePreis(preis1), pe2 = parseSlidePreis(preis2);
  const price1 = pe1.zahl, price1_cents = pe1.cents, price2 = pe2.zahl, price2_cents = pe2.cents;
  const price1_tag = preis1_tag, price2_tag = preis2_tag;
  async function imgValEdit(field, fileField, oldVal, defaultVal) {
    if (req.files && req.files[fileField] && req.files[fileField][0]) return optimizeUpload(req.files[fileField][0].buffer, req.files[fileField][0].mimetype);
    if (req.body['remove_' + field]) return '';
    return oldVal || defaultVal || '';
  }
  await db.run(`UPDATE hero_slides SET sort_order=$1, line2=$2, line3=$3, price1=$4, price1_cents=$5, price1_tag=$6, price2=$7, price2_cents=$8, price2_tag=$9, description=$10, button_text=$11, button_link=$12, bg_image=$13, main_image=$14, drink_tl=$15, drink_tr=$16, drink_br=$17, active=$18, line1=$19 WHERE id=$20`,
    [sort_order || 0, line2 || '', line3 || '', price1 || '', price1_cents || '', price1_tag || '', price2 || '', price2_cents || '', price2_tag || '', description || '', button_text || 'JETZT BESTELLEN', button_link || '/warenkorb',
    await imgValEdit('bg_image', 'bg_image_file', slide.bg_image, '/images/revolution/6cbea-bg1.jpg'),
    await imgValEdit('main_image', 'main_image_file', slide.main_image, '/images/revolution/75ec1-big1.png'),
    await imgValEdit('drink_tl', 'drink_tl_file', slide.drink_tl),
    await imgValEdit('drink_tr', 'drink_tr_file', slide.drink_tr),
    await imgValEdit('drink_br', 'drink_br_file', slide.drink_br),
    active ? 1 : 0, line1 || '', req.params.id]);
  // Anzeige-Preise sind Single Source: Deal-Produkt sofort von den Slide-Preisen ableiten
  try {
    await db.syncDealPricesFromSlide({ button_link: button_link || '/warenkorb', price1, price1_cents, price1_tag, price2, price2_cents, price2_tag });
  } catch (e) {
    console.error('Deal-Preis-Sync übersprungen:', e.message);
  }
  req.flash = req.flash || {};
  req.flash.success = 'Slide wurde aktualisiert!';
  req.session.save(() => res.redirect('/admin/einstellungen'));
});

router.post('/einstellungen/hero-slides/loeschen/:id', auth, async (req, res) => {
  await db.run('DELETE FROM hero_slides WHERE id = $1', [req.params.id]);
  req.flash = req.flash || {};
  req.flash.success = 'Slide wurde gelöscht!';
  req.session.save(() => res.redirect('/admin/einstellungen'));
});

// Tagesbericht-Daten laden (für A4-Seite + Thermo-Bon)
async function loadTagesbericht(datum) {
  const orders = await db.all('SELECT * FROM orders WHERE COALESCE(is_deleted,0) = 0 AND created_at::date = $1 ORDER BY created_at', [datum]);
  const valid = orders.filter(o => o.order_status !== 'storniert');
  const revenue = valid.reduce((s, o) => s + parseFloat(o.total || 0), 0);
  const pay = {};
  valid.forEach(o => {
    const k = o.payment_method === 'bar' ? 'Bar' : (o.payment_method === 'karte' ? 'Karte' : 'Online');
    pay[k] = (pay[k] || 0) + parseFloat(o.total || 0);
  });
  const itemsSum = {};
  valid.forEach(o => {
    let items = [];
    try { items = JSON.parse(o.items); } catch (e) {}
    items.forEach(it => {
      const key = it.name + (it.size && it.size.label ? ' (' + it.size.label + ')' : '');
      if (!itemsSum[key]) itemsSum[key] = { name: key, qty: 0, total: 0 };
      itemsSum[key].qty += parseInt(it.qty) || 0;
      itemsSum[key].total += (parseFloat(it.price) || 0) * (parseInt(it.qty) || 0);
    });
  });
  const vat7Sum = valid.reduce((s, o) => s + (parseFloat(o.vat7) || 0), 0);
  const vat19Sum = valid.reduce((s, o) => s + (parseFloat(o.vat19) || 0), 0);
  return {
    datum, orders, validCount: valid.length, revenue, pay, vat7Sum, vat19Sum,
    itemsSum: Object.values(itemsSum).sort((a, b) => b.qty - a.qty)
  };
}

function reportDatum(req) {
  return typeof req.query.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.datum)
    ? req.query.datum
    : new Date().toISOString().slice(0, 10);
}

// Tagesbericht (druckbar, A4): Umsatz, Zahlungsarten, Artikel, Bestellungen
router.get('/tagesbericht', auth, async (req, res) => {
  const data = await loadTagesbericht(reportDatum(req));
  res.render('admin/report', { title: 'Tagesbericht – Admin', settings: res.locals.settings, ...data });
});

// Tagesbericht als Thermo-Bon (80mm, TM-T88V)
router.get('/tagesbericht/bon', auth, async (req, res) => {
  const data = await loadTagesbericht(reportDatum(req));
  res.render('admin/report-bon', { settings: res.locals.settings, ...data });
});

// Backup-Download (JSON): Bestellungen, Produkte, Kategorien, Rabatte, Einstellungen
router.get('/backup', auth, async (req, res) => {
  try {
    const data = {
      exportedAt: new Date().toISOString(),
      orders: await db.all('SELECT * FROM orders ORDER BY id'),
      products: await db.all('SELECT * FROM products ORDER BY id'),
      categories: await db.all('SELECT * FROM categories ORDER BY id'),
      discounts: await db.all('SELECT * FROM discounts ORDER BY id'),
      settings: await db.all('SELECT * FROM settings')
    };
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="nexo-backup-' + stamp + '.json"');
    res.send(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('backup error:', err);
    res.status(500).send('Backup fehlgeschlagen');
  }
});

router.get('/passwort', auth, (req, res) => {
  res.render('admin/password', { title: 'Passwort ändern – Admin', message: null, error: null });
});

router.post('/passwort', auth, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const admin = await db.get('SELECT * FROM admins WHERE id = $1', [req.session.admin.id]);
  if (!bcrypt.compareSync(current_password, admin.password)) {
    return res.render('admin/password', { title: 'Passwort ändern – Admin', message: null, error: 'Aktuelles Passwort ist falsch' });
  }
  if (new_password !== confirm_password) {
    return res.render('admin/password', { title: 'Passwort ändern – Admin', message: null, error: 'Passwörter stimmen nicht überein' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  await db.run('UPDATE admins SET password = $1 WHERE id = $2', [hash, req.session.admin.id]);
  res.render('admin/password', { title: 'Passwort ändern – Admin', message: 'Passwort erfolgreich geändert!', error: null });
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('Datei zu groß. Maximal 5 MB erlaubt.');
    }
    return res.status(400).send('Fehler beim Dateiupload: ' + err.message);
  }
  if (err) {
    return res.status(400).send(err.message || 'Ein Fehler ist aufgetreten');
  }
  next();
});

module.exports = router;
