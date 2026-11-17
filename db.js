import pg from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const { Pool } = pg;

function placeholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`)
    .replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO')
    .replace(/INSERT OR REPLACE INTO/gi, 'INSERT INTO');
}

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('Falta DATABASE_URL. Conecta el servicio PostgreSQL de Railway.');
  const pool = new Pool({ connectionString, ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  return {
    pool,
    async query(sql, params = [], client = pool) { return client.query(placeholders(sql), params); },
    async get(sql, params = []) { const r = await this.query(sql, params); return r.rows[0] ?? null; },
    async all(sql, params = []) { const r = await this.query(sql, params); return r.rows; },
    async run(sql, params = []) { return this.query(sql, params); },
    async transaction(fn) {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const result = await fn({ query: (s,p=[]) => this.query(s,p,client), get: async (s,p=[]) => (await this.query(s,p,client)).rows[0] ?? null, all: async (s,p=[]) => (await this.query(s,p,client)).rows, run: (s,p=[]) => this.query(s,p,client) }); await client.query('COMMIT'); return result; }
      catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    },
    close() { return pool.end(); }
  };
}

export async function initDatabase(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products (
      type TEXT NOT NULL CHECK (type IN ('robux','diamond')), amount INTEGER NOT NULL,
      price DOUBLE PRECISION NOT NULL, old_price DOUBLE PRECISION,
      badge TEXT NOT NULL DEFAULT '' CHECK (badge IN ('','hot','best')), PRIMARY KEY (type, amount)
    );
    CREATE TABLE IF NOT EXISTS payments (name TEXT PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS orders (
      ticket TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
      amount INTEGER NOT NULL, price DOUBLE PRECISION NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      username TEXT NOT NULL, email TEXT NOT NULL, payment TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
      created_at TEXT NOT NULL, confirmed_at TEXT,
      email_pending_sent INTEGER NOT NULL DEFAULT 0, email_invoice_sent INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
      subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS support_messages (
      id BIGSERIAL PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('customer','admin')), text TEXT NOT NULL, at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id);
  `);
}

async function migrateJson(db, dataDir) {
  const flag = await db.get("SELECT value FROM meta WHERE key = 'json_migrated'");
  if (flag?.value === '1') return;
  const load = async name => { try { return JSON.parse(await readFile(path.join(dataDir, name), 'utf8')); } catch { return null; } };
  const store = await load('store.json');
  const orders = await load('orders.json');
  const tickets = await load('support.json');
  await db.transaction(async tx => {
    if (store?.robux || store?.diamond) {
      for (const type of ['robux','diamond']) for (const p of store[type] || [])
        await tx.query(`INSERT INTO products(type,amount,price,old_price,badge) VALUES(?,?,?,?,?) ON CONFLICT(type,amount) DO UPDATE SET price=EXCLUDED.price, old_price=EXCLUDED.old_price, badge=EXCLUDED.badge`, [type,p.amount,p.price,p.oldPrice === '' || p.oldPrice == null ? null : Number(p.oldPrice),p.badge || '']);
      for (const [i,name] of (store.payments || []).entries()) await tx.query('INSERT INTO payments(name,position) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET position=EXCLUDED.position',[String(name).trim(),i]);
    }
    for (const o of Array.isArray(orders) ? orders : []) await tx.query(`INSERT INTO orders(ticket,request_id,type,amount,price,currency,username,email,payment,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(ticket) DO NOTHING`, [o.ticket,o.requestId || o.request_id || o.ticket,o.type,o.amount,o.price,o.currency || 'USD',o.username,o.email,o.payment,o.status || 'pending',o.createdAt || o.created_at || new Date().toISOString()]);
    for (const t of Array.isArray(tickets) ? tickets : []) {
      await tx.query(`INSERT INTO support_tickets(id,secret_hash,name,email,subject,status,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,[t.id,t.secretHash,t.name,t.email,t.subject,t.status || 'open',t.createdAt || new Date().toISOString()]);
      for (const m of t.messages || []) await tx.query('INSERT INTO support_messages(ticket_id,role,text,at) VALUES(?,?,?,?)',[t.id,m.role,m.text,m.at]);
    }
    await tx.query("INSERT INTO meta(key,value) VALUES('json_migrated','1') ON CONFLICT(key) DO UPDATE SET value='1'");
  });
}

export async function initializeAppDatabase(db, dataDir) {
  await initDatabase(db);
  if (dataDir) await migrateJson(db, dataDir);
}

export async function loadStore(db, defaults) {
  const products = await db.all('SELECT type, amount, price, old_price, badge FROM products ORDER BY type, amount');
  const payments = (await db.all('SELECT name FROM payments ORDER BY position, name')).map(r => r.name);
  if (!products.length) { await saveStore(db, defaults); return structuredClone(defaults); }
  const store = { robux: [], diamond: [], payments: payments.length ? payments : [...defaults.payments] };
  for (const p of products) store[p.type].push({ amount: p.amount, price: Number(p.price), oldPrice: p.old_price == null ? '' : Number(p.old_price), badge: p.badge || '' });
  if (!store.robux.length) store.robux = structuredClone(defaults.robux);
  if (!store.diamond.length) store.diamond = structuredClone(defaults.diamond);
  return store;
}

export async function saveStore(db, store) {
  await db.transaction(async tx => {
    await tx.query('DELETE FROM products'); await tx.query('DELETE FROM payments');
    for (const type of ['robux','diamond']) for (const p of store[type] || []) {
      const old = p.oldPrice === '' || p.oldPrice == null ? null : Number(p.oldPrice);
      await tx.query('INSERT INTO products(type,amount,price,old_price,badge) VALUES(?,?,?,?,?)',[type,p.amount,Number(p.price),Number.isFinite(old) ? old : null,p.badge || '']);
    }
    for (const [i,name] of (store.payments || []).entries()) await tx.query('INSERT INTO payments(name,position) VALUES(?,?)',[String(name).trim(),i]);
  });
}
