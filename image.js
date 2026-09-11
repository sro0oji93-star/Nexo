// Bild-Optimierung: Uploads verkleinern, damit keine MB-großen Data-URIs in der DB landen.
// sharp ist optional – ohne sharp wird das Original gespeichert.
let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('sharp nicht verfügbar, Bilder werden unkomprimiert gespeichert.');
}

function toDataUri(buffer, mimetype) {
  return 'data:' + mimetype + ';base64,' + buffer.toString('base64');
}

// Buffer -> optimierter Buffer (maxBreite px, Format beibehalten wo sinnvoll)
async function optimizeBuffer(buffer, mimetype, maxWidth, quality) {
  if (!sharp) return null;
  const mime = String(mimetype || '');
  if (mime === 'image/svg+xml' || mime.includes('gif')) return null; // Vektor/Animation: Original behalten
  let pipeline = sharp(buffer, { failOn: 'none' }).rotate();
  try {
    const meta = await pipeline.metadata();
    if (meta.width && meta.width > maxWidth) {
      pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
    }
  } catch (e) {
    return null;
  }
  if (mime.includes('webp')) {
    return { buffer: await pipeline.webp({ quality }).toBuffer(), mimetype: 'image/webp' };
  }
  if (mime.includes('png')) {
    return { buffer: await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer(), mimetype: 'image/png' };
  }
  return { buffer: await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer(), mimetype: 'image/jpeg' };
}

// Für Admin-Uploads: max 1280px, gute Qualität
async function optimizeUpload(buffer, mimetype) {
  try {
    const out = await optimizeBuffer(buffer, mimetype, 1280, 72);
    if (!out) return toDataUri(buffer, mimetype);
    return toDataUri(out.buffer, out.mimetype);
  } catch (e) {
    console.error('Bild-Optimierung fehlgeschlagen, Original wird gespeichert:', e.message);
    return toDataUri(buffer, mimetype);
  }
}

// Für Bestandsdaten: Data-URIs über maxBytes verkleinern (Standard: 300KB / 1000px / Q65)
async function shrinkDataUri(uri, maxBytes, maxWidth, quality) {
  if (!uri || typeof uri !== 'string') return uri;
  maxBytes = maxBytes || 300 * 1024;
  maxWidth = maxWidth || 1000;
  quality = quality || 65;
  const m = uri.match(/^data:(image\/[a-z0-9+.-]+);base64,([\s\S]+)$/i);
  if (!m) return uri;
  if (Math.floor(m[2].length * 0.75) <= maxBytes) return uri;
  try {
    const out = await optimizeBuffer(Buffer.from(m[2], 'base64'), m[1], maxWidth, quality);
    if (!out) return uri;
    const smaller = toDataUri(out.buffer, out.mimetype);
    return smaller.length < uri.length ? smaller : uri;
  } catch (e) {
    return uri;
  }
}

module.exports = { optimizeUpload, shrinkDataUri, toDataUri };
