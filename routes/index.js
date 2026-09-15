const express = require('express');
const router = express.Router();
const db = require('../db');
const { swapProductImages, swapRowImages } = require('../image');

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Hero-Deals (nur über Hero-Button bestellbar) nicht im Homepage-Raster zeigen
  const products = await db.all("SELECT p.*, c.name as category_name, c.slug as category_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id IN (SELECT MIN(id) FROM products GROUP BY name) AND p.slug NOT IN ('deal-grosse-pizza-getraenke','deal-mix-match','deal-grosse-hamburger-getraenk','deal-night-abholung') ORDER BY c.sort_order, p.sort_order");
  // Deals separat für den Hero-Button laden (bleiben bestellbar, aber unsichtbar im Menü)
  const heroDeals = await db.all("SELECT * FROM products WHERE slug IN ('deal-grosse-pizza-getraenke','deal-mix-match','deal-grosse-hamburger-getraenk','deal-night-abholung') AND is_available = 1");
  const categories = await db.all('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order');
  const banners = await db.all('SELECT * FROM banners WHERE active = 1 ORDER BY sort_order');
  const testimonials = await db.all('SELECT * FROM testimonials WHERE active = 1 ORDER BY RANDOM() LIMIT 3');
  const heroSlides = await db.all('SELECT * FROM hero_slides WHERE active = 1 ORDER BY sort_order');
  const settings = res.locals.settings;
  swapProductImages(products); // Data-URIs -> /produkt-bild/:id (kleines HTML, Cache)
  heroSlides.forEach(s => swapRowImages(s, 'hero_slides')); // Hero-Bilder -> /db-bild/...
  
  res.render('index', {
    title: settings.site_name + ' – ' + settings.site_description,
    bodyClass: 'homepage',
    products,
    heroDeals,
    categories,
    banners,
    testimonials,
    heroSlides,
    settings
  });
});

router.get('/impressum', async (req, res) => {
  const settings = res.locals.settings;
  res.render('impressum', {
    title: 'Impressum – ' + settings.site_name,
    settings
  });
});

router.get('/datenschutz', async (req, res) => {
  const settings = res.locals.settings;
  res.render('datenschutz', {
    title: 'Datenschutzerklärung – ' + settings.site_name,
    settings
  });
});

router.get('/allergene', async (req, res) => {
  const settings = res.locals.settings;
  res.render('allergene', {
    title: 'Allergene & Zusatzstoffe – ' + settings.site_name,
    settings
  });
});

router.get('/agb', async (req, res) => {
  const settings = res.locals.settings;
  res.render('agb', {
    title: 'AGB – ' + settings.site_name,
    settings
  });
});

// Sitemap (SEO): statische Seiten + Kategorien + Produkte, immer aktuell aus der DB.
// Nur lesend, keine Bilder/Uploads betroffen.
router.get('/sitemap.xml', async (req, res) => {
  try {
    const base = (res.locals.site_url || ('https://' + req.get('host'))).replace(/\/$/, '');
    const urls = ['/', '/speisekarte', '/kontakt', '/warenkorb', '/bestellung'];
    const cats = await db.all('SELECT slug FROM categories WHERE active = 1 ORDER BY sort_order');
    cats.forEach(c => urls.push('/speisekarte/kategorie/' + c.slug));
    const prods = await db.all("SELECT slug FROM products WHERE is_available = 1 AND slug NOT IN ('deal-grosse-pizza-getraenke','deal-mix-match','deal-grosse-hamburger-getraenk','deal-night-abholung') GROUP BY slug");
    prods.forEach(p => urls.push('/speisekarte/produkt/' + p.slug));
    const today = new Date().toISOString().slice(0, 10);
    res.type('application/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
      + urls.map(u => '<url><loc>' + base + u + '</loc><lastmod>' + today + '</lastmod></url>').join('')
      + '</urlset>');
  } catch (e) {
    res.status(500).type('text/plain').send('sitemap error');
  }
});

module.exports = router;
