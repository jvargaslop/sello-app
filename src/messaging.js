import { cfg } from './config.js';

export const emailEnabled = () => !!(cfg.msg.resendKey && cfg.msg.emailFrom);
export const whatsappEnabled = () => !!(cfg.msg.waToken && cfg.msg.waPhoneId);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fill = (tpl, v) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (v[k] ?? m));
export const unsubUrl = (cardId, token) => `${cfg.base}/u/${cardId}/${token}`;

export async function sendEmail({ store, to, subject, text, unsub }) {
  const color = /^#[0-9a-fA-F]{6}$/.test(store.color) ? store.color : '#0F6B57';
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f6f6f7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif"><div style="max-width:480px;margin:0 auto;padding:24px"><div style="background:#fff;border:1px solid #e7e7eb;border-radius:16px;padding:28px"><p style="margin:0 0 16px;font-weight:600;color:${color}">${esc(store.name)}</p><p style="margin:0;font-size:16px;line-height:1.55;color:#17171b;white-space:pre-line">${esc(text)}</p></div><p style="font-size:12px;line-height:1.5;color:#6c6c78;text-align:center;margin-top:16px">Recibes este mensaje porque autorizaste a ${esc(store.name)} a contactarte.<br><a href="${unsub}" style="color:#6c6c78">Dejar de recibir mensajes</a></p></div></body></html>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.msg.resendKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${String(store.name).replace(/[<>"]/g, '')} <${cfg.msg.emailFrom}>`,
      to: [to], subject, html,
      text: `${text}\n\nDejar de recibir mensajes: ${unsub}`,
      headers: { 'List-Unsubscribe': `<${unsub}>` }
    })
  });
  if (!r.ok) throw new Error(`email ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// WhatsApp solo permite iniciar conversación con plantillas aprobadas por Meta (3 variables: nombre, negocio, detalle).
export async function sendWhatsApp({ to, template, params }) {
  const clean = (v) => String(v).replace(/\s+/g, ' ').trim().slice(0, 500) || '-';
  const r = await fetch(`https://graph.facebook.com/v20.0/${cfg.msg.waPhoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.msg.waToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: to.replace(/\D/g, ''), type: 'template',
      template: { name: template, language: { code: cfg.msg.waLang },
        components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: clean(p) })) }] }
    })
  });
  if (!r.ok) throw new Error(`whatsapp ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
