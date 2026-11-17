import http from 'node:http';
import { promisify } from 'node:util';
const derivePassword = promisify(scrypt);
import { randomBytes, scryptSync, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import defaults from './default-data.js';
import { createOrders } from './orders.js';
import { createSupport } from './support.js';
import { PRICING_VERSION } from './pricing.js';
import { createDatabase, initializeAppDatabase, loadStore, saveStore } from './db.js';
import { createMailer } from './email.js';

const root = path.dirname(fileURLToPath(import.meta.url));
export async function createApp({ password = process.env.ADMIN_PASSWORD, dataDir = process.env.DATA_DIR || path.join(root, 'data'), secure = process.env.NODE_ENV === 'production', dev = false } = {}) {
  if (!password || password.length < 12 || password.length > 256) throw Error('Configura ADMIN_PASSWORD en .env con 12 a 256 caracteres.');
  const salt = randomBytes(32), passwordHash = scryptSync(password, salt, 64);
  const sessions = new Map(), attempts = new Map();
  await mkdir(dataDir, { recursive: true });
  const db = createDatabase();
  await initializeAppDatabase(db, dataDir);
  const mailer = createMailer();
  let store = await loadStore(db, defaults);
  function valid(data) {
    const number = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e9;
    return data && ['robux', 'diamond'].every(k => Array.isArray(data[k]) && data[k].length >= 1 && data[k].length <= 100 && data[k].every(p => p && Number.isInteger(p.amount) && p.amount >= (k === 'robux' ? 1000 : 1) && p.amount <= 1e9 && number(p.price) && (p.oldPrice === '' || number(p.oldPrice)) && ['', 'hot', 'best'].includes(p.badge))) && Array.isArray(data.payments) && data.payments.length >= 1 && data.payments.length <= 30 && data.payments.every(p => typeof p === 'string' && p.trim().length > 0 && p.length <= 100);
  }
  if (!valid(store)) throw Error('Los datos guardados de la tienda no son válidos.');
  // One-time catalog update, retaining payments and later admin edits.
  const pricingMeta = await db.get('SELECT value FROM meta WHERE key = ?', ['pricing_version']);
  if (pricingMeta?.value !== PRICING_VERSION) {
    try {
      await writeFile(path.join(dataDir, 'store-before-' + PRICING_VERSION + '.json'), JSON.stringify(store, null, 2), { mode: 0o600, flag: 'wx' });
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    store = { ...store, robux: structuredClone(defaults.robux), diamond: structuredClone(defaults.diamond) };
    await saveStore(db, store);
    await db.query('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', ['pricing_version', PRICING_VERSION]);
  }
  const support = createSupport(db);
  const orders = createOrders(db, mailer);
  let writes = Promise.resolve();
  const vite = dev ? await (await import('vite')).createServer({ root, server: { middlewareMode: true }, appType: 'spa' }) : null;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of sessions) if (value.expires <= now) sessions.delete(key);
    for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
  }, 60000); timer.unref();
  const cookie = (token, age) => `gamestore_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (!dev) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
          let allowed = false;
          try {
            const origin = new URL(req.headers.origin);
            allowed = process.env.APP_ORIGIN ? origin.origin === new URL(process.env.APP_ORIGIN).origin : origin.host === req.headers.host;
          } catch {}
          if (!allowed) return send(403, { error: 'Origen no permitido.' });
        }
        const token = /(?:^|;\s*)gamestore_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
        let session = sessions.get(token);
        if (session && session.expires <= Date.now()) { sessions.delete(token); session = null; }
        const body = async () => {
          if (!req.headers['content-type']?.startsWith('application/json')) throw { status: 415 };
          let raw = '', size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 65536) throw { status: 413 }; raw += chunk; }
          try { return JSON.parse(raw); } catch { throw { status: 400 }; }
        };
        if (await support({ req, url, session, body, send })) return;
        if (await orders({ req, url, session, body, send, store })) return;
        if (req.method === 'GET' && url.pathname === '/api/store') return send(200, store);
        if (req.method === 'GET' && url.pathname === '/api/session') return send(200, { admin: !!session, csrf: session?.csrf || '' });
        if (req.method === 'POST' && url.pathname === '/api/login') {
          if (req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'Acceso denegado.' });
          const key = req.socket.remoteAddress;
          let attempt = attempts.get(key);
          if (!attempt || attempt.expires <= Date.now()) { attempt = { count: 0, expires: Date.now() + 900000 }; attempts.set(key, attempt); }
          if (attempt.count >= 10) return send(429, { error: 'Demasiados intentos. Espera 15 minutos.' });
          attempt.count++;
          const input = await body();
          if (typeof input.password !== 'string' || input.password.length > 256 || !timingSafeEqual(await derivePassword(input.password, salt, 64), passwordHash)) return send(401, { error: 'Contraseña incorrecta.' });
          sessions.delete(token);
          const id = randomBytes(32).toString('hex');
          session = { csrf: randomBytes(32).toString('hex'), expires: Date.now() + 28800000 };
          sessions.set(id, session);
          res.setHeader('Set-Cookie', cookie(id, 28800));
          return send(200, { admin: true, csrf: session.csrf });
        }
        if (!session) return send(401, { error: 'Inicia sesión como administrador.' });
        if (req.headers['x-csrf-token'] !== session.csrf || req.headers['sec-fetch-site'] === 'cross-site') return send(403, { error: 'Acceso denegado.' });
        if (req.method === 'POST' && url.pathname === '/api/logout') { sessions.delete(token); res.setHeader('Set-Cookie', cookie('', 0)); return send(200, { ok: true }); }
        if (req.method === 'PUT' && url.pathname === '/api/store') {
          const data = await body();
          if (!valid(data)) return send(400, { error: 'Revisa los precios, cantidades y métodos de pago.' });
          const next = { robux: data.robux.map(({amount, price, oldPrice, badge}) => ({amount, price, oldPrice, badge})), diamond: data.diamond.map(({amount, price, oldPrice, badge}) => ({amount, price, oldPrice, badge})), payments: data.payments.map(p => p.trim()) };
          const operation = writes.then(async () => { await saveStore(db, next); store = next; });
          writes = operation.catch(() => {}); await operation;
          return send(200, { ok: true });
        }
        return send(404, { error: 'Ruta no encontrada.' });
      }
      // Páginas legales (funcionan en dev y producción)
      if (['GET', 'HEAD'].includes(req.method)) {
        const legal = { '/privacidad': 'privacidad.html', '/privacidad/': 'privacidad.html', '/seguridad': 'seguridad.html', '/seguridad/': 'seguridad.html' };
        const legalFile = legal[url.pathname];
        if (legalFile) {
          try {
            const content = await readFile(path.join(root, 'public', legalFile));
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(req.method === 'HEAD' ? undefined : content);
            return;
          } catch {}
        }
      }
      if (vite) return vite.middlewares(req, res, () => send(404, { error: 'No encontrado.' }));
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, { error: 'Método no permitido.' });
      let relative = decodeURIComponent(url.pathname);
      if (relative === '/' || relative === '/admin' || relative === '/admin/') relative = '/index.html';
      if (relative === '/privacidad' || relative === '/privacidad/') relative = '/privacidad.html';
      if (relative === '/seguridad' || relative === '/seguridad/') relative = '/seguridad.html';
      const dist = path.join(root, 'dist'), target = path.resolve(dist, '.' + relative);
      if (!target.startsWith(dist + path.sep)) return send(404, {});
      try {
        const content = await readFile(target);
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
        res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
        res.end(req.method === 'HEAD' ? undefined : content);
      } catch { send(404, { error: 'No encontrado. Ejecuta npm run build antes de npm start.' }); }
    } catch (error) { send(error.status || 500, { error: error.status ? 'Solicitud no válida.' : 'No se pudo completar la operación.' }); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 60;
  server.on('close', () => { clearInterval(timer); vite?.close(); db.close().catch(() => {}); });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createApp({ dev: process.argv.includes('--dev') });
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => console.log(`GAMESTORE: http://localhost:${port}\nAdministrador: http://localhost:${port}/admin`));
}
