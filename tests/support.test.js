import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';
process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL;

test('tickets privados, respuestas de admin, cierre y persistencia',{skip: !process.env.TEST_DATABASE_URL},async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'support-test-'));let server;
 const start=async()=>{server=await createApp({password:'Testing-only-password',dataDir,secure:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${server.address().port}`;};
 const close=()=>new Promise(r=>{server.close(r);server.closeAllConnections();});
 try {let base=await start();const req=(url,options)=>fetch(base+url,options);const post=(url,data,headers={})=>req(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 assert.equal((await req('/api/support/admin')).status,401);
 const created=await post('/api/support',{name:'Cliente',email:'test@example.com',subject:'Pedido',message:'Necesito ayuda'});assert.equal(created.status,201);const {ticket,token}=await created.json();assert.equal(ticket.secretHash,undefined);
 const route='/api/support/'+ticket.id;assert.equal((await req(route)).status,404);assert.equal((await req(route,{headers:{Authorization:'Bearer '+'a'.repeat(64)}})).status,404);
 const auth={Authorization:'Bearer '+token};assert.equal((await req(route,{headers:auth})).status,200);
 const login=await post('/api/login',{password:'Testing-only-password'});const cookie=login.headers.get('set-cookie').split(';')[0];const {csrf}=await login.json();const admin={Cookie:cookie,'X-CSRF-Token':csrf};
 assert.equal((await post('/api/support/admin/'+ticket.id,{message:'Hola'}, {Cookie:cookie})).status,403);
 let response=await post('/api/support/admin/'+ticket.id,{message:'Te ayudamos'},admin);assert.equal(response.status,200);assert.equal((await response.json()).messages[1].role,'admin');
 assert.equal((await post(route,{message:'Gracias'},auth)).status,200);
 await post('/api/support/admin/'+ticket.id,{status:'closed'},admin);assert.equal((await post(route,{message:'Otra respuesta'},auth)).status,409);
 await close();base=await start();const restored=await req(route,{headers:auth}).then(r=>r.json());assert.equal(restored.status,'closed');assert.equal(restored.messages.length,3);
 }finally{if(server?.listening)await close();await rm(dataDir,{recursive:true,force:true});}
});
