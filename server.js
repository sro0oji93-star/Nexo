require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Brute-Force-Schutz: max. 5 Login-Versuche / 15 Min. je IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Zu viele Versuche – bitte in 15 Minuten erneut versuchen.'
});

// Spam-Schutz: max. 30 Bestellungen / Stunde je IP
const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ success: false, message: 'Zu viele Bestellungen – bitte später erneut versuchen.' })
});

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Leichter Keep-Alive-Endpunkt für Uptime-Bots (ohne DB/Session) – z.B. alle 5 Min. aufrufen
app.get('/ping', (req, res) => {
  res.type('text').send('OK');
});

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Stripe-Webhook braucht den rohen Body (vor express.json registrieren!)
const { webhookHandler } = require('./routes/stripe');
app.post('/bestellung/stripe-webhook', express.raw({ type: 'application/json' }), webhookHandler);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(64).toString('hex'),
  resave: true,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.site_url = process.env.SITE_URL || 'http://localhost:3000';
  next();
});

const { loadSettings } = require('./middleware/settings');
app.use(loadSettings);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const indexRoutes = require('./routes/index');
const menuRoutes = require('./routes/menu');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/order');
const contactRoutes = require('./routes/contact');
const adminRoutes = require('./routes/admin');
const ownerRoutes = require('./routes/owner');
const { csrfProtection, generateToken } = require('./middleware/csrf');

// CSRF for public routes only (admin + owner routes skip validation, use session token)
app.use((req, res, next) => {
  if (req.path.startsWith('/admin') || req.path.startsWith('/eigentuemer')) {
    if (!req.session.csrfToken) req.session.csrfToken = generateToken();
    res.locals.csrfToken = req.session.csrfToken;
    return next();
  }
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
    req.session.save(err => {
      if (err) console.error('CSRF session save error:', err);
    });
  }
  res.locals.csrfToken = req.session.csrfToken;

  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const token = req.body._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    console.error('CSRF validation failed for path:', req.path);
    if (req.xhr || (req.headers['content-type'] && req.headers['content-type'].includes('application/json'))) {
      return res.status(403).json({ success: false, message: 'Ungültige Anfrage (CSRF)' });
    }
    return res.status(403).render('403', { title: 'Anfrage abgelehnt' });
  }

  next();
});

app.use('/', indexRoutes);
app.use('/speisekarte', menuRoutes);
app.use('/warenkorb', cartRoutes);
app.post('/bestellung', orderLimiter);
app.use('/bestellung', orderRoutes);
app.use('/kontakt', contactRoutes);
app.use('/admin/login', (req, res, next) => (req.method === 'POST' ? loginLimiter(req, res, next) : next()));
app.use('/admin', adminRoutes);
app.use('/eigentuemer', ownerRoutes);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Seite nicht gefunden' });
});

const db = require('./db');
db.initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
