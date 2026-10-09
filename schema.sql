create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  goal int not null default 10 check (goal between 2 and 24),
  reward text not null,
  cooldown_minutes int not null default 240 check (cooldown_minutes >= 0),
  color text not null default '#0F6B57',
  admin_key_hash text unique not null,
  created_at timestamptz not null default now()
);
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  device_token text unique not null,
  phone text,
  created_at timestamptz not null default now()
);
create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  stamps int not null default 0,
  last_stamp_at timestamptz,
  redeem_code text,
  redeem_expires timestamptz,
  auth_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, customer_id)
);
create table if not exists stamp_events (
  id bigserial primary key,
  card_id uuid not null references cards(id) on delete cascade,
  kind text not null check (kind in ('stamp','redeem')),
  created_at timestamptz not null default now()
);
create index if not exists stamp_events_card on stamp_events(card_id, created_at);
create table if not exists apple_devices (
  device_id text primary key,
  push_token text not null
);
create table if not exists apple_regs (
  device_id text not null references apple_devices(device_id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  primary key (device_id, card_id)
);

-- ===== Datos de contacto y mensajes automáticos =====
alter table customers add column if not exists name text;
alter table customers add column if not exists email text;
alter table customers add column if not exists birth_month int check (birth_month between 1 and 12);
alter table customers add column if not exists birth_day int check (birth_day between 1 and 31);
alter table cards add column if not exists consent_at timestamptz;
alter table cards add column if not exists consent_version text;
alter table cards add column if not exists unsubscribed_at timestamptz;
alter table cards add column if not exists profile_dismissed boolean not null default false;
alter table stores add column if not exists inactivity_enabled boolean not null default true;
alter table stores add column if not exists inactivity_days int not null default 30 check (inactivity_days between 7 and 180);
alter table stores add column if not exists birthday_enabled boolean not null default true;
alter table stores add column if not exists inactivity_text text not null default 'Hola {nombre}, hace rato no te vemos por {negocio}. Te faltan {faltan} sellos para tu premio: {premio}. Te esperamos.';
alter table stores add column if not exists birthday_text text not null default 'Feliz cumpleaños, {nombre}. Todo el equipo de {negocio} te desea un día increíble. Pasa esta semana y te sorprendemos.';
alter table stores add column if not exists channel text not null default 'email' check (channel in ('email','whatsapp'));
create table if not exists message_log (
  id bigserial primary key,
  card_id uuid not null references cards(id) on delete cascade,
  kind text not null check (kind in ('inactivity','birthday')),
  channel text not null,
  ok boolean not null,
  error text,
  sent_at timestamptz not null default now()
);
create index if not exists message_log_card on message_log(card_id, kind, sent_at);

-- ===== Avisos por Wallet =====
alter table cards add column if not exists wallet_message text;
alter table cards add column if not exists wallet_message_at timestamptz;
alter table cards add column if not exists google_clicked_at timestamptz;
alter table stores add column if not exists wallet_notify boolean not null default true;
