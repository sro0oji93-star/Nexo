// Besucherzähler (DSGVO-freundlich): pro Tag + Besucher (IP + User-Agent gehasht,
// Roh-IP wird NICHT gespeichert) genau ein Eintrag. Bots und interne Seiten zählen nicht.
const crypto = require('crypto');
const db = require('../db');

const BOT_RE = /bot|crawl|spider|slurp|mediapartners|apex|uptime|monitor|pingdom|statuscake|hetrix|betteruptime|datadog|newrelic/i;

function getCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function visitorMiddleware(req, res, next) {
  next();
  try {
    if (req.method !== 'GET') return;
    const p = req.path || '/';
    if (p.startsWith('/admin') || p.startsWith('/eigentuemer') || p === '/ping' ||
        p.startsWith('/bestellung/stripe-webhook')) return;
    const ua = req.get('user-agent') || '';
    if (BOT_RE.test(ua)) return;
    // Stabile Besucher-ID per Cookie (überlebt IP-Wechsel, z.B. Mobilfunk/IPv6-Rotation)
    let vid = getCookie(req, 'nexo_vid');
    if (!vid || !/^[0-9a-f-]{10,60}$/i.test(vid)) {
      vid = crypto.randomUUID();
      if (!res.headersSent) {
        const secure = req.secure || (req.get('x-forwarded-proto') || '').includes('https') ? '; Secure' : '';
        res.setHeader('Set-Cookie', 'nexo_vid=' + vid + '; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax' + secure);
      }
    }
    const ip = req.ip || '';
    const day = new Date().toISOString().slice(0, 10);
    const vhash = crypto.createHash('sha256').update(day + '|' + vid + '|' + ip + '|' + ua).digest('hex');
    db.run('INSERT INTO visitor_days (day, vhash) VALUES ($1, $2) ON CONFLICT DO NOTHING', [day, vhash])
      .catch(() => {});
  } catch (e) { /* Zähler darf Anfragen nie blockieren */ }
}

module.exports = { visitorMiddleware };
