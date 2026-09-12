const express = require('express');
const router = express.Router();
const db = require('../db');
const { TOPPINGS, FISH_TOPPINGS, EXTRA_PRICES, KAESERAND } = require('../extras');
const { swapProductImages } = require('../image');
const { resolveGroups, dealToppingsNoFish, DEAL_BASIS, DEAL_DRINKS, DEAL_MAX_TOPPINGS } = require('../boxen');
const pizzaExtras = { toppings: TOPPINGS, fish: FISH_TOPPINGS, prices: EXTRA_PRICES, kaeserand: KAESERAND };

// Speisekarte immer frisch laden (kein Browser-Cache), damit Ausverkauft sofort wirkt
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Listen für Box-Konfiguration (Saucen/Snacks/Pastas aus DB, Toppings aus Preisliste)
// Parallel statt nacheinander – spart je Request mehrere DB-Roundtrips (wichtig bei DB-Latenz).
async function loadBoxLists() {
  const names = (slug) => db.all(
    "SELECT name FROM products WHERE category_id = (SELECT id FROM categories WHERE slug = $1) AND is_available = 1 ORDER BY sort_order", [slug]
  ).then(rows => rows.map(r => r.name));
  const [sauces, snacks, pastas, broetchen] = await Promise.all([
    names('saucen-dips'), names('snacks'), names('pasta'), names('pizza-broetchen')
  ]);
  return { sauces, snacks, pastas, toppings: TOPPINGS, 'pizza-broetchen': broetchen };
}

function attachBoxGroups(products, lists) {
  for (const p of products) {
    const g = resolveGroups(p.slug, lists);
    if (g) p.boxGroups = g;
  }
}

// Listen für Mittag-Deal-Konfiguration (Toppings ohne Fisch + Croque-Sorten aus DB)
async function loadDealLists() {
  const croques = (await db.all(
    "SELECT name FROM products WHERE category_id = (SELECT id FROM categories WHERE slug = 'croque') AND is_available = 1 ORDER BY sort_order"
  )).map(r => r.name);
  return { basis: DEAL_BASIS, toppings: dealToppingsNoFish(), croques, drinks: DEAL_DRINKS, maxToppings: DEAL_MAX_TOPPINGS };
}

router.get('/', async (req, res) => {
  // Unabhängige Queries parallel – statt 4 Roundtrips nacheinander nur noch einer.
  const [categories, products, boxLists, dealLists] = await Promise.all([
    db.all('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order'),
    db.all("SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id IN (SELECT MIN(id) FROM products GROUP BY name) AND p.slug NOT IN ('deal-grosse-pizza-getraenke','deal-mix-match','deal-grosse-hamburger-getraenk','deal-night-abholung') ORDER BY c.sort_order, p.sort_order"),
    loadBoxLists(),
    loadDealLists()
  ]);
  const settings = res.locals.settings;
  attachBoxGroups(products, boxLists);
  swapProductImages(products); // Data-URIs -> /produkt-bild/:id (kleines HTML, Cache)

  res.render('menu', {
    title: 'Speisekarte – ' + settings.site_name,
    categories,
    products,
    settings,
    activeCategory: null,
    pizzaExtras,
    dealLists
  });
});

router.get('/kategorie/:slug', async (req, res) => {
  const category = await db.get('SELECT * FROM categories WHERE slug = $1 AND active = 1', [req.params.slug]);
  if (!category) return res.status(404).render('404', { title: 'Kategorie nicht gefunden' });

  // Kategorie steht fest – Rest parallel laden.
  const [products, categories, boxLists, dealLists] = await Promise.all([
    db.all("SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id IN (SELECT MIN(id) FROM products WHERE category_id = $1 GROUP BY name) AND p.slug NOT IN ('deal-grosse-pizza-getraenke','deal-mix-match','deal-grosse-hamburger-getraenk','deal-night-abholung') ORDER BY p.sort_order", [category.id]),
    db.all('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order'),
    loadBoxLists(),
    loadDealLists()
  ]);
  const settings = res.locals.settings;
  attachBoxGroups(products, boxLists);
  swapProductImages(products); // Data-URIs -> /produkt-bild/:id (kleines HTML, Cache)

  res.render('menu', {
    title: category.name + ' – ' + settings.site_name,
    categories,
    products,
    activeCategory: category.slug,
    settings,
    pizzaExtras,
    dealLists
  });
});

router.get('/produkt/:slug', async (req, res) => {
  const product = await db.get('SELECT p.*, c.name as category_name, c.slug as category_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.slug = $1', [req.params.slug]);
  if (!product) return res.status(404).render('404', { title: 'Produkt nicht gefunden' });
  
  const relatedPromise = db.all('SELECT * FROM products WHERE category_id = $1 AND id != $2 AND is_available = 1 LIMIT 4', [product.category_id, product.id]);
  const settings = res.locals.settings;
  const [related, boxLists, dealLists] = await Promise.all([relatedPromise, loadBoxLists(), loadDealLists()]);
  attachBoxGroups([product], boxLists);
  swapProductImages([product, ...related]); // Data-URIs -> /produkt-bild/:id

  res.render('product-detail', {
    title: product.name + ' – ' + settings.site_name,
    product,
    related,
    settings,
    activeMenu: 'speisekarte',
    pizzaExtras,
    dealLists,
    isPizza: product.category_slug === 'pizza'
  });
});

module.exports = router;
