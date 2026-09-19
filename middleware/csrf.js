const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfProtection(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }
  res.locals.csrfToken = req.session.csrfToken;

  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const token = req.body._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    console.error('CSRF validation failed');
    if (req.xhr || req.headers['content-type'] === 'application/json') {
      return res.status(403).json({ success: false, message: 'Ungültige Anfrage (CSRF)' });
    }
    return res.status(403).render('403', { title: 'Anfrage abgelehnt' });
  }

  next();
}

// CSRF-Prüfung für Multipart-Routen: wird NACH multer eingesetzt, da req.body
// bei multipart/form-data erst dann gefüllt ist. Antwortet direkt bei Fehler.
function verifyCsrf(req, res) {
  const token = req.body._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    console.error('CSRF validation failed (multipart) for path:', req.originalUrl);
    if (req.xhr || (req.headers['content-type'] && req.headers['content-type'].includes('application/json'))) {
      res.status(403).json({ success: false, message: 'Ungültige Anfrage (CSRF)' });
    } else {
      res.status(403).render('403', { title: 'Anfrage abgelehnt' });
    }
    return false;
  }
  return true;
}

module.exports = { csrfProtection, generateToken, verifyCsrf };
