// Uso: npm run jobs            (envía lo que corresponda hoy)
//      npm run jobs -- --dry   (solo muestra lo que enviaría)
import { runJobs } from '../src/jobs.js';
import { pool } from '../src/db.js';
await runJobs({ dry: process.argv.includes('--dry') || undefined });
await pool.end();
