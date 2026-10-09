import fs from 'fs';
import jwt from 'jsonwebtoken';
import { GoogleAuth } from 'google-auth-library';
import { cfg } from './config.js';

let creds = null, auth = null;
function load() {
  if (creds || !cfg.google.creds) return creds;
  const raw = cfg.google.creds.trim();
  creds = JSON.parse(raw.startsWith('{') ? raw : fs.readFileSync(raw, 'utf8'));
  return creds;
}
export const googleEnabled = () => !!(cfg.google.issuer && cfg.google.creds);

const classId = (s) => `${cfg.google.issuer}.store_${s.slug.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
const objectId = (c) => `${cfg.google.issuer}.card_${c.id}`;
const t = (v) => ({ defaultValue: { language: 'es-419', value: v } });
const hex = (s) => s.color.slice(1);

function loyaltyClass(s) {
  return {
    id: classId(s),
    issuerName: s.name,
    programName: 'Tarjeta de fidelidad',
    programLogo: { sourceUri: { uri: `${cfg.base}/img/logo.png?c=${hex(s)}&s=256` }, contentDescription: t(s.name) },
    hexBackgroundColor: s.color,
    countryCode: 'CO',
    reviewStatus: 'UNDER_REVIEW'
  };
}

function loyaltyObject(s, c) {
  const n = Math.min(c.stamps, s.goal);
  return {
    id: objectId(c),
    classId: classId(s),
    state: 'ACTIVE',
    accountId: c.id,
    accountName: 'Cliente',
    barcode: { type: 'QR_CODE', value: c.id, alternateText: c.id.slice(0, 8) },
    loyaltyPoints: { label: 'Sellos', balance: { string: `${n} de ${s.goal}` } },
    heroImage: {
      sourceUri: { uri: `${cfg.base}/img/stamps/${s.goal}/${n}.png?c=${hex(s)}&w=1032&h=336` },
      contentDescription: t(`${n} de ${s.goal} sellos`)
    },
    textModulesData: [
      { id: 'reward', header: 'Premio', body: s.reward },
      { id: 'how', header: 'Cómo sumar sellos', body: 'Escanea el sticker del local o acerca tu celular.' }
    ]
  };
}

// Enlace "Añadir a Google Wallet". Incluye la clase, así se crea sola en el primer guardado.
export function googleSaveUrl(s, c) {
  const k = load();
  const token = jwt.sign(
    { iss: k.client_email, aud: 'google', typ: 'savetowallet', origins: [cfg.base],
      payload: { loyaltyClasses: [loyaltyClass(s)], loyaltyObjects: [loyaltyObject(s, c)] } },
    k.private_key, { algorithm: 'RS256' }
  );
  return 'https://pay.google.com/gp/v/save/' + token;
}

async function api(method, path, data) {
  auth ??= new GoogleAuth({ credentials: load(), scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'] });
  const client = await auth.getClient();
  return client.request({ url: 'https://walletobjects.googleapis.com/walletobjects/v1/' + path, method, data });
}

// Actualiza el pase ya guardado. Si el cliente aún no lo guardó, Google responde 404 y se ignora.
export async function googleUpdate(s, c, message) {
  if (!googleEnabled()) return;
  try {
    const o = loyaltyObject(s, c);
    await api('PATCH', `loyaltyObject/${o.id}`, { loyaltyPoints: o.loyaltyPoints, heroImage: o.heroImage });
    if (message) await api('POST', `loyaltyObject/${o.id}/addMessage`, { message: { header: s.name, body: message, messageType: 'TEXT_AND_NOTIFY' } });
  } catch (e) {
    if (e?.response?.status !== 404) console.error('google wallet:', e?.response?.data || e.message);
  }
}

// Aviso con notificación en la tarjeta de Google Wallet. Google permite máximo 3 por tarjeta cada 24 h.
// Devuelve false si el cliente aún no guardó la tarjeta (404).
export async function googleNotify(s, c, message) {
  if (!googleEnabled()) return false;
  try {
    await api('POST', `loyaltyObject/${objectId(c)}/addMessage`, { message: { header: s.name, body: message, messageType: 'TEXT_AND_NOTIFY' } });
    return true;
  } catch (e) {
    if (e?.response?.status === 404) return false;
    throw new Error('google wallet: ' + (e?.response?.data?.error?.message || e.message));
  }
}
