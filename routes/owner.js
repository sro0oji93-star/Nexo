// Separater Eigentümer-Bereich: eigene URL (/eigentuemer), eigene Logindaten,
// sieht ALLE Bestellungen (auch gelöschte) + Provision + Benutzerverwaltung.
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');

function requireOwner(req, res, next) {
  if (req.session && req.session.owner) return next();
  res.redirect('/eigentuemer/login');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : todayStr();
}

function commissionRate(settings) {
  const v = parseFloat(settings && settings.commission_per_order);
  return isFinite(v) && v >= 0 ? v : 0.40;
}

function parseItems(order) {
  try {
    order.itemsParsed = JSON.parse(order.items || '[]');
  } catch (e) {
    order.itemsParsed = [];
  }
  return order;
}

// ---------- Login / Setup ----------
router.get('/login', async (req, res) => {
  if (req.session && req.session.owner) return res.redirect('/eigentuemer');
  const ownerCount = (await db.get("SELECT COUNT(*) as count FROM admins WHERE role = 'owner'")).count;
  res.render('owner/login', {
    title: 'Eigentümer Login',
    setup: ownerCount === 0,
    error: null
  });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const owner = await db.get("SELECT * FROM admins WHERE username = $1 AND role = 'owner'", [username]);
  if (owner && bcrypt.compareSync(password || '', owner.password)) {
    req.session.owner = { id: owner.id, username: owner.username, display_name: owner.display_name };
    req.session.save(err => {
      if (err) return res.status(500).send('Session-Fehler');
      res.redirect('/eigentuemer');
    });
  } else {
    const ownerCount = (await db.get("SELECT COUNT(*) as count FROM admins WHERE role = 'owner'")).count;
    res.render('owner/login', { title: 'Eigentümer Login', setup: ownerCount === 0, error: 'Ungültige Anmeldedaten' });
  }
});

