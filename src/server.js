import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { cfg } from './config.js';
import { pool, q } from './db.js';
import { stampsPng, logoPng } from './images.js';
import { googleEnabled, googleSaveUrl, googleUpdate } from './google.js';
import { appleEnabled, buildPass, appleRouter, notifyApple } from './apple.js';
import { emailEnabled, whatsappEnabled, sendEmail, fill } from './messaging.js';
import { startScheduler } from './jobs.js';
import { createStore, resetKey } from './stores.js';
import { migrate } from './migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '../public');
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());
app.use(express.static(pub, { index: false }));

const h = (f) => (req, res, next) => f(req, res, next).catch(next);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
const isColor = (s) => /^#[0-9a-fA-F]{6}$/.test(s);
const stampLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
const panelLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });

// ---------- helpers ----------
const getStore = async (slug) =>
  /^[a-z0-9-]{2,40}$/.test(slug) ? (await q('select * from stores where slug=$1', [slug])).rows[0] : null;

const existingCustomer = async (req) =>
  req.cookies.sello_dev ? (await q('select * from customers where device_token=$1', [req.cookies.sello_dev])).rows[0] : null;

async function customer(req, res) {
  let c = await existingCustomer(req);
  if (c) return c;
  const token = crypto.randomBytes(24).toString('hex');
  c = (await q('insert into customers(device_token) values($1) returning *', [token])).rows[0];
  res.cookie('sello_dev', token, { httpOnly: true, sameSite: 'lax', secure: cfg.prod, maxAge: 2 * 365 * 86400e3 });
  return c;
}

const cardView = (s, c) => ({
  id: c.id, stamps: c.stamps, goal: s.goal, reward: s.reward, ready: c.stamps >= s.goal,
  redeemCode: c.redeem_code && new Date(c.redeem_expires) > new Date() ? c.redeem_code : null,
  redeemExpires: c.redeem_code ? c.redeem_expires : null,
  consent: !!c.consent_at && !c.unsubscribed_at, dismissed: !!c.profile_dismissed,
  store: { name: s.name, slug: s.slug, color: s.color }
});

const profileOf = (u) => u ? { name: u.name || '', email: u.email || '', phone: u.phone || '', birthMonth: u.birth_month || '', birthDay: u.birth_day || '' } : null;

function notifyWallets(s, c, message) {
  googleUpdate(s, c, message);
  notifyApple(c.id);
}

