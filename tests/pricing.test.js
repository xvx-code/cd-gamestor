import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {catalog,referencePrices,discounted} from '../pricing.js';
import {createApp} from '../server.js';
process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL;

test('precios publicados y descuento del 20 % redondeado',()=>{
  assert.deepEqual(catalog.robux.map(p=>p.price),[7.99,11.99,15.99,27.99,39.99,79.99,159.99]);
  assert.deepEqual(catalog.diamond.map(p=>p.price),[0.79,2.39,3.99,7.99,15.99,39.99]);
  for(const type of ['robux','diamond']) referencePrices[type].forEach(([amount,price],i)=>{
    assert.equal(catalog[type][i].amount,amount);
    assert.equal(catalog[type][i].oldPrice,price);
    assert.equal(catalog[type][i].price,discounted(price));
  });
});
test('actualiza catálogo antiguo una vez y conserva pagos y ediciones posteriores',{skip: !process.env.TEST_DATABASE_URL},async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),'gamestore-pricing-'));
  let server;
  try {
    const file=path.join(dataDir,'store.json');
    const old={robux:[{amount:1000,price:7,oldPrice:9,badge:''}],diamond:[{amount:100,price:1.99,oldPrice:2.49,badge:''}],payments:['Pago personalizado']};
    await writeFile(file,JSON.stringify(old));
    const open=async()=>{
      server=await createApp({password:'Testing-password-only',dataDir,secure:false});
      await new Promise(r=>server.listen(0,'127.0.0.1',r));
      return `http://127.0.0.1:${server.address().port}`;
    };
    const close=()=>new Promise(r=>{server.close(r);server.closeAllConnections();});
    let base=await open();
    let store=await fetch(base+'/api/store').then(r=>r.json());
    assert.deepEqual(store.payments,old.payments);
    assert.deepEqual(store.robux,catalog.robux);
    await close();
    // Edición del admin vía API (persistida en PostgreSQL)
    base=await open();
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'Testing-password-only'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const {csrf}=await login.json();
    store=await fetch(base+'/api/store').then(r=>r.json());
    store.robux[0].price=6.5;
    const put=await fetch(base+'/api/store',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify(store)});
    assert.equal(put.status,200);
    await close();
    base=await open();
    store=await fetch(base+'/api/store').then(r=>r.json());
    assert.equal(store.robux[0].price,6.5);
    await close();
  }finally{await rm(dataDir,{recursive:true,force:true});}
});
