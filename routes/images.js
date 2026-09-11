// Produktbilder direkt aus der DB liefern (statt Base64 im HTML einzubetten).
// 7 Tage Browser-Cache: klein bleibendes HTML + schnelle Folgeseiten.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { parseDataUri } = require('../image');

router.get('/produkt-bild/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!isFinite(id)) return res.status(404).send('Nicht gefunden');
  let row = null;
  try {
    row = await db.get('SELECT image FROM products WHERE id = $1', [id]);
  } catch (e) {
    return res.status(500).send('Fehler');
  }
  const parsed = row && parseDataUri(row.image);
  if (!parsed) return res.status(404).send('Nicht gefunden');
  res.type(parsed.mime);
  res.set('Cache-Control', 'public, max-age=604800'); // 7 Tage
  res.send(parsed.buffer);
});

module.exports = router;