// ---------- páginas ----------
app.get('/health', (_, res) => res.json({ ok: true, google: googleEnabled(), apple: appleEnabled(), email: emailEnabled(), whatsapp: whatsappEnabled() }));
app.get('/c/:slug', (_, res) => res.sendFile(path.join(pub, 'c.html')));
app.get('/panel', (_, res) => res.sendFile(path.join(pub, 'panel.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get('/qr/:slug.svg', h(async (req, res) => {
  if (!(await getStore(req.params.slug))) return res.sendStatus(404);
  const svg = await QRCode.toString(`${cfg.base}/c/${req.params.slug}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
}));

// ---------- imágenes para los pases ----------
app.get('/img/stamps/:goal/:count.png', h(async (req, res) => {
  const goal = Math.min(24, Math.max(2, +req.params.goal || 10));
  const count = Math.min(goal, Math.max(0, +req.params.count || 0));
  const color = '#' + (/^[0-9a-fA-F]{6}$/.test(req.query.c) ? req.query.c : '0F6B57');
  const w = Math.min(1200, +req.query.w || 750), hh = Math.min(500, +req.query.h || 246);
  res.set('Cache-Control', 'public, max-age=86400').type('png').send(await stampsPng(goal, count, color, w, hh));
}));
app.get('/img/logo.png', h(async (req, res) => {
  const color = '#' + (/^[0-9a-fA-F]{6}$/.test(req.query.c) ? req.query.c : '0F6B57');
  res.set('Cache-Control', 'public, max-age=86400').type('png').send(await logoPng(color, Math.min(512, +req.query.s || 256)));
}));

// ---------- cliente ----------
app.get('/api/c/:slug/card', h(async (req, res) => {
  const s = await getStore(req.params.slug);
  if (!s) return res.status(404).json({ error: 'Negocio no encontrado' });
  const cu = await existingCustomer(req);
  const c = cu && (await q('select * from cards where store_id=$1 and customer_id=$2', [s.id, cu.id])).rows[0];
  res.json({ card: c ? cardView(s, c) : null, profile: profileOf(cu) });
}));

// Lo llama la página que abre el sticker (QR o NFC). Una visita = como máximo un sello.
app.post('/api/c/:slug/stamp', stampLimit, h(async (req, res) => {
  const s = await getStore(req.params.slug);
  if (!s) return res.status(404).json({ error: 'Negocio no encontrado' });
  const cu = await customer(req, res);
  const db = await pool.connect();
  let c, out;
  try {
    await db.query('begin');
    await db.query('insert into cards(store_id,customer_id,auth_token) values($1,$2,$3) on conflict (store_id,customer_id) do nothing',
      [s.id, cu.id, crypto.randomBytes(16).toString('hex')]);
    c = (await db.query('select * from cards where store_id=$1 and customer_id=$2 for update', [s.id, cu.id])).rows[0];
    const wait = c.last_stamp_at ? new Date(c.last_stamp_at).getTime() + s.cooldown_minutes * 60000 - Date.now() : 0;
    if (c.stamps >= s.goal) out = { status: 'complete' };
    else if (wait > 0) out = { status: 'cooldown', retryInMinutes: Math.ceil(wait / 60000) };
    else {
      c = (await db.query('update cards set stamps=stamps+1,last_stamp_at=now(),updated_at=now() where id=$1 returning *', [c.id])).rows[0];
      await db.query("insert into stamp_events(card_id,kind) values($1,'stamp')", [c.id]);
      out = { status: 'stamped' };
    }
    await db.query('commit');
  } catch (e) { await db.query('rollback'); throw e; } finally { db.release(); }
  if (out.status === 'stamped') notifyWallets(s, c, c.stamps >= s.goal ? `Completaste tu tarjeta. Canjea: ${s.reward}` : null);
  res.json({ ...out, card: cardView(s, c), profile: profileOf(cu) });
}));

// El cliente pide su código de canje (4 dígitos, vale 10 min) y se lo muestra al personal.
app.post('/api/c/:slug/redeem', stampLimit, h(async (req, res) => {
  const s = await getStore(req.params.slug);
  const cu = s && (await existingCustomer(req));
  const c = cu && (await q('select * from cards where store_id=$1 and customer_id=$2', [s.id, cu.id])).rows[0];
  if (!c || c.stamps < s.goal) return res.status(409).json({ error: 'Tu tarjeta aún no está completa' });
  if (c.redeem_code && new Date(c.redeem_expires) > new Date()) return res.json({ card: cardView(s, c) });
  let code;
  for (let i = 0; i < 20; i++) {
    code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    const used = await q('select 1 from cards where store_id=$1 and redeem_code=$2 and redeem_expires>now()', [s.id, code]);
    if (!used.rowCount) break;
  }
  const up = (await q("update cards set redeem_code=$2, redeem_expires=now()+interval '10 minutes' where id=$1 returning *", [c.id, code])).rows[0];
  res.json({ card: cardView(s, up) });
}));

// ---------- datos de contacto (con autorización) ----------
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normPhone = (v) => { const d = String(v || '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? '+57' + d : /^573\d{9}$/.test(d) ? '+' + d : null; };

app.post('/api/c/:slug/profile', stampLimit, h(async (req, res) => {
  const s = await getStore(req.params.slug);
  const cu = s && (await existingCustomer(req));
  const c = cu && (await q('select * from cards where store_id=$1 and customer_id=$2', [s.id, cu.id])).rows[0];
  if (!c) return res.status(404).json({ error: 'Primero escanea el sticker del negocio' });
  const b = req.body || {};
  if (b.dismiss) { await q('update cards set profile_dismissed=true where id=$1', [c.id]); return res.json({ ok: true }); }
  if (b.consent === false) { await q('update cards set unsubscribed_at=now() where id=$1', [c.id]); return res.json({ ok: true }); }
  if (b.erase === true) {
    await q('update customers set name=null,email=null,phone=null,birth_month=null,birth_day=null where id=$1', [cu.id]);
    await q('update cards set unsubscribed_at=now(), consent_at=null where customer_id=$1', [cu.id]);
    return res.json({ ok: true });
  }
  const name = String(b.name || '').trim().slice(0, 60);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
  const phone = normPhone(b.phone);
  const hasB = !!(b.birthMonth || b.birthDay);
  const bm = Math.round(+b.birthMonth), bd = Math.round(+b.birthDay);
  const badB = hasB && !(bm >= 1 && bm <= 12 && bd >= 1 && bd <= new Date(2024, bm, 0).getDate());
  const err = !name ? 'Escribe tu nombre'
    : !email && !b.phone ? 'Escribe tu correo o tu celular'
    : email && !EMAIL.test(email) ? 'Revisa tu correo'
    : b.phone && !phone ? 'Escribe tu celular de 10 dígitos, por ejemplo 3101234567'
    : badB ? 'Revisa tu fecha de cumpleaños'
    : b.consent !== true ? 'Debes aceptar la autorización para guardar tus datos' : null;
  if (err) return res.status(400).json({ error: err });
  await q('update customers set name=$2,email=$3,phone=$4,birth_month=$5,birth_day=$6 where id=$1', [cu.id, name, email || null, phone, hasB ? bm : null, hasB ? bd : null]);
  const up = (await q("update cards set consent_at=now(), consent_version='v1', unsubscribed_at=null where id=$1 returning *", [c.id])).rows[0];
  res.json({ ok: true, card: cardView(s, up) });
}));

// Baja desde el enlace de los correos (GET solo muestra el botón; el POST ejecuta, para que los escáneres de correo no den de baja por error).
const unsubPage = (title, body = '') => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mensajes</title></head><body style="font-family:system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 20px;color:#17171b"><h1 style="font-size:22px">${title}</h1>${body}</body></html>`;
const unsubCard = async (id, token) => (isUuid(id) && token ? (await q('select * from cards where id=$1 and auth_token=$2', [id, token])).rows[0] : null);
app.get('/u/:id/:token', h(async (req, res) => {
  if (!(await unsubCard(req.params.id, req.params.token))) return res.status(404).send(unsubPage('Enlace no válido'));
  res.send(unsubPage('¿Dejar de recibir mensajes?', `<form method="post"><button style="font:500 16px system-ui;padding:12px 18px;border-radius:12px;border:0;background:#0F6B57;color:#fff;cursor:pointer">Dejar de recibir mensajes</button></form>`));
}));
app.post('/u/:id/:token', express.urlencoded({ extended: false }), h(async (req, res) => {
  const c = await unsubCard(req.params.id, req.params.token);
  if (!c) return res.status(404).send(unsubPage('Enlace no válido'));
  await q('update cards set unsubscribed_at=now() where id=$1', [c.id]);
  res.send(unsubPage('Listo. No recibirás más mensajes.'));
}));

// ---------- wallets ----------
async function ownedCard(req) {
  const id = req.params.id.replace(/\.pkpass$/, '');
  const cu = isUuid(id) && (await existingCustomer(req));
  if (!cu) return [];
  const c = (await q('select * from cards where id=$1 and customer_id=$2', [id, cu.id])).rows[0];
  if (!c) return [];
  return [(await q('select * from stores where id=$1', [c.store_id])).rows[0], c];
}
app.get('/wallet/google/:id', h(async (req, res) => {
  if (!googleEnabled()) return res.status(501).send('Google Wallet no está configurado');
  const [s, c] = await ownedCard(req);
  if (!c) return res.sendStatus(404);
  await q('update cards set google_clicked_at=now() where id=$1', [c.id]);
  res.redirect(googleSaveUrl(s, c));
}));
app.get('/wallet/apple/:id', h(async (req, res) => {
  if (!appleEnabled()) return res.status(501).send('Apple Wallet no está configurado');
  const [s, c] = await ownedCard(req);
  if (!c) return res.sendStatus(404);
  res.set({ 'Content-Type': 'application/vnd.apple.pkpass', 'Content-Disposition': 'attachment; filename="tarjeta.pkpass"' }).send(await buildPass(s, c));
}));
app.use('/apple', appleRouter());

// ---------- panel del negocio (cabecera x-admin-key) ----------
const auth = h(async (req, res, next) => {
  const k = req.get('x-admin-key') || '';
  const s = k && (await q('select * from stores where admin_key_hash=$1', [sha(k)])).rows[0];
  if (!s) return res.status(401).json({ error: 'Clave inválida' });
  req.store = s;
  next();
});
const storeView = (s) => ({
  name: s.name, slug: s.slug, goal: s.goal, reward: s.reward, cooldownMinutes: s.cooldown_minutes, color: s.color, url: `${cfg.base}/c/${s.slug}`,
  inactivityEnabled: s.inactivity_enabled, inactivityDays: s.inactivity_days, inactivityText: s.inactivity_text,
  birthdayEnabled: s.birthday_enabled, birthdayText: s.birthday_text, channel: s.channel, walletNotify: s.wallet_notify,
  emailReady: emailEnabled(), whatsappReady: whatsappEnabled()
});

app.get('/api/panel/me', panelLimit, auth, (req, res) => res.json(storeView(req.store)));

app.get('/api/panel/stats', panelLimit, auth, h(async (req, res) => {
  const id = req.store.id;
  const [today, active, redeemed, ret, feed, contacts, msgs, wallets] = await Promise.all([
    q(`select count(*)::int n from stamp_events e join cards c on c.id=e.card_id
        where c.store_id=$1 and e.kind='stamp' and e.created_at >= (date_trunc('day', now() at time zone $2) at time zone $2)`, [id, cfg.tz]),
    q("select count(*)::int n from cards where store_id=$1 and last_stamp_at > now() - interval '30 days'", [id]),
    q("select count(*)::int n from stamp_events e join cards c on c.id=e.card_id where c.store_id=$1 and e.kind='redeem'", [id]),
    q(`select count(*) filter (where n>=2)::int back, count(*)::int total from
        (select c.id, count(*) n from cards c join stamp_events e on e.card_id=c.id and e.kind='stamp' where c.store_id=$1 group by c.id) t`, [id]),
    q(`select e.kind, e.created_at, right(c.id::text,4) as tag from stamp_events e join cards c on c.id=e.card_id
        where c.store_id=$1 order by e.created_at desc limit 8`, [id]),
    q('select count(*)::int n from cards where store_id=$1 and consent_at is not null and unsubscribed_at is null', [id]),
    q("select count(*)::int n from message_log m join cards c on c.id=m.card_id where c.store_id=$1 and m.ok and m.sent_at > now() - interval '30 days'", [id]),
    q('select count(*)::int n from cards c where c.store_id=$1 and (c.google_clicked_at is not null or exists (select 1 from apple_regs g where g.card_id=c.id))', [id])
  ]);
  const { back, total } = ret.rows[0];
  res.json({ stampsToday: today.rows[0].n, activeCustomers: active.rows[0].n, redeemed: redeemed.rows[0].n,
    returnedPct: total ? Math.round((back / total) * 100) : 0, feed: feed.rows,
    contacts: contacts.rows[0].n, messages30: msgs.rows[0].n, wallets: wallets.rows[0].n });
}));

app.patch('/api/panel/settings', panelLimit, auth, h(async (req, res) => {
  const b = req.body || {}, s = req.store;
  const pick = (k, cur) => (b[k] === undefined ? cur : b[k]);
  const g = Math.round(+pick('goal', s.goal)), cd = Math.round(+pick('cooldownMinutes', s.cooldown_minutes));
  const rw = String(pick('reward', s.reward)).trim().slice(0, 80), col = pick('color', s.color);
  const iEn = !!pick('inactivityEnabled', s.inactivity_enabled), bEn = !!pick('birthdayEnabled', s.birthday_enabled);
  const iDays = Math.round(+pick('inactivityDays', s.inactivity_days));
  const iTxt = String(pick('inactivityText', s.inactivity_text)).trim().slice(0, 500);
  const bTxt = String(pick('birthdayText', s.birthday_text)).trim().slice(0, 500);
  const ch = pick('channel', s.channel);
  const wn = !!pick('walletNotify', s.wallet_notify);
  if (!(g >= 2 && g <= 24) || !(cd >= 0 && cd <= 10080) || !rw || !isColor(col) || !(iDays >= 7 && iDays <= 180) || !iTxt || !bTxt || !['email', 'whatsapp'].includes(ch))
    return res.status(400).json({ error: 'Datos inválidos' });
  const up = (await q(`update stores set goal=$2,reward=$3,cooldown_minutes=$4,color=$5,inactivity_enabled=$6,inactivity_days=$7,inactivity_text=$8,
      birthday_enabled=$9,birthday_text=$10,channel=$11,wallet_notify=$12 where id=$1 returning *`, [s.id, g, rw, cd, col, iEn, iDays, iTxt, bEn, bTxt, ch, wn])).rows[0];
  res.json(storeView(up));
}));

const testLimit = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false });
app.post('/api/panel/test-message', testLimit, auth, h(async (req, res) => {
  const to = String(req.body?.email || '').trim();
  if (!EMAIL.test(to)) return res.status(400).json({ error: 'Escribe un correo válido' });
  if (!emailEnabled()) return res.status(501).json({ error: 'El envío de correo aún no está configurado en el servidor' });
  const s = req.store;
  const text = fill(req.body?.kind === 'inactivity' ? s.inactivity_text : s.birthday_text, { nombre: 'Camila', negocio: s.name, premio: s.reward, faltan: 3, sellos: Math.max(0, s.goal - 3), meta: s.goal });
  await sendEmail({ store: s, to, subject: `Prueba: mensaje de ${s.name}`, text, unsub: `${cfg.base}/panel` });
  res.json({ ok: true });
}));

app.post('/api/panel/redeem', panelLimit, auth, h(async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!/^\d{4}$/.test(code)) return res.status(400).json({ error: 'El código tiene 4 dígitos' });
  const db = await pool.connect();
  let c;
  try {
    await db.query('begin');
    c = (await db.query('select * from cards where store_id=$1 and redeem_code=$2 and redeem_expires>now() and stamps>=$3 for update',
      [req.store.id, code, req.store.goal])).rows[0];
    if (!c) { await db.query('rollback'); return res.status(404).json({ error: 'Código no válido o vencido. Pide al cliente que genere uno nuevo.' }); }
    c = (await db.query('update cards set stamps=stamps-$2, redeem_code=null, redeem_expires=null, updated_at=now() where id=$1 returning *', [c.id, req.store.goal])).rows[0];
    await db.query("insert into stamp_events(card_id,kind) values($1,'redeem')", [c.id]);
    await db.query('commit');
  } catch (e) { await db.query('rollback'); throw e; } finally { db.release(); }
  notifyWallets(req.store, c, null);
  res.json({ ok: true, reward: req.store.reward });
}));

