const express = require('express');
const router = express.Router();
const db = require('../db');
const { swapProductImages } = require('../image');

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Hero-Deals (nur über Hero-Button bestellbar) nicht im Homepage-Raster zeigen
  const products = await db.all("SELECT p.*, c.name as category_name, c.slug as category_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id IN (SELECT MIN(id) FROM products GROUP BY name) AND p.slug NOT IN ('deal-grosse-pizza-getraenke','deal-mix-match','deal-grosse-hamburger-getraenk','deal-night-abholung') ORDER BY c.sort_order, p.sort_order");
  // Deals separat für den Hero-Button laden (bleiben bestellbar, aber unsichtbar im Menü)
  const heroDeals = await db.all("SELECT * FROM products WHERE slug IN ('deal-grosse-pizza-getraenke','deal-mix-match','deal-grosse-hamburger-getraenk','deal-night-abholung') AND is_available = 1");
  const categories = await db.all('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order');
  // Erstes Produktbild je Kategorie für die Kategorie-Kreise (Data-URIs -> Cache-URL)
  const catImgs = await db.all("SELECT DISTINCT ON (p.category_id) p.category_id, p.id AS pid, p.image AS pimg FROM products p WHERE p.is_available = 1 AND p.image IS NOT NULL ORDER BY p.category_id, p.sort_order");
  const catImgMap = {};
  for (const r of catImgs) {
    catImgMap[r.category_id] = (typeof r.pimg === 'string' && r.pimg.indexOf('data:image') === 0)
      ? '/produkt-bild/' + r.pid
      : r.pimg;
  }
  const banners = await db.all('SELECT * FROM banners WHERE active = 1 ORDER BY sort_order');
  const testimonials = await db.all('SELECT * FROM testimonials WHERE active = 1 ORDER BY RANDOM() LIMIT 3');
  const heroSlides = await db.all('SELECT * FROM hero_slides WHERE active = 1 ORDER BY sort_order');
  const settings = res.locals.settings;
  swapProductImages(products); // Data-URIs -> /produkt-bild/:id (kleines HTML, Cache)
  
  res.render('index', {
    title: settings.site_name + ' – ' + settings.site_description,
    bodyClass: 'homepage',
    products,
    heroDeals,
    categories,
    catImgMap,
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

module.exports = router;
