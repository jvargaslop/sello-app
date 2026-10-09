import { cfg } from './config.js';
import { pool, q } from './db.js';
import { walletNotice } from './notify.js';
import { fill, unsubUrl, sendEmail, sendWhatsApp, emailEnabled, whatsappEnabled } from './messaging.js';

const first = (n) => (n || '').trim().split(/\s+/)[0] || 'cliente';
const SUBJECT = { inactivity: (s) => `Te extrañamos en ${s}`, birthday: (s) => `Feliz cumpleaños de parte de ${s}` };

function channelOrder(r, kind) {
  const tpl = kind === 'birthday' ? cfg.msg.waTplBirthday : cfg.msg.waTplInactivity;
  const wl = r.wallet_notify && (r.has_apple || r.has_google);
  const wa = r.consent && r.phone && whatsappEnabled() && tpl;
  const em = r.consent && r.email && emailEnabled();
  const rest = r.channel === 'whatsapp' ? [wa && 'whatsapp', em && 'email'] : [em && 'email'];
  return [wl && 'wallet', ...rest].filter(Boolean);
}

async function deliver(kind, r, dry) {
  const nombre = first(r.name);
  const faltan = Math.max(0, r.goal - r.stamps);
  const vars = { nombre, negocio: r.store_name, premio: r.reward, faltan, sellos: r.stamps, meta: r.goal };
  const complete = kind === 'inactivity' && r.stamps >= r.goal;
  const text = complete
    ? `Hola ${nombre}, tu premio en ${r.store_name} sigue esperándote: ${r.reward}. Pasa a reclamarlo.`
    : fill(kind === 'birthday' ? r.birthday_text : r.inactivity_text, vars);
  const detail = kind === 'birthday' ? fill(r.birthday_text, vars) : complete ? `Tu premio: ${r.reward}` : `Te faltan ${faltan} sellos para: ${r.reward}`;
  const order = channelOrder(r, kind);
  if (!order.length) return 'sin-canal';
  for (const ch of order) {
    try {
      if (dry) { console.log(`[dry] ${kind} -> ${ch} ${r.store_name}: ${text}`); return 'dry'; }
      if (ch === 'wallet') {
        if (!(await walletNotice(r.card_id, text))) continue;
      } else if (ch === 'email') {
        await sendEmail({ store: { name: r.store_name, color: r.color }, to: r.email, subject: SUBJECT[kind](r.store_name), text, unsub: unsubUrl(r.card_id, r.auth_token) });
      } else {
        const template = kind === 'birthday' ? cfg.msg.waTplBirthday : cfg.msg.waTplInactivity;
        await sendWhatsApp({ to: r.phone, template, params: [nombre, r.store_name, detail] });
      }
      await q('insert into message_log(card_id,kind,channel,ok) values($1,$2,$3,true)', [r.card_id, kind, ch]);
      return ch;
    } catch (e) {
      console.error(`mensaje ${kind} ${ch}:`, e.message);
      await q('insert into message_log(card_id,kind,channel,ok,error) values($1,$2,$3,false,$4)', [r.card_id, kind, ch, e.message.slice(0, 300)]);
    }
  }
  return 'fallo';
}

const BASE = `select c.id card_id, c.auth_token, c.stamps, c.consent_at is not null as consent, u.name, u.email, u.phone,
    exists (select 1 from apple_regs g where g.card_id=c.id) as has_apple, c.google_clicked_at is not null as has_google,
    s.name store_name, s.color, s.goal, s.reward, s.channel, s.wallet_notify, s.inactivity_text, s.birthday_text
  from cards c join customers u on u.id=c.customer_id join stores s on s.id=c.store_id
  where c.unsubscribed_at is null
    and (c.consent_at is not null or (s.wallet_notify and (c.google_clicked_at is not null or exists (select 1 from apple_regs g where g.card_id=c.id))))`;

export async function runJobs({ dry = cfg.jobs.dry } = {}) {
  const lock = await pool.connect();
  try {
    const { rows: [l] } = await lock.query('select pg_try_advisory_lock(778801) as ok');
    if (!l.ok) return { skipped: 'otra instancia está enviando' };
    const { rows: [t] } = await lock.query('select extract(month from now() at time zone $1)::int m, extract(day from now() at time zone $1)::int d', [cfg.tz]);
    const inactive = (await q(`${BASE} and s.inactivity_enabled and c.last_stamp_at < now() - make_interval(days => s.inactivity_days)
      and (select count(*) from message_log m where m.card_id=c.id and m.kind='inactivity' and m.ok and m.sent_at > c.last_stamp_at) < 3
      and not exists (select 1 from message_log m where m.card_id=c.id and m.kind='inactivity' and m.ok and m.sent_at > now() - make_interval(days => s.inactivity_days))`)).rows;
    const birthdays = (await q(`${BASE} and s.birthday_enabled and u.birth_month=$1 and u.birth_day=$2
      and not exists (select 1 from message_log m where m.card_id=c.id and m.kind='birthday' and m.ok and m.sent_at > now() - interval '300 days')`, [t.m, t.d])).rows;
    const res = { inactivity: {}, birthday: {} };
    for (const [kind, rows] of [['inactivity', inactive], ['birthday', birthdays]]) {
      for (const r of rows) {
        const out = await deliver(kind, r, dry);
        res[kind][out] = (res[kind][out] || 0) + 1;
        await new Promise((ok) => setTimeout(ok, 250));
      }
    }
    await lock.query('select pg_advisory_unlock(778801)');
    console.log('mensajes automáticos:', JSON.stringify(res));
    return res;
  } finally { lock.release(); }
}

function bogota() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: cfg.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
}

// Revisa cada 10 minutos; envía una vez al día pasada la hora configurada. El registro evita duplicados si el servidor se reinicia.
export function startScheduler() {
  if (!cfg.jobs.enabled) return;
  let last = '';
  setInterval(async () => {
    const n = bogota();
    if (n.hour < cfg.jobs.hour || last === n.day) return;
    last = n.day;
    try { await runJobs(); } catch (e) { console.error('jobs:', e.message); }
  }, 10 * 60 * 1000);
}
