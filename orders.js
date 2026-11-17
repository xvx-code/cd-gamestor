import { randomBytes } from 'node:crypto';

export function createOrders(db, mailer) {
  const limits = new Map();
  const rowToOrder = row => ({ ticket: row.ticket, requestId: row.request_id, type: row.type, amount: row.amount, price: Number(row.price), currency: row.currency, username: row.username, email: row.email, payment: row.payment, status: row.status, createdAt: row.created_at, confirmedAt: row.confirmed_at || undefined });

  return async ({ req, url, session, body, send, store }) => {
    if (!url.pathname.startsWith('/api/orders')) return false;
    if (req.method === 'POST' && url.pathname === '/api/orders') {
      if (req.headers['sec-fetch-site'] === 'cross-site') { send(403, {}); return true; }
      const input = await body();
      if (!input || !['robux','diamond'].includes(input.type) || typeof input.username !== 'string' || !input.username.trim() || input.username.length > 80 || typeof input.email !== 'string' || input.email.length > 254 || !/^\S+@\S+\.\S+$/.test(input.email) || !store.payments.includes(input.payment) || typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId)) { send(400,{error:'Revisa los datos del pedido.'}); return true; }
      const product = store[input.type].find(p => p.amount === input.amount);
      if (!product) { send(400,{error:'Este paquete ya no está disponible. Recarga la página.'}); return true; }
      if (input.expectedPrice !== product.price) { send(409,{error:'El precio cambió. Recarga la página antes de crear el pedido.'}); return true; }
      const now = Date.now(); for (const [k,v] of limits) if (v.until < now) limits.delete(k);
      const key = req.socket.remoteAddress; const limit = limits.get(key) || {count:0,until:now+3600000};
      if (limit.count >= 10) { send(429,{error:'Demasiados pedidos. Inténtalo en una hora.'}); return true; }
      limit.count++; limits.set(key,limit);
      const existing = await db.get('SELECT * FROM orders WHERE request_id = ?',[input.requestId]);
      if (existing) { const o=rowToOrder(existing); send(201,{ticket:o.ticket,amount:o.amount,price:o.price,status:o.status,discordUrl:process.env.DISCORD_URL || 'https://discord.gg/D6N6hNf4e5'}); return true; }
      const count = Number((await db.get('SELECT COUNT(*) AS n FROM orders')).n);
      if (count >= 10000) { send(503,{error:'Servicio temporalmente no disponible.'}); return true; }
      const ticket = 'GS-' + randomBytes(6).toString('hex').toUpperCase();
      const createdAt = new Date().toISOString();
      try {
        await db.run(`INSERT INTO orders(ticket,request_id,type,amount,price,currency,username,email,payment,status,created_at) VALUES(?,?,?,?,?,'USD',?,?,?,'pending',?)`,[ticket,input.requestId,input.type,product.amount,product.price,input.username.trim(),input.email.trim(),input.payment,createdAt]);
      } catch (e) {
        if (e.code === '23505') { const duplicate=await db.get('SELECT * FROM orders WHERE request_id=?',[input.requestId]); if (duplicate) { const o=rowToOrder(duplicate); send(201,{ticket:o.ticket,amount:o.amount,price:o.price,status:o.status,discordUrl:process.env.DISCORD_URL || 'https://discord.gg/D6N6hNf4e5'}); return true; } }
        throw e;
      }
      const order={ticket,requestId:input.requestId,type:input.type,amount:product.amount,price:product.price,currency:'USD',username:input.username.trim(),email:input.email.trim(),payment:input.payment,status:'pending',createdAt};
      mailer.sendOrderPending(order).then(async result => { if(result.ok) await db.run('UPDATE orders SET email_pending_sent=1 WHERE ticket=?',[ticket]); }).catch(()=>{});
      send(201,{ticket:order.ticket,amount:order.amount,price:order.price,status:order.status,discordUrl:process.env.DISCORD_URL || 'https://discord.gg/D6N6hNf4e5'}); return true;
    }
    if (!session) { send(401,{error:'Acceso de administrador requerido.'}); return true; }
    if (req.method === 'GET' && url.pathname === '/api/orders') {
      const rows=await db.all('SELECT * FROM orders ORDER BY created_at DESC');
      send(200,rows.map(row=>{const o=rowToOrder(row);delete o.requestId;return o;})); return true;
    }
    if (req.method === 'POST' && /^\/api\/orders\/GS-[A-F0-9]{12}$/.test(url.pathname)) {
      if(req.headers['x-csrf-token']!==session.csrf || req.headers['sec-fetch-site']==='cross-site'){send(403,{error:'Acceso denegado.'});return true;}
      const ticket=url.pathname.split('/').pop(), input=await body();
      if(!input || !['confirmed','cancelled','pending'].includes(input.status)){send(400,{error:'Estado no válido.'});return true;}
      const row=await db.get('SELECT * FROM orders WHERE ticket=?',[ticket]); if(!row){send(404,{error:'Pedido no encontrado.'});return true;}
      const confirmedAt=input.status==='confirmed'?new Date().toISOString():null;
      await db.run('UPDATE orders SET status=?, confirmed_at=COALESCE(?,confirmed_at) WHERE ticket=?',[input.status,confirmedAt,ticket]);
      const updated=rowToOrder(await db.get('SELECT * FROM orders WHERE ticket=?',[ticket]));
      if(input.status==='confirmed' && !row.email_invoice_sent) mailer.sendInvoice(updated).then(async result=>{if(result.ok) await db.run('UPDATE orders SET email_invoice_sent=1 WHERE ticket=?',[ticket]);}).catch(()=>{});
      const {requestId,...publicOrder}=updated;send(200,publicOrder);return true;
    }
    send(404,{error:'Ruta de pedidos no encontrada.'}); return true;
  };
}
