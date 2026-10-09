import { cfg } from './config.js';
import pg from 'pg';
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});
export const q = (text, params) => pool.query(text, params);
