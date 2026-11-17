import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL;

test('administración autenticada, CSRF, persistencia y cierre de sesión', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'gamestore-'));
  let server;
  const start = async () => { server = await createApp({password:'Test-only-password-981', dataDir, secure:false}); await new Promise(r=>server.listen(0,'127.0.0.1',r)); return `http://127.0.0.1:${server.address().port}`; };
  const close = () => new Promise(r=>{ server.close(r); server.closeAllConnections(); });
  try {
    let base = await start();
    const request = (route, options) => fetch(base+route, options);
    let data = await (await request('/api/store')).json();
    assert.equal((await request('/api/store',{method:'PUT'})).status,401);
    const login = password => request('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
    assert.equal((await login('incorrecta')).status,401);
    const response = await login('Test-only-password-981'); assert.equal(response.status,200);
    const cookie=response.headers.get('set-cookie').split(';')[0], {csrf}=await response.json();
    assert.match(response.headers.get('set-cookie'),/HttpOnly/);
    assert.equal((await request('/api/session',{headers:{Cookie:cookie}}).then(r=>r.json())).admin,true);
    const headers={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf};
    assert.equal((await request('/api/store',{method:'PUT',headers:{...headers,'X-CSRF-Token':'fake'},body:JSON.stringify(data)})).status,403);
    assert.equal((await request('/api/store',{method:'PUT',headers,body:JSON.stringify({...data,robux:[]})})).status,400);
    data.robux[0].price=8;
    assert.equal((await request('/api/store',{method:'PUT',headers,body:JSON.stringify(data)})).status,200);
    assert.equal((await request('/api/store').then(r=>r.json())).robux[0].price,8);
    assert.equal((await request('/api/logout',{method:'POST',headers})).status,200);
    assert.equal((await request('/api/store',{method:'PUT',headers,body:JSON.stringify(data)})).status,401);
    await close(); base=await start();
    assert.equal((await request('/api/store').then(r=>r.json())).robux[0].price,8);
    assert.equal((await request('/api/session',{headers:{Cookie:cookie}}).then(r=>r.json())).admin,false);
    for(let i=0;i<10;i++) assert.equal((await login('incorrecta')).status,401);
    assert.equal((await login('incorrecta')).status,429);
  } finally { if(server.listening) await close(); await rm(dataDir,{recursive:true,force:true}); }
});
test('sin contraseña configurada no inicia',{skip: !process.env.TEST_DATABASE_URL},async()=>{
  await assert.rejects(createApp({password:''}),/ADMIN_PASSWORD/);
});