// Ersteinrichtung: nur wenn noch kein Eigentümer existiert
router.post('/setup', async (req, res) => {
  const ownerCount = (await db.get("SELECT COUNT(*) as count FROM admins WHERE role = 'owner'")).count;
  if (ownerCount > 0) return res.redirect('/eigentuemer/login');
  const { username, password, password2 } = req.body;
  if (!username || username.trim().length < 3) {
    return res.render('owner/login', { title: 'Eigentümer Login', setup: true, error: 'Benutzername: mindestens 3 Zeichen' });
  }
  if (!password || password.length < 8 || password !== password2) {
    return res.render('owner/login', { title: 'Eigentümer Login', setup: true, error: 'Passwort: mindestens 8 Zeichen, beide gleich' });
  }
  const exists = await db.get('SELECT id FROM admins WHERE username = $1', [username.trim()]);
  if (exists) {
    return res.render('owner/login', { title: 'Eigentümer Login', setup: true, error: 'Benutzername bereits vergeben' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const r = await db.run(
    "INSERT INTO admins (username, password, display_name, role) VALUES ($1, $2, $3, 'owner') RETURNING id",
    [username.trim(), hash, 'Eigentümer']
  );
  req.session.owner = { id: r.rows[0].id, username: username.trim(), display_name: 'Eigentümer' };
  req.session.save(err => {
    if (err) return res.status(500).send('Session-Fehler');
    res.redirect('/eigentuemer');
  });
});

router.post('/logout', (req, res) => {
  req.session.owner = null;
  req.session.save(() => res.redirect('/eigentuemer/login'));
});

// ---------- Dashboard ----------
router.get('/', requireOwner, async (req, res) => {
  const today = todayStr();
  const rate = commissionRate(res.locals.settings);
  const dayCount = (await db.get('SELECT COUNT(*) as count FROM orders WHERE created_at::date = $1', [today])).count;
  const dayRevenue = (await db.get("SELECT COALESCE(SUM(total),0) as total FROM orders WHERE created_at::date = $1 AND order_status != 'storniert'", [today])).total;
  const dayDeleted = (await db.get('SELECT COUNT(*) as count FROM orders WHERE created_at::date = $1 AND COALESCE(is_deleted,0) = 1', [today])).count;
  const monthCount = (await db.get("SELECT COUNT(*) as count FROM orders WHERE TO_CHAR(created_at,'YYYY-MM') = TO_CHAR(NOW(),'YYYY-MM')")).count;
  const monthRevenue = (await db.get("SELECT COALESCE(SUM(total),0) as total FROM orders WHERE TO_CHAR(created_at,'YYYY-MM') = TO_CHAR(NOW(),'YYYY-MM') AND order_status != 'storniert'")).total;
  let visitorsToday = 0, visitorsWeek = [];
  try {
    visitorsToday = (await db.get('SELECT COUNT(*) as count FROM visitor_days WHERE day = $1', [today])).count;
    visitorsWeek = await db.all("SELECT day, COUNT(*) as count FROM visitor_days WHERE day >= CURRENT_DATE - INTERVAL '6 days' GROUP BY day ORDER BY day DESC");
  } catch (e) { console.error('Besucherzahlen übersprungen:', e.message); }
  res.render('owner/dashboard', {
    title: 'Eigentümer Dashboard',
    today, rate, dayCount, dayRevenue, dayDeleted, monthCount, monthRevenue,
    visitorsToday, visitorsWeek,
    success: null
  });
});

// ---------- Alle Bestellungen (inkl. gelöschte) ----------
router.get('/bestellungen', requireOwner, async (req, res) => {
  const datum = validDate(req.query.datum);
  const rate = commissionRate(res.locals.settings);
  const orders = await db.all('SELECT * FROM orders WHERE created_at::date = $1 ORDER BY created_at DESC', [datum]);
  orders.forEach(parseItems);
  const received = orders.length;
  const deleted = orders.filter(o => o.is_deleted).length;
  const revenue = orders.filter(o => o.order_status !== 'storniert').reduce((s, o) => s + parseFloat(o.total || 0), 0);
  res.render('owner/orders', {
    title: 'Alle Bestellungen',
    datum, rate, orders, received, deleted, revenue,
    commission: received * rate
  });
});

// ---------- Provision ----------
router.post('/provision', requireOwner, async (req, res) => {
  const v = String(req.body.commission_per_order || '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) {
    return res.redirect('/eigentuemer');
  }
  await db.run('UPDATE settings SET value = $1 WHERE key = $2', [v, 'commission_per_order']);
  res.redirect('/eigentuemer');
});

// ---------- Benutzer (Manager für /admin) ----------
router.get('/benutzer', requireOwner, async (req, res) => {
  const users = await db.all('SELECT id, username, display_name, role, created_at FROM admins ORDER BY id');
  res.render('owner/users', { title: 'Benutzer', users, error: null, success: null });
});

router.post('/benutzer', requireOwner, async (req, res) => {
  const users = await db.all('SELECT id, username, display_name, role, created_at FROM admins ORDER BY id');
  const { username, password, display_name } = req.body;
  if (!username || username.trim().length < 3) {
    return res.render('owner/users', { title: 'Benutzer', users, error: 'Benutzername: mindestens 3 Zeichen', success: null });
  }
  if (!password || password.length < 8) {
    return res.render('owner/users', { title: 'Benutzer', users, error: 'Passwort: mindestens 8 Zeichen', success: null });
  }
  const exists = await db.get('SELECT id FROM admins WHERE username = $1', [username.trim()]);
  if (exists) {
    return res.render('owner/users', { title: 'Benutzer', users, error: 'Benutzername bereits vergeben', success: null });
  }
  const hash = bcrypt.hashSync(password, 10);
  await db.run("INSERT INTO admins (username, password, display_name, role) VALUES ($1, $2, $3, 'manager')",
    [username.trim(), hash, display_name || username.trim()]);
  const users2 = await db.all('SELECT id, username, display_name, role, created_at FROM admins ORDER BY id');
  res.render('owner/users', { title: 'Benutzer', users: users2, error: null, success: 'Benutzer erstellt – Login über /admin möglich' });
});

router.post('/benutzer/:id/passwort', requireOwner, async (req, res) => {
  const { password } = req.body;
  const users = await db.all('SELECT id, username, display_name, role, created_at FROM admins ORDER BY id');
  if (!password || password.length < 8) {
    return res.render('owner/users', { title: 'Benutzer', users, error: 'Neues Passwort: mindestens 8 Zeichen', success: null });
  }
  const target = await db.get('SELECT * FROM admins WHERE id = $1', [req.params.id]);
  if (!target || target.role === 'owner') {
    return res.render('owner/users', { title: 'Benutzer', users, error: 'Eigentümer-Passwort hier nicht änderbar', success: null });
  }
  await db.run('UPDATE admins SET password = $1 WHERE id = $2', [bcrypt.hashSync(password, 10), req.params.id]);
  const users2 = await db.all('SELECT id, username, display_name, role, created_at FROM admins ORDER BY id');
  res.render('owner/users', { title: 'Benutzer', users: users2, error: null, success: 'Passwort zurückgesetzt' });
});

router.post('/benutzer/:id/loeschen', requireOwner, async (req, res) => {
  const target = await db.get('SELECT * FROM admins WHERE id = $1', [req.params.id]);
  if (target && target.role !== 'owner') {
    await db.run('DELETE FROM admins WHERE id = $1', [req.params.id]);
  }
  res.redirect('/eigentuemer/benutzer');
});

// Eigenes Eigentümer-Passwort ändern
router.post('/passwort', requireOwner, async (req, res) => {
  const users = await db.all('SELECT id, username, display_name, role, created_at FROM admins ORDER BY id');
  const { current_password, new_password } = req.body;
  const me = await db.get('SELECT * FROM admins WHERE id = $1', [req.session.owner.id]);
  if (!me || !bcrypt.compareSync(current_password || '', me.password)) {
    return res.render('owner/users', { title: 'Benutzer', users, error: 'Aktuelles Passwort falsch', success: null });
  }
  if (!new_password || new_password.length < 8) {
    return res.render('owner/users', { title: 'Benutzer', users, error: 'Neues Passwort: mindestens 8 Zeichen', success: null });
  }
  await db.run('UPDATE admins SET password = $1 WHERE id = $2', [bcrypt.hashSync(new_password, 10), me.id]);
  const users2 = await db.all('SELECT id, username, display_name, role, created_at FROM admins ORDER BY id');
  res.render('owner/users', { title: 'Benutzer', users: users2, error: null, success: 'Eigenes Passwort geändert' });
});

module.exports = router;
