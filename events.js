// Zentraler In-Process Event-Bus (Singleton).
// Wird von order.js und stripe.js genutzt, um neue Bestellungen zu melden,
// und von admin.js, um sie per Server-Sent Events (SSE) an offene Admin-Seiten zu pushen.
// Wichtig: Bei mehr als einer Server-Instanz müsste das durch Postgres LISTEN/NOTIFY
// ersetzt werden – auf Render (Free, 1 Instanz) ist der In-Process-Bus ausreichend.
const { EventEmitter } = require('events');

const bus = new EventEmitter();
// Viele offene Admin-Tabs/Reconnects dürfen keinen MaxListeners-Warn auslösen.
bus.setMaxListeners(100);

module.exports = bus;
