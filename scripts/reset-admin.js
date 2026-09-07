// Passwort-Reset für Admin (in Render Shell ausführen):
//   node scripts/reset-admin.js <benutzer> <neues-passwort>
// Beispiel: node scripts/reset-admin.js admin admin123
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

async function main() {
  const username = process.argv[2];
  const password = process.argv[3];
  if (!username || !password || password.length < 6) {
    console.error('Benutzung: node scripts/reset-admin.js <benutzer> <neues-passwort-mind-6-zeichen>');
    process.exit(1);
  }
  await db.initialize();
  const hash = bcrypt.hashSync(password, 10);
  const existing = await db.get('SELECT id FROM admins WHERE username = $1', [username]);
  if (existing) {
    await db.run('UPDATE admins SET password = $1 WHERE username = $2', [hash, username]);
    console.log('OK: Passwort für "' + username + '" wurde zurückgesetzt.');
  } else {
    await db.run('INSERT INTO admins (username, password, display_name) VALUES ($1, $2, $3)', [username, hash, 'Admin']);
    console.log('OK: Admin "' + username + '" wurde neu angelegt.');
  }
  process.exit(0);
}

main().catch(err => { console.error('FEHLER:', err.message); process.exit(1); });
