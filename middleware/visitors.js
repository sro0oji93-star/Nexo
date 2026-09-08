// Besucherzähler (DSGVO-freundlich): pro Tag + Besucher (IP + User-Agent gehasht,
// Roh-IP wird NICHT gespeichert) genau ein Eintrag. Bots und interne Seiten zählen nicht.
const crypto = require('crypto');
const db = require('../db');

const BOT_RE = /bot|crawl|spider|slurp|mediapartners|apex|uptime|monitor|pingdom|statuscake|hetrix|betteruptime|datadog|newrelic/i;

function visitorMiddleware(req, res, next) {
  next();
  try {
    if (req.method !== 'GET') return;
    const p = req.path || '/';
    if (p.startsWith('/admin') || p.startsWith('/eigentuemer') || p === '/ping' ||
        p.startsWith('/bestellung/stripe-webhook')) return;
    const ua = req.get('user-agent') || '';
    if (BOT_RE.test(ua)) return;
    const ip = req.ip || '';
    const day = new Date().toISOString().slice(0, 10);
    const vhash = crypto.createHash('sha256').update(day + '|' + ip + '|' + ua).digest('hex');
    db.run('INSERT INTO visitor_days (day, vhash) VALUES ($1, $2) ON CONFLICT DO NOTHING', [day, vhash])
      .catch(() => {});
  } catch (e) { /* Zähler darf Anfragen nie blockieren */ }
}

module.exports = { visitorMiddleware };
