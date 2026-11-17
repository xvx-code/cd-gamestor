/**
 * Importa una base SQLite existente de GAMESTORE a PostgreSQL.
 * Uso: DATABASE_URL="postgresql://..." node migrate-sqlite-to-postgres.js [ruta/gamestore.db]
 * No elimina ni modifica el archivo SQLite original.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createDatabase, initDatabase } from './db.js';

const sourcePath = path.resolve(process.argv[2] || 'data/gamestore.db');
if (!existsSync(sourcePath)) {
  console.error(`No se encontró SQLite: ${sourcePath}`);
  console.error('Copia primero tu archivo gamestore.db a esa ruta. El original no se modifica.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) throw new Error('Configura DATABASE_URL con la conexión de PostgreSQL destino.');

const sqlite = new DatabaseSync(sourcePath, { readOnly: true });
const pg = createDatabase();
const tableExists = name => !!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
const rows = name => tableExists(name) ? sqlite.prepare(`SELECT * FROM ${name}`).all() : [];

try {
  await initDatabase(pg);
  const meta=rows('meta'), products=rows('products'), payments=rows('payments'), orders=rows('orders'), tickets=rows('support_tickets'), messages=rows('support_messages');
  await pg.transaction(async tx => {
    for (const r of meta) await tx.query('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[r.key,r.value]);
    for (const r of products) await tx.query('INSERT INTO products(type,amount,price,old_price,badge) VALUES(?,?,?,?,?) ON CONFLICT(type,amount) DO UPDATE SET price=EXCLUDED.price,old_price=EXCLUDED.old_price,badge=EXCLUDED.badge',[r.type,r.amount,r.price,r.old_price,r.badge]);
    for (const r of payments) await tx.query('INSERT INTO payments(name,position) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET position=EXCLUDED.position',[r.name,r.position]);
    for (const r of orders) await tx.query(`INSERT INTO orders(ticket,request_id,type,amount,price,currency,username,email,payment,status,created_at,confirmed_at,email_pending_sent,email_invoice_sent) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(ticket) DO NOTHING`,[r.ticket,r.request_id,r.type,r.amount,r.price,r.currency,r.username,r.email,r.payment,r.status,r.created_at,r.confirmed_at,r.email_pending_sent,r.email_invoice_sent]);
    for (const r of tickets) await tx.query('INSERT INTO support_tickets(id,secret_hash,name,email,subject,status,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',[r.id,r.secret_hash,r.name,r.email,r.subject,r.status,r.created_at]);
    for (const r of messages) await tx.query('INSERT INTO support_messages(id,ticket_id,role,text,at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING',[r.id,r.ticket_id,r.role,r.text,r.at]);
  });
  await pg.query("SELECT setval(pg_get_serial_sequence('support_messages','id'), GREATEST(COALESCE((SELECT MAX(id) FROM support_messages),1),1), EXISTS(SELECT 1 FROM support_messages))");
  const counts={products:(await pg.get('SELECT COUNT(*) AS n FROM products')).n,payments:(await pg.get('SELECT COUNT(*) AS n FROM payments')).n,orders:(await pg.get('SELECT COUNT(*) AS n FROM orders')).n,tickets:(await pg.get('SELECT COUNT(*) AS n FROM support_tickets')).n,messages:(await pg.get('SELECT COUNT(*) AS n FROM support_messages')).n};
  console.log('Importación completada. Revisa estos conteos en PostgreSQL:',counts);
  console.log('El archivo SQLite original se conservó sin cambios.');
} finally {
  sqlite.close();
  await pg.close();
}
