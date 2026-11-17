import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';
process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL;

test('pedidos privados, precio autorizado, idempotencia, CSRF y persistencia',{skip: !process.env.TEST_DATABASE_URL},async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'orders-test-'));let server;
 const start=async()=>{server=await createApp({password:'Testing-only-password',dataDir,secure:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${server.address().port}`;};
 const close=()=>new Promise(r=>{server.close(r);server.closeAllConnections();});
 try{let base=await start();const req=(p,o)=>fetch(base+p,o);const post=(p,d,h={})=>req(p,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(d)});
 const store=await req('/api/store').then(r=>r.json());const data={type:'robux',amount:1000,expectedPrice:store.robux[0].price,username:'TestUser',email:'test@example.com',payment:store.payments[0],requestId:randomUUID(),price:0.01};
 assert.equal((await post('/api/orders',data,{Origin:'https://evil.example'})).status,403);
 assert.equal((await post('/api/orders',{...data,expectedPrice:0.01})).status,409);
 const result=await post('/api/orders',data);assert.equal(result.status,201);const order=await result.json();assert.match(order.ticket,/^GS-[A-F0-9]{12}$/);assert.equal(order.price,store.robux[0].price);assert.equal(order.status,'pending');
 assert.equal((await post('/api/orders',data).then(r=>r.json())).ticket,order.ticket);
 assert.equal((await req('/api/orders')).status,401);assert.equal((await post('/api/orders/'+order.ticket,{status:'confirmed'})).status,401);
 const login=await post('/api/login',{password:'Testing-only-password'}),cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json();const auth={Cookie:cookie,'X-CSRF-Token':csrf};
 assert.equal((await post('/api/orders/'+order.ticket,{status:'confirmed'},{Cookie:cookie})).status,403);
 assert.equal((await post('/api/orders/'+order.ticket,{status:'confirmed'},auth)).status,200);
 const list=await req('/api/orders',{headers:auth}).then(r=>r.json());assert.equal(list.length,1);assert.equal(list[0].status,'confirmed');assert.equal(list[0].requestId,undefined);
 const page=await req('/');assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal((await req('/.env')).status,404);assert.equal((await req('/data/orders.json')).status,404);
 await close();base=await start();const login2=await post('/api/login',{password:'Testing-only-password'});const cookie2=login2.headers.get('set-cookie').split(';')[0];assert.equal((await req('/api/orders',{headers:{Cookie:cookie2}}).then(r=>r.json()))[0].ticket,order.ticket);
 }finally{if(server?.listening)await close();await rm(dataDir,{recursive:true,force:true});}
});
