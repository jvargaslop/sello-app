import fs from 'fs';
import { pool } from './db.js';

// Idempotente: se puede ejecutar en cada arranque. Así no hace falta una consola para crear las tablas.
export async function migrate() {
  const sql = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  try {
    await pool.query(sql);
    console.log('Base de datos lista');
  } catch (e) {
    console.error('No se pudo preparar la base de datos. Revisa DATABASE_URL y DATABASE_SSL.\n', e.message);
    process.exit(1);
  }
}
