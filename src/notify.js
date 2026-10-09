import { q } from './db.js';
import { googleNotify } from './google.js';
import { notifyApple } from './apple.js';

// Envía un aviso como notificación de la tarjeta en Wallet (Apple y/o Google).
// Devuelve cuántos pases lo recibieron; 0 si el cliente no tiene la tarjeta guardada.
export async function walletNotice(cardId, text) {
  const c = (await q('select * from cards where id=$1', [cardId])).rows[0];
  if (!c) return 0;
  const s = (await q('select * from stores where id=$1', [c.store_id])).rows[0];
  const hasApple = (await q('select 1 from apple_regs where card_id=$1 limit 1', [cardId])).rowCount > 0;
  let sent = 0, err;
  if (hasApple) {
    // Apple solo avisa si cambia el valor del campo: si el texto se repite, alternamos un carácter invisible.
    const msg = text === c.wallet_message ? text + '\u200b' : text;
    await q('update cards set wallet_message=$2, wallet_message_at=now(), updated_at=now() where id=$1', [cardId, msg]);
    sent += await notifyApple(cardId);
  }
  if (c.google_clicked_at) {
    try { if (await googleNotify(s, c, text)) sent++; } catch (e) { err = e; }
  }
  if (!sent && err) throw err;
  return sent;
}
