import fs from 'fs';
import http2 from 'http2';
import express from 'express';
import { PKPass } from 'passkit-generator';
import { cfg } from './config.js';
import { q } from './db.js';
import { stampsPng, logoPng } from './images.js';

export const appleEnabled = () => !!(cfg.apple.passType && cfg.apple.team && cfg.apple.wwdr && cfg.apple.cert && cfg.apple.key);
const rd = (p) => fs.readFileSync(p);
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`; };

export async function buildPass(s, c) {
  const n = Math.min(c.stamps, s.goal);
  const pass = new PKPass({}, {
    wwdr: rd(cfg.apple.wwdr), signerCert: rd(cfg.apple.cert), signerKey: rd(cfg.apple.key), signerKeyPassphrase: cfg.apple.pass
  }, {
    formatVersion: 1,
    passTypeIdentifier: cfg.apple.passType,
    teamIdentifier: cfg.apple.team,
    organizationName: s.name,
    description: `Tarjeta de fidelidad de ${s.name}`,
    serialNumber: c.id,
    authenticationToken: c.auth_token,
    webServiceURL: `${cfg.base}/apple`,
    backgroundColor: rgb(s.color),
    foregroundColor: 'rgb(255,255,255)',
    labelColor: 'rgb(255,255,255)'
  });
  pass.type = 'storeCard';
  pass.headerFields.push({ key: 'stamps', label: 'SELLOS', value: `${n} de ${s.goal}`, changeMessage: 'Llevas %@ sellos' });
  pass.secondaryFields.push({ key: 'reward', label: 'PREMIO', value: s.reward });
  pass.backFields.push({ key: 'aviso', label: 'Avisos', value: c.wallet_message || `Aquí verás los avisos de ${s.name}.`, changeMessage: '%@' });
  pass.backFields.push({ key: 'how', label: 'Cómo sumar sellos', value: 'Escanea el sticker del local o acerca tu celular.' });
  pass.setBarcodes({ message: c.id, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' });
  pass.addBuffer('icon.png', await logoPng(s.color, 29));
  pass.addBuffer('icon@2x.png', await logoPng(s.color, 58));
  pass.addBuffer('icon@3x.png', await logoPng(s.color, 87));
  pass.addBuffer('logo.png', await logoPng(s.color, 50));
  pass.addBuffer('logo@2x.png', await logoPng(s.color, 100));
  pass.addBuffer('strip.png', await stampsPng(s.goal, n, s.color, 375, 123));
  pass.addBuffer('strip@2x.png', await stampsPng(s.goal, n, s.color, 750, 246));
  return pass.getAsBuffer();
}

// Aviso a Wallet: push vacío a APNs con el certificado del pase; el iPhone vuelve a pedir el pase.
// Devuelve cuántos dispositivos aceptó Apple (0 si no hay ninguno registrado).
export async function notifyApple(cardId) {
  if (!appleEnabled()) return 0;
  try {
    const { rows } = await q('select d.push_token from apple_regs g join apple_devices d using (device_id) where g.card_id=$1', [cardId]);
    if (!rows.length) return 0;
    const cl = http2.connect('https://api.push.apple.com', { cert: rd(cfg.apple.cert), key: rd(cfg.apple.key), passphrase: cfg.apple.pass });
    cl.on('error', (e) => console.error('apns:', e.message));
    const results = await Promise.all(rows.map(({ push_token }) => new Promise((resolve) => {
      const req = cl.request({ ':method': 'POST', ':path': '/3/device/' + push_token, 'apns-topic': cfg.apple.passType });
      let status = 0;
      req.on('response', (h) => { status = h[':status']; });
      req.resume();
      req.on('end', async () => {
        if (status === 410) await q('delete from apple_devices where push_token=$1', [push_token]).catch(() => {});
        else if (status !== 200) console.error('apns status', status);
        resolve(status === 200 ? 1 : 0);
      });
      req.on('error', () => resolve(0));
      req.end('{}');
    })));
    cl.close();
    return results.reduce((x, y) => x + y, 0);
  } catch (e) { console.error('apns:', e.message); return 0; }
}

// Servicio web de PassKit (Apple lo llama solo, la ruta base es webServiceURL + /v1/...)
export function appleRouter() {
  const r = express.Router();
  const h = (f) => (a, b, n) => f(a, b).catch(n);
  const authCard = async (req, serial) => {
    const tok = (req.get('authorization') || '').replace(/^ApplePass /, '');
    if (!tok || !/^[0-9a-f-]{36}$/.test(serial)) return null;
    return (await q('select * from cards where id=$1 and auth_token=$2', [serial, tok])).rows[0] || null;
  };

  r.post('/v1/devices/:dev/registrations/:pt/:serial', h(async (req, res) => {
    const c = await authCard(req, req.params.serial);
    if (!c) return res.sendStatus(401);
    const pushToken = req.body?.pushToken;
    if (!pushToken) return res.sendStatus(400);
    await q('insert into apple_devices(device_id,push_token) values($1,$2) on conflict (device_id) do update set push_token=$2', [req.params.dev, pushToken]);
    const ins = await q('insert into apple_regs(device_id,card_id) values($1,$2) on conflict do nothing', [req.params.dev, c.id]);
    res.sendStatus(ins.rowCount ? 201 : 200);
  }));

  r.delete('/v1/devices/:dev/registrations/:pt/:serial', h(async (req, res) => {
    const c = await authCard(req, req.params.serial);
    if (!c) return res.sendStatus(401);
    await q('delete from apple_regs where device_id=$1 and card_id=$2', [req.params.dev, c.id]);
    res.sendStatus(200);
  }));

  r.get('/v1/devices/:dev/registrations/:pt', h(async (req, res) => {
    const since = Number(req.query.passesUpdatedSince) || 0;
    const { rows } = await q(
      `select c.id, floor(extract(epoch from c.updated_at)*1000)::bigint as ts
         from apple_regs g join cards c on c.id=g.card_id
        where g.device_id=$1 and floor(extract(epoch from c.updated_at)*1000) > $2`, [req.params.dev, since]);
    if (!rows.length) return res.sendStatus(204);
    res.json({ serialNumbers: rows.map((x) => x.id), lastUpdated: String(Math.max(...rows.map((x) => Number(x.ts)))) });
  }));

  r.get('/v1/passes/:pt/:serial', h(async (req, res) => {
    const c = await authCard(req, req.params.serial);
    if (!c) return res.sendStatus(401);
    const s = (await q('select * from stores where id=$1', [c.store_id])).rows[0];
    const buf = await buildPass(s, c);
    res.set({ 'Content-Type': 'application/vnd.apple.pkpass', 'Last-Modified': new Date(c.updated_at).toUTCString() }).send(buf);
  }));

  r.post('/v1/log', (req, res) => { console.log('apple log:', JSON.stringify(req.body)); res.sendStatus(200); });
  return r;
}
