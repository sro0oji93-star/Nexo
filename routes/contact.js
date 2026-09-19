const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  const settings = res.locals.settings;
  
  res.render('kontakt', {
    title: 'Kontakt – ' + settings.site_name,
    settings
  });
});

router.post('/', async (req, res) => {
  const { name, email, message } = req.body;
  try {
    if (!name || !email || !message) {
      req.session.contactFlash = 'Bitte füllen Sie alle Pflichtfelder aus.';
      return res.redirect('/kontakt');
    }
    // Einfache E-Mail-Plausibilitätsprüfung (Zeichen, @, Domain mit Punkt)
    const emailOk = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(String(email).trim());
    if (!emailOk) {
      req.session.contactFlash = 'Bitte geben Sie eine gültige E-Mail-Adresse an.';
      return res.redirect('/kontakt');
    }
    if (String(name).length > 100 || String(email).length > 150 || String(message).length > 5000) {
      req.session.contactFlash = 'Ihre Nachricht ist zu lang. Bitte kürzen Sie die Eingabe.';
      return res.redirect('/kontakt');
    }
    await db.run('INSERT INTO contact_messages (name, email, message) VALUES ($1, $2, $3)', [String(name).trim(), String(email).trim(), String(message).trim()]);
    req.session.contactFlash = 'Vielen Dank für Ihre Nachricht! Wir werden uns schnellstmöglich bei Ihnen melden.';
  } catch (err) {
    console.error('Fehler beim Speichern der Kontaktnachricht:', err);
    req.session.contactFlash = 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.';
  }
  res.redirect('/kontakt');
});

module.exports = router;