// ---------- administración (tú): crear y gestionar negocios, cabecera x-super-key ----------
const adminLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const superAuth = (req, res, next) => {
  if (!cfg.adminKey) return res.status(503).json({ error: 'Falta configurar ADMIN_KEY en el servidor' });
  const hash = (v) => crypto.createHash('sha256').update(String(v)).digest();
  if (!crypto.timingSafeEqual(hash(req.get('x-super-key') || ''), hash(cfg.adminKey))) return res.status(401).json({ error: 'Clave inválida' });
  next();
};
const links = (slug) => ({ sticker: `${cfg.base}/c/${slug}`, qr: `${cfg.base}/qr/${slug}.svg`, panel: `${cfg.base}/panel` });

app.get('/api/admin/stores', adminLimit, superAuth, h(async (req, res) => {
  const { rows } = await q(`select s.slug, s.name, s.reward, s.goal, s.created_at,
      (select count(*)::int from cards c where c.store_id=s.id) as customers,
      (select count(*)::int from stamp_events e join cards c on c.id=e.card_id where c.store_id=s.id and e.kind='stamp') as stamps,
      (select max(e.created_at) from stamp_events e join cards c on c.id=e.card_id where c.store_id=s.id) as last_activity
    from stores s order by s.created_at desc`);
  res.json({ stores: rows.map((r) => ({ ...r, links: links(r.slug) })) });
}));

app.post('/api/admin/stores', adminLimit, superAuth, h(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 60), reward = String(b.reward || '').trim().slice(0, 80);
  const goal = Math.round(+b.goal || 10), color = b.color || '#0F6B57';
  if (name.length < 2 || reward.length < 2 || !(goal >= 2 && goal <= 24) || !isColor(color)) return res.status(400).json({ error: 'Revisa el nombre, el premio y los sellos' });
  const { slug, key } = await createStore({ name, slug: b.slug, reward, goal, color });
  res.status(201).json({ name, slug, key, links: links(slug) });
}));

app.post('/api/admin/stores/:slug/reset-key', adminLimit, superAuth, h(async (req, res) => {
  const key = /^[a-z0-9-]{2,40}$/.test(req.params.slug) ? await resetKey(req.params.slug) : null;
  if (!key) return res.status(404).json({ error: 'Negocio no encontrado' });
  const s = (await q('select name from stores where slug=$1', [req.params.slug])).rows[0];
  res.json({ name: s.name, slug: req.params.slug, key, links: links(req.params.slug) });
}));

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Error interno' }); });
await migrate();
app.listen(cfg.port, () => console.log(`Sello escuchando en ${cfg.base} (puerto ${cfg.port})`));
startScheduler();
