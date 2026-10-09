// Uso: npm run test-wallet -- <id-de-la-tarjeta> "Mensaje de prueba"
// Para ver ids:  select id, created_at from cards order by created_at desc limit 5;
import { walletNotice } from '../src/notify.js';
import { pool } from '../src/db.js';
const [id, ...t] = process.argv.slice(2);
if (!id) { console.error('Uso: npm run test-wallet -- <id-de-la-tarjeta> "Mensaje"'); process.exit(1); }
const n = await walletNotice(id, t.join(' ') || 'Aviso de prueba desde Sello');
console.log(n ? `Aviso enviado a ${n} pase(s)` : 'Esa tarjeta no tiene el pase guardado en Wallet (o Wallet no está configurado)');
await pool.end();
