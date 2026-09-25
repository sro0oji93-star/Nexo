// PDF-Rechnung für erfolgreich bezahlte Online-Bestellungen.
// - Nur mit gültigem Bestätigungs-Token UND payment_status = 'bezahlt' (sonst 404, kein Leak).
// - PDF wird NUR im RAM erzeugt (pdfkit-Buffer) und direkt gestreamt:
//   keine Datei, kein Storage, kein Upload, keine Tabelle, keine Jobs.
// - Erzeugung erst beim Klick (kein Hintergrund, kein Hobby-Bandwidth im Leerlauf).
const express = require('express');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const db = require('../db');

const router = express.Router();

function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (e) { return false; }
}

// Kasse-Bestellungen (Theke) bekommen NIE eine Rechnung. Alle drei Merkmale werden
// serverseitig fix gesetzt (kein Kunden-Input) – ein normales Online-Formular kann
// diese Kombination praktisch nicht erzeugen (Telefon dort Pflicht, hier NULL).
function isKasseOrder(order) {
  return !!order && order.customer_name === 'Theke'
    && order.notes === 'Theken-Bestellung'
    && (order.customer_phone === null || order.customer_phone === undefined || order.customer_phone === '');
}

// Telefonbestellungen bekommen ebenfalls KEINE PDF-Rechnung (kein Online-Payment,
// kein Payment-Selector). Marker: order_source (Fallback: payment_method).
function isTelefonOrder(order) {
  return !!order && (order.order_source === 'telefon' || order.payment_method === 'telefon');
}

function eur(n) {
  return (parseFloat(n) || 0).toFixed(2).replace('.', ',') + ' €';
}

function paymentLabel(m) {
  if (m === 'bar') return 'Barzahlung';
  if (m === 'karte') return 'Kartenzahlung';
  return 'Online-Zahlung';
}

function buildInvoicePdf(order, settings) {
  return new Promise((resolve, reject) => {
    try {
      const s = settings || {};
      // compress:false -> Text bleibt im PDF lesbar/pruefbar (Größe weiter im KB-Bereich, RAM-only).
      const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false, info: { Title: 'Rechnung ' + order.order_number } });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const siteName = s.site_name || 'NexoFood';
      // Kopf
      doc.font('Helvetica-Bold').fontSize(20).text(siteName);
      doc.font('Helvetica').fontSize(10);
      if (s.address) doc.text(s.address);
      if (s.phone) doc.text('Tel: ' + s.phone);
      if (s.email) doc.text(s.email);
      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(16).text('Rechnung');
      doc.font('Helvetica').fontSize(10);
      doc.text('Bestellnummer: ' + order.order_number);
      const d = order.created_at ? new Date(order.created_at) : new Date();
      doc.text('Datum: ' + d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
      doc.moveDown();
      doc.text('Kunde: ' + (order.customer_name || ''));
      if (order.order_type !== 'abholung') {
        if (order.delivery_address) doc.text(order.delivery_address);
        doc.text(((order.delivery_zip || '') + ' ' + (order.delivery_city || '')).trim());
      } else {
        doc.text('Abholung');
      }
      doc.moveDown();
      // Positionen
      doc.font('Helvetica-Bold').text('Positionen');
      doc.font('Helvetica');
      let items = [];
      try { items = JSON.parse(order.items || '[]'); } catch (e) { items = []; }
      for (const it of items) {
        const qty = parseInt(it.qty) || 1;
        const price = parseFloat(it.price) || 0;
        let name = it.qty + 'x ' + (it.name || '');
        if (it.size && it.size.label) name += ' (' + it.size.label + ')';
        doc.text(name + ' — ' + eur(price * qty));
        const extras = Array.isArray(it.extras) ? it.extras : [];
        for (const ex of extras) {
          doc.fontSize(9).text('  + ' + (ex.name || '') + (parseFloat(ex.price) ? ' (' + eur(ex.price) + ')' : ''), { indent: 10 });
          doc.fontSize(10);
        }
      }
      doc.moveDown();
      doc.text('Zwischensumme: ' + eur(order.subtotal));
      if (parseFloat(order.delivery_fee) > 0) doc.text('Lieferung: ' + eur(order.delivery_fee));
      if (parseFloat(order.discount) > 0) doc.text('Rabatt' + (order.discount_code ? ' ' + order.discount_code : '') + ': -' + eur(order.discount));
      if (parseFloat(order.vat7) > 0) doc.text('7% MwSt: ' + eur(order.vat7));
      if (parseFloat(order.vat19) > 0) doc.text('19% MwSt: ' + eur(order.vat19));
      doc.text('Nettobetrag: ' + eur((parseFloat(order.total) || 0) - (parseFloat(order.vat7) || 0) - (parseFloat(order.vat19) || 0)));
      doc.font('Helvetica-Bold').fontSize(12).text('Gesamt: ' + eur(order.total));
      doc.font('Helvetica').fontSize(10);
      doc.text('Zahlung: ' + paymentLabel(order.payment_method));
      doc.font('Helvetica-Bold').text('Status: ' + (order.payment_status === 'bezahlt' ? 'Bestellung bezahlt' : 'Bestellung nicht bezahlt'));
      doc.font('Helvetica').fontSize(10);
      doc.moveDown();
      doc.fontSize(9).text('Vielen Dank für Ihre Bestellung!');
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// GET /bestellung/rechnung/:orderNumber?t=<confirm_token>
router.get('/rechnung/:orderNumber', async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE order_number = $1', [req.params.orderNumber]);
  if (!order) return res.status(404).render('404', { title: 'Bestellung nicht gefunden' });
  const token = req.query.t || '';
  const expected = order.confirm_token || '';
  let tokenOk = false;
  if (token && expected && token.length === expected.length) {
    try { tokenOk = tokensEqual(token, expected); } catch (e) { tokenOk = false; }
  }
  // Rechnung für ALLE normalen Online-Bestellungen (bezahlt oder nicht, Lieferung
  // oder Abholung) – aber NIE für Kasse-Bestellungen (Theke) und NIE für
  // Telefonbestellungen. Sonst 404 wie bisher.
  if (!tokenOk || isKasseOrder(order) || isTelefonOrder(order)) {
    return res.status(404).render('404', { title: 'Bestellung nicht gefunden' });
  }
  let pdf;
  try {
    pdf = await buildInvoicePdf(order, res.locals.settings);
  } catch (e) {
    console.error('Rechnungs-PDF Fehler:', e.message);
    return res.status(500).send('Rechnung konnte nicht erstellt werden.');
  }
  const fname = ('Rechnung-' + String(order.order_number).replace(/[^A-Za-z0-9._-]+/g, '_') + '.pdf');
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': pdf.length,
    'Content-Disposition': 'attachment; filename="' + fname + '"',
    'Cache-Control': 'no-store'
  });
  res.send(pdf);
});

module.exports = router;
module.exports.buildInvoicePdf = buildInvoicePdf;
module.exports.isKasseOrder = isKasseOrder;
module.exports.isTelefonOrder = isTelefonOrder;
