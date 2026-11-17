import { randomBytes, createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
const clean = (value,max) => typeof value==='string' && value.trim().length>0 && value.trim().length<=max ? value.trim() : null;

export function createSupport(db) {
  const limits=new Map();
  const loadTicket=async id=>{
    const t=await db.get('SELECT * FROM support_tickets WHERE id=?',[id]); if(!t)return null;
    const messages=await db.all('SELECT role,text,at FROM support_messages WHERE ticket_id=? ORDER BY id',[id]);
    return {id:t.id,secretHash:t.secret_hash,name:t.name,email:t.email,subject:t.subject,status:t.status,createdAt:t.created_at,messages};
  };
  const publicTicket=t=>({id:t.id,name:t.name,email:t.email,subject:t.subject,status:t.status,createdAt:t.createdAt,messages:t.messages});
  return async ({req,url,session,body,send})=>{
    if(!url.pathname.startsWith('/api/support'))return false;
    const admin=!!session;
    if(req.method==='GET' && (url.pathname==='/api/support' || url.pathname==='/api/support/admin')){
      if(!admin){send(401,{error:'Acceso de administrador requerido.'});return true;}
      const rows=await db.all('SELECT id,name,email,subject,status,created_at FROM support_tickets ORDER BY created_at DESC');
      const list=await Promise.all(rows.map(async r=>({id:r.id,name:r.name,email:r.email,subject:r.subject,status:r.status,createdAt:r.created_at,messages:await db.all('SELECT role,text,at FROM support_messages WHERE ticket_id=? ORDER BY id',[r.id])})));
      send(200,list);return true;
    }
    if(req.method==='POST' && url.pathname==='/api/support'){
      if(req.headers['sec-fetch-site']==='cross-site'){send(403,{});return true;}
      const now=Date.now();for(const [key,value] of limits)if(value.until<now)limits.delete(key);
      const key=req.socket.remoteAddress,limit=limits.get(key)||{count:0,until:now+3600000};
      if(limit.count>=5){send(429,{error:'Has alcanzado el límite de consultas. Inténtalo en una hora.'});return true;}
      limit.count++;limits.set(key,limit);
      const input=await body(),name=clean(input.name,80),email=clean(input.email,254),subject=clean(input.subject,120),message=clean(input.message,3000);
      if(!name||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!subject||!message){send(400,{error:'Revisa todos los campos y tu correo.'});return true;}
      const count=Number((await db.get('SELECT COUNT(*) AS n FROM support_tickets')).n);
      if(count>=2000){send(503,{error:'Servicio temporalmente no disponible.'});return true;}
      const token=randomBytes(32).toString('hex'),id=randomBytes(12).toString('hex'),createdAt=new Date().toISOString();
      await db.transaction(async tx=>{
        await tx.query("INSERT INTO support_tickets(id,secret_hash,name,email,subject,status,created_at) VALUES(?,?,?,?,?,'open',?)",[id,hash(token),name,email,subject,createdAt]);
        await tx.query("INSERT INTO support_messages(ticket_id,role,text,at) VALUES(?,'customer',?,?)",[id,message,createdAt]);
      });
      send(201,{ticket:publicTicket(await loadTicket(id)),token});return true;
    }
    const match=/^\/api\/support\/(?:admin\/)?([a-f0-9]{24})$/.exec(url.pathname);
    if(match){
      const ticket=await loadTicket(match[1]),token=req.headers.authorization?.replace(/^Bearer /,'')||'';
      if(!ticket||(!admin&&(token.length!==64||hash(token)!==ticket.secretHash))){send(404,{error:'Consulta no encontrada o código incorrecto.'});return true;}
      if(req.method==='GET'){send(200,publicTicket(ticket));return true;}
      if(req.method==='POST'){
        if(admin&&req.headers['x-csrf-token']!==session.csrf){send(403,{error:'Acceso denegado.'});return true;}
        const input=await body(),message=clean(input.message,3000);
        if(!message&&!(admin&&['open','closed'].includes(input.status))){send(400,{error:'Escribe un mensaje válido.'});return true;}
        try{
          await db.transaction(async tx=>{
            const current=await tx.get('SELECT status FROM support_tickets WHERE id=?',[ticket.id]);
            if(!admin&&current.status==='closed')throw {status:409};
            if(message){const n=Number((await tx.get('SELECT COUNT(*) AS n FROM support_messages WHERE ticket_id=?',[ticket.id])).n);if(n>=100)throw {status:409};await tx.query('INSERT INTO support_messages(ticket_id,role,text,at) VALUES(?,?,?,?)',[ticket.id,admin?'admin':'customer',message,new Date().toISOString()]);}
            if(admin&&['open','closed'].includes(input.status))await tx.query('UPDATE support_tickets SET status=? WHERE id=?',[input.status,ticket.id]);
          });
        }catch(e){if(e.status){send(e.status,{error:'No se pudo actualizar la consulta.'});return true;}throw e;}
        send(200,publicTicket(await loadTicket(ticket.id)));return true;
      }
    }
    send(404,{error:'Ruta de soporte no encontrada.'});return true;
  };
}
