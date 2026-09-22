require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const db = require('./db');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
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

// Spam-Schutz: max. 10 Kontaktnachrichten / Stunde je IP
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    req.session.contactFlash = 'Zu viele Nachrichten – bitte versuchen Sie es später erneut.';
    res.redirect('/kontakt');
  }
});

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Leichter Keep-Alive-Endpunkt für Uptime-Bots (ohne DB/Session) – z.B. alle 5 Min. aufrufen
app.get('/ping', (req, res) => {
  res.type('text').send('OK');
});

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],
      'script-src-attr': ["'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      'img-src': ["'self'", 'data:', 'https:'],
      'connect-src': ["'self'", 'https://router.project-osrm.org', 'https://photon.komoot.io'],
      'frame-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'", 'https://checkout.stripe.com'],
      'frame-ancestors': ["'self'"],
      'upgrade-insecure-requests': []
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Stripe-Webhook braucht den rohen Body (vor express.json registrieren!)
const { webhookHandler } = require('./routes/stripe');
app.post('/bestellung/stripe-webhook', express.raw({ type: 'application/json' }), webhookHandler);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// gzip für HTML/CSS/JS (vor static registrieren)
app.use(compression());

// Bilder: 1 Jahr immutable cachen (Dateinamen sind versioniert bzw. selten geändert)
app.use('/images', express.static(path.join(__dirname, 'public', 'images'), { maxAge: '1y', immutable: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new PgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(64).toString('hex'),
  resave: false,
  saveUninitialized: false,
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
  res.locals.currentUrl = req.originalUrl || '/';
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
const { csrfProtection, generateToken, tokensMatch } = require('./middleware/csrf');

// CSRF-Schutz für ALLE Routen (inkl. admin/owner).
// Ausnahmen:
//  - Login/Setup (vor Session) und Druck-Marker (unschädlicher POST aus dem Kiosk-JS)
//  - Multipart-Routen (Bild-Upload): CSRF wird dort NACH multer geprüft (siehe verifyCsrf in admin.js),
//    da req.body bei multipart/form-data erst nach multer gefüllt ist.
const CSRF_EXEMPT_EXACT = [
  '/admin/login',
  '/eigentuemer/login',
  '/eigentuemer/setup',
  '/admin/produkte',
  '/admin/banner',
  '/admin/testimonials',
  '/admin/einstellungen/hero-slides'
];
const CSRF_EXEMPT_PREFIX = [
  '/admin/api/bestellungen',            // Druck-Marker (Kiosk-POST ohne Token)
  '/admin/produkte/bearbeiten/',        // multipart (Bild-Upload)
  '/admin/testimonials/bearbeiten/',    // multipart (Bild-Upload)
  '/admin/einstellungen/hero-slides/'   // multipart (Erstellen/Bearbeiten)
];
app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
    req.session.save(err => {
      if (err) console.error('CSRF session save error:', err);
    });
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (req.method === 'POST' && CSRF_EXEMPT_EXACT.includes(req.path)) {
    return next();
  }
  if (CSRF_EXEMPT_PREFIX.some(p => req.path.startsWith(p))) {
    return next();
  }

  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  const token = req.body._csrf || req.headers['x-csrf-token'];
  if (!tokensMatch(token, req.session.csrfToken)) {
    console.error('CSRF validation failed for path:', req.path);
    if (req.xhr || (req.headers['content-type'] && req.headers['content-type'].includes('application/json'))) {
      return res.status(403).json({ success: false, message: 'Ungültige Anfrage (CSRF)' });
    }
    return res.status(403).render('403', { title: 'Anfrage abgelehnt' });
  }

  next();
});

const { visitorMiddleware } = require('./middleware/visitors');
app.use(visitorMiddleware);

app.use('/', indexRoutes);
app.use('/speisekarte', menuRoutes);
app.use('/warenkorb', cartRoutes);
app.post('/bestellung', orderLimiter);
app.use('/bestellung', orderRoutes);
app.use('/bestellung', require('./routes/invoice')); // PDF-Rechnung (RAM-only, nur bezahlt)
app.use('/kontakt', (req, res, next) => (req.method === 'POST' ? contactLimiter(req, res, next) : next()));
app.use('/kontakt', contactRoutes);
app.use('/admin/login', (req, res, next) => (req.method === 'POST' ? loginLimiter(req, res, next) : next()));
app.use('/admin', adminRoutes);
app.use('/admin', require('./routes/kasse')); // Theken-Kasse (GET Seite + POST Bestellung)
// Brute-Force-Schutz auch für den Eigentümer-Login und die Ersteinrichtung
app.use('/eigentuemer/login', (req, res, next) => (req.method === 'POST' ? loginLimiter(req, res, next) : next()));
app.use('/eigentuemer/setup', (req, res, next) => (req.method === 'POST' ? loginLimiter(req, res, next) : next()));
app.use('/eigentuemer', ownerRoutes);
app.use(require('./routes/images')); // /produkt-bild/:id (DB-Bilder mit Cache)
app.use('/', require('./routes/tracking')); // /verfolgung/* (Kunden-Tracking, SSE), /fahrer/* (Fahrer-QR)

app.use((req, res) => {
  res.status(404).render('404', { title: 'Seite nicht gefunden' });
});

db.initialize().then(() => {
  // Liefer-Timer nach Restart/Redeploy neu stellen (kein fester Sweeper, keine Polls).
  require('./delivery-scheduler').start().catch(err => console.error('Scheduler-Start Fehler:', err.message));
  app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
