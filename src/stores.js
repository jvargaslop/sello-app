import crypto from 'crypto';
import { q } from './db.js';

export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const slugify = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// Crea un negocio y devuelve su enlace y su clave de panel (la clave solo existe en este momento).
export async function createStore({ name, slug, reward, goal = 10, color = '#0F6B57' }) {
  const base = slugify(slug || name);
  if (base.length < 2) throw new Error('Nombre no válido');
  for (let i = 0; i < 20; i++) {
    const candidate = i ? `${base.slice(0, 36)}-${i + 1}` : base;
    const key = crypto.randomBytes(18).toString('base64url');
    try {
      await q('insert into stores(slug,name,reward,goal,color,admin_key_hash) values($1,$2,$3,$4,$5,$6)', [candidate, name, reward, goal, color, sha(key)]);
      return { slug: candidate, key };
    } catch (e) { if (e.code !== '23505') throw e; }
  }
  throw new Error('No se pudo generar un enlace único');
}

export async function resetKey(slug) {
  const key = crypto.randomBytes(18).toString('base64url');
  const r = await q('update stores set admin_key_hash=$2 where slug=$1', [slug, sha(key)]);
  return r.rowCount ? key : null;
}
