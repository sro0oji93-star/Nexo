// Stripe Online-Zahlung: Checkout-Session + Webhook.
// Ablauf: Bestellung wird als wartet_auf_zahlung angelegt (kein Druck/Ton),
// nach erfolgreicher Zahlung setzt der Webhook sie auf neu/bezahlt.
const db = require('../db');

function client() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes('placeholder')) return null;
  return require('stripe')(key);
}

function siteUrl(req) {
  return (process.env.SITE_URL || ((req && req.protocol + '://' + req.get('host')) || 'http://localhost:3000')).replace(/\/$/, '');
}

async function createCheckoutSession(order, req) {
  const stripe = client();
  if (!stripe) throw new Error('Stripe nicht konfiguriert');
  const base = siteUrl(req);
  const itemCount = Array.isArray(order.items) ? order.items.reduce((s, it) => s + (parseInt(it.qty) || 0), 0) : 0;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    locale: 'de',
    customer_email: order.customer_email || undefined,
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: { name: 'Bestellung ' + order.order_number + ' (' + itemCount + ' Artikel)' },
        unit_amount: Math.round(parseFloat(order.total) * 100)
      },
      quantity: 1
    }],
    metadata: { order_id: String(order.id), order_number: order.order_number },
    success_url: base + '/bestellung/bestellung/' + order.order_number + '?bezahlt=1',
    cancel_url: base + '/bestellung?abgebrochen=1',
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60
  });
  return session;
}

// POST /bestellung/stripe-webhook (express.raw body!)
async function webhookHandler(req, res) {
  const stripe = client();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(500).send('Stripe nicht konfiguriert');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (err) {
    console.error('Stripe-Signatur ungültig:', err.message);
    return res.status(400).send('Ungültige Signatur');
  }
  try {
    const session = event.data.object || {};
    const orderId = session.metadata && session.metadata.order_id;
    if (event.type === 'checkout.session.completed' && orderId) {
      await db.run(
        "UPDATE orders SET order_status = 'neu', payment_status = 'bezahlt' WHERE id = $1 AND order_status = 'wartet_auf_zahlung'",
        [orderId]
      );
      console.log('Stripe bezahlt, Bestellung freigegeben:', orderId);
    } else if (event.type === 'checkout.session.expired' && orderId) {
      await db.run(
        "UPDATE orders SET order_status = 'storniert' WHERE id = $1 AND order_status = 'wartet_auf_zahlung'",
        [orderId]
      );
      console.log('Stripe abgelaufen, Bestellung storniert:', orderId);
    }
  } catch (err) {
    console.error('Stripe-Webhook Fehler:', err);
  }
  res.json({ received: true });
}

module.exports = { createCheckoutSession, webhookHandler };
