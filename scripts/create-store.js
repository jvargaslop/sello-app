// Uso: npm run create-store -- "Café Galeras" cafe-galeras "Un café americano gratis" 10 "#0F6B57"
// (Más fácil: usa la página /admin.)
import { cfg } from '../src/config.js';
import { pool } from '../src/db.js';
import { createStore } from '../src/stores.js';
const [name, slug, reward, goal = '10', color = '#0F6B57'] = process.argv.slice(2);
if (!name || !reward) { console.error('Uso: npm run create-store -- "Nombre" slug "Premio" [sellos] [#color]'); process.exit(1); }
const r = await createStore({ name, slug, reward, goal: +goal, color });
console.log(`\nNegocio creado: ${name}\nSticker (QR/NFC): ${cfg.base}/c/${r.slug}\nQR en imagen:     ${cfg.base}/qr/${r.slug}.svg\nPanel:            ${cfg.base}/panel\nClave del panel:  ${r.key}\n\nGuarda la clave: no se puede recuperar, solo crear otra.`);
await pool.end();
