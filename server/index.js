import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, uid, checkPassword, hashPassword, transaction } from './db.js';

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';
const production = process.env.NODE_ENV === 'production';
const secure = process.env.COOKIE_SECURE === '1';
if (production && (!secure || !process.env.ALLOWED_ORIGIN)) {
  throw new Error('Production requires COOKIE_SECURE=1 and ALLOWED_ORIGIN=https://your-domain');
}
const json = (res, status, data, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', ...headers });
  res.end(JSON.stringify(data));
};
const err = (status, message) => { throw Object.assign(new Error(message), { status }); };
const required = (value, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) err(400, '必填字段格式不正确');
  return value.trim();
};
const optional = (value, max = 500) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) err(400, '字段格式不正确');
  return value.trim();
};
const digest = value => createHash('sha256').update(value).digest('hex');
const emailOf = value => { const email = required(value, 180).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err(400, '邮箱格式不正确'); return email; };
const slugOf = value => { const slug = required(value, 60).toLowerCase(); if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(slug)) err(400,'商家标识只能为3-60位小写字母、数字和连字符'); return slug; };
const dateOK = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
// Dates/times represent a shop-local wall clock. MVP shops use the Asia/Shanghai timezone.
const shopDate = (offsetDays = 0) => {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('sv-SE',{ timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
};
const timeMinutes = text => { if (typeof text !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) err(400,'时间格式不正确'); return Number(text.slice(0,2))*60+Number(text.slice(3)); };
const rate = new Map();
function throttle(key, max, windowMs) {
  const now = Date.now(); const item = rate.get(key);
  if (!item || now - item.start > windowMs) { rate.set(key,{start:now,count:1}); return; }
  if (++item.count > max) err(429, '请求频繁，请稍后重试');
  if (rate.size > 10000) rate.clear();
}
async function getBody(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) err(415,'接口只接收JSON');
  let text='';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 16384) err(413,'请求体过大'); }
  try { const data=JSON.parse(text||'{}'); if (!data || Array.isArray(data) || typeof data!=='object') err(400,'JSON对象格式错误'); return data; }
  catch (e) { if (e.status) throw e; err(400,'JSON格式错误'); }
}
const parseCookies = req => Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
function session(req) {
  const cookies = parseCookies(req); if (!cookies.aa_session) return null;
  const user = db.prepare(`SELECT u.id,u.email,u.role,u.merchant_id,s.csrf_hash
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id_hash=? AND s.expires_at>? AND u.active=1`).get(digest(cookies.aa_session),Date.now());
  if (!user) return null;
  if (user.merchant_id && !db.prepare('SELECT 1 FROM merchants WHERE id=? AND active=1').get(user.merchant_id)) return null;
  return user;
}
function requireSession(req) { const user=session(req); if(!user)err(401,'请先登录'); return user; }
function requirePlatform(user) { if (user.role !== 'platform') err(403,'需要平台管理员权限'); }
function requireOwner(user) { if (user.role !== 'owner') err(403,'需要工作室所有者权限'); }
function merchantOf(user) { if (!user.merchant_id || user.role==='platform') err(403,'需要工作室身份'); return user.merchant_id; }
function csrf(req,user) {
  const given=req.headers['x-csrf-token'], cookie=parseCookies(req).aa_csrf;
  if (!given || typeof given!=='string' || !cookie || given!==cookie || !user.csrf_hash ||
      !timingSafeEqual(Buffer.from(digest(given)),Buffer.from(user.csrf_hash))) err(403,'安全令牌失效，请重新登录');
}
function verifyOrigin(req) {
  const origin=req.headers.origin;
  const allowed=(process.env.ALLOWED_ORIGIN||'').split(',').map(x=>x.trim()).filter(Boolean);
  const development=!production && /^http:\/\/(localhost|127\.0\.0\.1):(5173|3001)$/.test(origin||'');
  if (origin && !allowed.includes(origin) && !development && origin!==`http://${req.headers.host}` && origin!==`https://${req.headers.host}`) err(403,'请求来源不受信任');
  if (production && !origin) err(403,'生产环境要求Origin请求头');
}
function cookiesFor(token,csrfToken) {
  return [
    `aa_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure?'; Secure':''}`,
    `aa_csrf=${csrfToken}; SameSite=Lax; Path=/; Max-Age=604800${secure?'; Secure':''}`
  ];
}
function clearCookies() { return ['aa_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'+(secure?'; Secure':''), 'aa_csrf=; SameSite=Lax; Path=/; Max-Age=0'+(secure?'; Secure':'')]; }
function shop(slug) {
  const m = db.prepare('SELECT id,slug,name,intro,address,accent,active FROM merchants WHERE slug=? AND active=1').get(slug);
  if (!m) err(404,'工作室不存在或已停用'); return m;
}
const serviceFields = 'id,title,description,price_cents,duration_minutes,image_url,active';
function overlap(merchantId, date, start, duration, ignoreId = '') {
  const end=timeMinutes(start)+duration;
  return db.prepare(`SELECT id,code,preferred_time,duration_minutes FROM bookings
      WHERE merchant_id=? AND preferred_date=? AND status IN ('confirmed','completed') AND id<>?`).all(merchantId,date,ignoreId)
    .find(row => timeMinutes(row.preferred_time)<end && timeMinutes(row.preferred_time)+row.duration_minutes>timeMinutes(start));
}
function verifySlot(mid,date,time,duration,ignoreId='') {
  if (db.prepare('SELECT 1 FROM days_off WHERE merchant_id=? AND date=?').get(mid,date)) err(409,'工作室该日暂停预约');
  if (overlap(mid,date,time,duration,ignoreId)) err(409,'此时段已有确认预约，请选择其他时间');
}
const roles=['owner','staff'];
function invite(mid,email,role,actor,ttl=48*3600000) {
  if (!roles.includes(role)) err(400,'邀请角色无效');
  const token=randomBytes(32).toString('hex');
  const id=uid(),expires=Date.now()+ttl;
  db.prepare('INSERT INTO invitations(id,merchant_id,email,role,token_hash,created_by,expires_at) VALUES(?,?,?,?,?,?,?)')
    .run(id,mid,email,role,digest(token),actor,expires);
  return {id,token,expires_at:new Date(expires).toISOString()};
}
function audit(user,action,subject,detail='') {
  db.prepare('INSERT INTO platform_events(id,actor_id,action,subject_id,detail) VALUES(?,?,?,?,?)')
    .run(uid(),user.id,action,subject,detail);
}
async function route(req,res,url) {
  const path=url.pathname,method=req.method,ip=req.socket.remoteAddress||'unknown';
  if (!['GET','HEAD'].includes(method)) verifyOrigin(req);
  if (method==='GET' && path==='/api/health') { db.prepare('SELECT 1').get(); return json(res,200,{ok:true,version:'2.0.0',database:'sqlite'}); }

  if (method==='POST' && path==='/api/auth/login') {
    throttle('login:'+ip,12,15*60000);
    const data=await getBody(req),email=emailOf(data.email),password=required(data.password,200);
    const user=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
    if (!user || !checkPassword(password,user.password_hash)) err(401,'账号或密码不正确');
    if (user.merchant_id && !db.prepare('SELECT 1 FROM merchants WHERE id=? AND active=1').get(user.merchant_id)) err(403,'工作室已暂停使用');
    const token=randomBytes(32).toString('hex'),anti=randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(id_hash,user_id,expires_at,csrf_hash) VALUES(?,?,?,?)')
      .run(digest(token),user.id,Date.now()+7*86400000,digest(anti));
    return json(res,200,{user:{email:user.email,role:user.role}}, {'Set-Cookie':cookiesFor(token,anti)});
  }
  if (method==='GET' && path==='/api/auth/me') {
    const user=requireSession(req);
    const merchant=user.merchant_id ? db.prepare('SELECT id,slug,name,intro,address,phone,accent FROM merchants WHERE id=?').get(user.merchant_id) : null;
    return json(res,200,{user:{email:user.email,role:user.role,id:user.id},merchant});
  }
  if (method==='POST' && path==='/api/auth/logout') {
    const user=requireSession(req);csrf(req,user);
    const token=parseCookies(req).aa_session;
    db.prepare('DELETE FROM sessions WHERE id_hash=?').run(digest(token));
    return json(res,200,{ok:true},{'Set-Cookie':clearCookies()});
  }
  if (method==='POST' && path==='/api/public/merchant-applications') {
    throttle('apply:'+ip,5,3600000);
    const data=await getBody(req),business_name=required(data.business_name,90),desired_slug=slugOf(data.desired_slug),contact_email=emailOf(data.contact_email),message=optional(data.message,700);
    if (data.website) err(400,'请求无效');
    if (data.consent!==true) err(400,'请确认商家申请隐私说明');
    if (db.prepare('SELECT 1 FROM merchants WHERE slug=?').get(desired_slug)) err(409,'工作室标识已被使用');
    if (db.prepare("SELECT 1 FROM merchant_applications WHERE desired_slug=? AND status='pending'").get(desired_slug)) err(409,'该标识已有待处理申请');
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(contact_email)) err(409,'该邮箱已绑定平台账户');
    db.prepare('INSERT INTO merchant_applications(id,business_name,desired_slug,contact_email,message) VALUES(?,?,?,?,?)')
      .run(uid(),business_name,desired_slug,contact_email,message);
    return json(res,201,{ok:true,message:'已提交申请，等待平台人工审核'});
  }
  let m=path.match(/^\/api\/public\/shops\/([a-z0-9-]{3,60})$/);
  if (method==='GET' && m) {
    const {slug,name,intro,address,accent}=shop(m[1]); return json(res,200,{merchant:{slug,name,intro,address,accent}});
  }
  m=path.match(/^\/api\/public\/shops\/([a-z0-9-]{3,60})\/services$/);
  if (method==='GET' && m) {
    const mid=shop(m[1]).id;
    return json(res,200,{items:db.prepare(`SELECT ${serviceFields} FROM services WHERE merchant_id=? AND active=1 ORDER BY created_at DESC`).all(mid).map(({active,...row})=>row)});
  }
  m=path.match(/^\/api\/public\/shops\/([a-z0-9-]{3,60})\/days-off$/);
  if (method==='GET' && m) return json(res,200,{dates:db.prepare('SELECT date FROM days_off WHERE merchant_id=? AND date>=? ORDER BY date').all(shop(m[1]).id,shopDate(1)).map(x=>x.date)});
  m=path.match(/^\/api\/public\/shops\/([a-z0-9-]{3,60})\/availability$/);
  if (method==='GET' && m) {
    const mid=shop(m[1]).id,date=url.searchParams.get('date');
    if (!dateOK(date)) err(400,'请提供有效日期');
    const closed=!!db.prepare('SELECT 1 FROM days_off WHERE merchant_id=? AND date=?').get(mid,date);
    const busy=db.prepare(`SELECT preferred_time, duration_minutes FROM bookings
      WHERE merchant_id=? AND preferred_date=? AND status IN ('confirmed','completed') ORDER BY preferred_time`).all(mid,date);
    return json(res,200,{closed,busy}); // Only public time intervals; no customer PII.
  }
  m=path.match(/^\/api\/public\/shops\/([a-z0-9-]{3,60})\/bookings$/);
  if (method==='POST' && m) {
    throttle('book:'+ip,18,3600000);
    const mid=shop(m[1]).id,data=await getBody(req);
    if (data.website) err(400,'请求无效');
    const service=db.prepare('SELECT id,duration_minutes FROM services WHERE merchant_id=? AND id=? AND active=1').get(mid,required(data.service_id,80));
    if (!service) err(400,'服务不存在或已下架');
    const preferred_date=required(data.preferred_date,10),preferred_time=required(data.preferred_time,5);
    if (!dateOK(preferred_date)||preferred_date<shopDate(1)||preferred_date>shopDate(180)) err(400,'只能预约未来180天内的日期');
    const minutes=timeMinutes(preferred_time);
    if (minutes%30!==0) err(400,'请选择半小时整点时段');
    if (minutes<9*60 || minutes+service.duration_minutes>21*60) err(400,'请选择工作室可接受的时段（09:00–21:00）');
    if (data.consent!==true) err(400,'请确认预约信息处理告知');
    const contact_name=required(data.contact_name,40),contact_phone=required(data.contact_phone,30),note=optional(data.note,500);
    if (!/^[+0-9()\s-]{7,25}$/.test(contact_phone)) err(400,'请填写有效联系方式');
    const key=req.headers['idempotency-key'];
    if (key && (typeof key!=='string'|| !/^[a-zA-Z0-9_-]{10,100}$/.test(key))) err(400,'幂等键格式不正确');
    const outcome=transaction(() => {
      if (key) {
        const found=db.prepare(`SELECT b.code,b.status FROM idempotency i JOIN bookings b ON b.id=i.booking_id
          WHERE i.merchant_id=? AND i.request_key=?`).get(mid,key);
        if (found) return {...found,already:true};
      }
      verifySlot(mid,preferred_date,preferred_time,service.duration_minutes);
      const id=uid(),code='YK'+new Date().toISOString().slice(0,10).replaceAll('-','')+randomBytes(6).toString('hex').toUpperCase();
      db.prepare(`INSERT INTO bookings (id,merchant_id,service_id,code,contact_name,contact_phone,preferred_date,
        preferred_time,note,consent_at,duration_minutes) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,mid,service.id,code,contact_name,contact_phone,preferred_date,preferred_time,note,new Date().toISOString(),service.duration_minutes);
      if (key) db.prepare('INSERT INTO idempotency(merchant_id,request_key,booking_id) VALUES(?,?,?)').run(mid,key,id);
      return {code,status:'pending'};
    });
    return json(res,outcome.already?200:201,{code:outcome.code,status:outcome.status,message:'预约申请已提交，等待商家确认'});
  }

  // Accepting an invitation uses a one-time, hashed bearer token, not an authenticated cookie.
  m=path.match(/^\/api\/invitations\/([a-f0-9]{64})$/);
  if (method==='GET' && m) {
    const item=db.prepare(`SELECT i.email,i.role,i.expires_at,i.accepted_at,i.revoked_at,m.name AS merchant_name
      FROM invitations i JOIN merchants m ON m.id=i.merchant_id WHERE i.token_hash=? AND m.active=1`).get(digest(m[1]));
    if (!item||item.accepted_at||item.revoked_at||item.expires_at<Date.now()) err(404,'邀请无效或已经过期');
    return json(res,200,{email:item.email,role:item.role,merchant_name:item.merchant_name});
  }
  m=path.match(/^\/api\/invitations\/([a-f0-9]{64})\/accept$/);
  if (method==='POST' && m) {
    throttle('accept:'+ip,10,3600000);
    const data=await getBody(req),password=required(data.password,200);
    if (password.length<12) err(400,'密码至少12位');
    transaction(() => {
      const item=db.prepare('SELECT * FROM invitations WHERE token_hash=?').get(digest(m[1]));
      if (!item||item.accepted_at||item.revoked_at||item.expires_at<Date.now()) err(410,'邀请失效');
      if (!db.prepare('SELECT 1 FROM merchants WHERE id=? AND active=1').get(item.merchant_id)) err(403,'商家已停用');
      if (db.prepare('SELECT 1 FROM users WHERE email=?').get(item.email)) err(409,'邮箱已经有账号，请联系管理员');
      db.prepare('INSERT INTO users(id,merchant_id,email,password_hash,role) VALUES(?,?,?,?,?)')
        .run(uid(),item.merchant_id,item.email,hashPassword(password),item.role);
      db.prepare('UPDATE invitations SET accepted_at=CURRENT_TIMESTAMP WHERE id=?').run(item.id);
    });
    return json(res,201,{ok:true,message:'账户已开通，请登录'});
  }

  // Authenticated routes: every write requires both session and CSRF proof.
  if (path.startsWith('/api/platform/') || path.startsWith('/api/admin/')) {
    const user=requireSession(req);
    if (!['GET','HEAD'].includes(method)) csrf(req,user);
    if (path.startsWith('/api/platform/')) return platformRoutes(req,res,url,user);
    return merchantRoutes(req,res,url,user);
  }
  err(404,'接口不存在');
}

async function platformRoutes(req,res,url,user) {
  requirePlatform(user);
  const path=url.pathname,method=req.method;
  if (method==='GET' && path==='/api/platform/overview') {
    const merchants=db.prepare('SELECT id,slug,name,active,created_at FROM merchants ORDER BY created_at DESC').all();
    const applications=db.prepare("SELECT status,COUNT(*) AS count FROM merchant_applications GROUP BY status").all();
    return json(res,200,{merchants,applications});
  }
  if (method==='GET' && path==='/api/platform/applications') {
    const status=url.searchParams.get('status')||'pending';
    if (!['pending','approved','rejected','all'].includes(status)) err(400,'状态无效');
    const items=status==='all'
      ?db.prepare('SELECT * FROM merchant_applications ORDER BY created_at DESC LIMIT 200').all()
      :db.prepare('SELECT * FROM merchant_applications WHERE status=? ORDER BY created_at DESC LIMIT 200').all(status);
    return json(res,200,{items});
  }
  let m=path.match(/^\/api\/platform\/applications\/([\w-]+)\/decision$/);
  if (method==='POST'&&m) {
    const data=await getBody(req),decision=required(data.decision,20);
    if (!['approved','rejected'].includes(decision)) err(400,'无效审核决定');
    const result=transaction(() => {
      const app=db.prepare('SELECT * FROM merchant_applications WHERE id=?').get(m[1]);
      if (!app) err(404,'申请不存在');
      if (app.status!=='pending') err(409,'申请已处理');
      let merchantId=null,activation=null;
      if (decision==='approved') {
        if (db.prepare('SELECT 1 FROM merchants WHERE slug=?').get(app.desired_slug)) err(409,'该标识已被其他工作室使用');
        if (db.prepare('SELECT 1 FROM users WHERE email=?').get(app.contact_email)) err(409,'申请邮箱已经注册');
        merchantId=uid();
        db.prepare('INSERT INTO merchants(id,slug,name,intro) VALUES(?,?,?,?)').run(merchantId,app.desired_slug,app.business_name,'欢迎预约拍摄服务');
        activation=invite(merchantId,app.contact_email,'owner',user.id,72*3600000);
      }
      db.prepare(`UPDATE merchant_applications SET status=?,merchant_id=?,handled_by=?,handled_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(decision,merchantId,user.id,app.id);
      audit(user,'merchant_application_'+decision,app.id,app.desired_slug);
      return {ok:true,decision,activation};
    });
    return json(res,200,result);
  }
  let m2=path.match(/^\/api\/platform\/merchants\/([\w-]+)\/activation$/);
  if (method==='POST'&&m2) {
    const result=transaction(() => {
      const m=db.prepare('SELECT * FROM merchants WHERE id=?').get(m2[1]);
      if (!m) err(404,'工作室不存在');
      if (db.prepare("SELECT 1 FROM users WHERE merchant_id=? AND role='owner'").get(m.id)) err(409,'该工作室已有所有者');
      const app=db.prepare("SELECT * FROM merchant_applications WHERE merchant_id=? AND status='approved'").get(m.id);
      if (!app) err(404,'申请不存在');
      db.prepare("UPDATE invitations SET revoked_at=CURRENT_TIMESTAMP WHERE merchant_id=? AND role='owner' AND accepted_at IS NULL").run(m.id);
      const activation=invite(m.id,app.contact_email,'owner',user.id,72*3600000);
      audit(user,'reissue_activation',m.id);
      return {activation};
    });
    return json(res,200,result);
  }
  m2=path.match(/^\/api\/platform\/merchants\/([\w-]+)\/active$/);
  if (method==='PATCH'&&m2) {
    const data=await getBody(req);
    if (typeof data.active!=='boolean') err(400,'必须指定是否启用');
    const changes=db.prepare('UPDATE merchants SET active=? WHERE id=?').run(data.active?1:0,m2[1]).changes;
    if (!changes) err(404,'工作室不存在');
    audit(user,'merchant_active',m2[1],String(data.active));
    return json(res,200,{ok:true});
  }
  err(404,'平台接口不存在');
}
async function merchantRoutes(req,res,url,user) {
  const mid=merchantOf(user),path=url.pathname,method=req.method;
  if (method==='GET'&&path==='/api/admin/dashboard') {
    const totals=db.prepare('SELECT status,COUNT(*) AS count FROM bookings WHERE merchant_id=? GROUP BY status').all(mid);
    const recent=db.prepare(`SELECT b.id,b.code,b.preferred_date,b.preferred_time,b.status,b.created_at,s.title AS service_title
      FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.merchant_id=? ORDER BY b.created_at DESC LIMIT 8`).all(mid);
    return json(res,200,{totals,recent});
  }
  if (method==='GET'&&path==='/api/admin/bookings') {
    const page=Math.min(1000,Math.max(1,Number(url.searchParams.get('page'))||1));
    const status=url.searchParams.get('status')||'',search=(url.searchParams.get('q')||'').slice(0,80);
    if (!['','pending','confirmed','completed','cancelled','rejected'].includes(status)) err(400,'订单状态无效');
    const where=` WHERE b.merchant_id=? AND (?='' OR b.status=?) AND (?='' OR b.code LIKE ? OR b.contact_name LIKE ? OR b.contact_phone LIKE ?)`;
    const params=[mid,status,status,search,'%'+search+'%','%'+search+'%','%'+search+'%'];
    const total=db.prepare('SELECT COUNT(*) AS n FROM bookings b'+where).get(...params).n;
    const items=db.prepare(`SELECT b.id,b.code,b.contact_name,b.contact_phone,b.preferred_date,b.preferred_time,
      b.duration_minutes,b.note,b.status,b.created_at,b.updated_at,s.title AS service_title
      FROM bookings b JOIN services s ON s.id=b.service_id ${where} ORDER BY b.created_at DESC LIMIT 20 OFFSET ?`)
      .all(...params,(page-1)*20);
    return json(res,200,{items,total,page,pageSize:20});
  }
  let m=path.match(/^\/api\/admin\/bookings\/([\w-]+)\/status$/);
  if (method==='PATCH'&&m) {
    const data=await getBody(req),next=required(data.status,20);
    const allowed={pending:['confirmed','rejected','cancelled'],confirmed:['completed','cancelled'],completed:[],rejected:[],cancelled:[]};
    transaction(() => {
      const old=db.prepare('SELECT * FROM bookings WHERE id=? AND merchant_id=?').get(m[1],mid);
      if (!old) err(404,'订单不存在');
      if (!allowed[old.status]?.includes(next)) err(409,'当前状态不能执行该操作');
      if (next==='confirmed') verifySlot(mid,old.preferred_date,old.preferred_time,old.duration_minutes,old.id);
      db.prepare('UPDATE bookings SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND merchant_id=?')
        .run(next,old.id,mid);
      db.prepare('INSERT INTO events(id,booking_id,actor,action,before_value,after_value) VALUES(?,?,?,?,?,?)')
        .run(uid(),old.id,user.id,'status',old.status,next);
    });
    return json(res,200,{ok:true,status:next});
  }
  if (method==='GET'&&path==='/api/admin/services') return json(res,200,{items:db.prepare(`SELECT ${serviceFields} FROM services WHERE merchant_id=? ORDER BY created_at DESC`).all(mid)});
  m=path.match(/^\/api\/admin\/services(?:\/([\w-]+))?$/);
  if (m && ['POST','PATCH','DELETE'].includes(method)) {
    requireOwner(user);
    const id=m[1];
    if ((method==='POST')===Boolean(id)) err(404,'接口不存在');
    if (id && !db.prepare('SELECT 1 FROM services WHERE id=? AND merchant_id=?').get(id,mid)) err(404,'服务不存在');
    if (method==='DELETE') {
      db.prepare('UPDATE services SET active=0 WHERE id=? AND merchant_id=?').run(id,mid);
      return json(res,200,{ok:true});
    }
    const data=await getBody(req),title=required(data.title,80),description=optional(data.description,1000),price=Number(data.price_cents),duration=Number(data.duration_minutes),active=data.active===false?0:1,image_url=optional(data.image_url,500);
    if (!Number.isInteger(price)||price<0||price>100000000||!Number.isInteger(duration)||duration<15||duration>720) err(400,'价格或时长无效');
    if (image_url&&!/^https:\/\//.test(image_url)) err(400,'只支持HTTPS图片');
    if (method==='POST') {
      const newId=uid();
      db.prepare('INSERT INTO services(id,merchant_id,title,description,price_cents,duration_minutes,image_url,active) VALUES(?,?,?,?,?,?,?,?)')
        .run(newId,mid,title,description,price,duration,image_url,active);
      return json(res,201,{id:newId});
    }
    db.prepare('UPDATE services SET title=?,description=?,price_cents=?,duration_minutes=?,image_url=?,active=? WHERE id=? AND merchant_id=?')
      .run(title,description,price,duration,image_url,active,id,mid);
    return json(res,200,{id});
  }
  if (method==='GET'&&path==='/api/admin/days-off') return json(res,200,{dates:db.prepare('SELECT date FROM days_off WHERE merchant_id=? ORDER BY date').all(mid).map(x=>x.date)});
  if (method==='PUT'&&path==='/api/admin/days-off') {
    requireOwner(user); const data=await getBody(req);
    if (!Array.isArray(data.dates)||data.dates.length>365||data.dates.some(d=>!dateOK(d))) err(400,'日期列表格式无效');
    transaction(() => {
      for (const date of new Set(data.dates)) {
        if (db.prepare(`SELECT 1 FROM bookings WHERE merchant_id=? AND preferred_date=? AND status='confirmed'`).get(mid,date)) err(409,`${date} 存在已确认订单，请先处理订单`);
      }
      db.prepare('DELETE FROM days_off WHERE merchant_id=?').run(mid);
      for (const date of new Set(data.dates)) db.prepare('INSERT INTO days_off(merchant_id,date) VALUES(?,?)').run(mid,date);
    });
    return json(res,200,{ok:true});
  }
  if (method==='PATCH'&&path==='/api/admin/merchant') {
    requireOwner(user);const data=await getBody(req),name=required(data.name,80),intro=optional(data.intro,500),address=optional(data.address,200),phone=optional(data.phone,50);
    db.prepare('UPDATE merchants SET name=?,intro=?,address=?,phone=? WHERE id=?').run(name,intro,address,phone,mid);
    return json(res,200,{ok:true});
  }
  if (method==='GET'&&path==='/api/admin/team') {
    requireOwner(user);
    const members=db.prepare('SELECT id,email,role,active,created_at FROM users WHERE merchant_id=? ORDER BY created_at').all(mid);
    const invitations=db.prepare(`SELECT id,email,role,expires_at,accepted_at,revoked_at,created_at FROM invitations
      WHERE merchant_id=? ORDER BY created_at DESC LIMIT 100`).all(mid);
    return json(res,200,{members,invitations});
  }
  if (method==='POST'&&path==='/api/admin/team/invitations') {
    requireOwner(user); const data=await getBody(req),email=emailOf(data.email);
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) err(409,'此邮箱已有账号');
    if (db.prepare('SELECT 1 FROM invitations WHERE merchant_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?').get(mid,email,Date.now())) err(409,'已经发送了有效邀请');
    const result=invite(mid,email,'staff',user.id);
    return json(res,201,result);
  }
  m=path.match(/^\/api\/admin\/team\/invitations\/([\w-]+)\/revoke$/);
  if (method==='POST'&&m) {
    requireOwner(user);
    const result=db.prepare('UPDATE invitations SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND merchant_id=? AND accepted_at IS NULL AND revoked_at IS NULL').run(m[1],mid);
    if (!result.changes) err(404,'邀请不存在或已失效');
    return json(res,200,{ok:true});
  }
  m=path.match(/^\/api\/admin\/team\/members\/([\w-]+)\/active$/);
  if (method==='PATCH'&&m) {
    requireOwner(user);const data=await getBody(req);
    if (typeof data.active!=='boolean') err(400,'状态必须是布尔值');
    const member=db.prepare('SELECT * FROM users WHERE id=? AND merchant_id=?').get(m[1],mid);
    if (!member) err(404,'成员不存在');
    if (member.role!=='staff') err(403,'不能通过此接口操作工作室所有者');
    transaction(() => {
      db.prepare('UPDATE users SET active=? WHERE id=? AND merchant_id=?').run(data.active?1:0,member.id,mid);
      if (!data.active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(member.id);
    });
    return json(res,200,{ok:true});
  }
  err(404,'商家接口不存在');
}

const mime={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if (url.pathname.startsWith('/api/')) return await route(req,res,url);
    if (req.method!=='GET'&&req.method!=='HEAD') return json(res,405,{error:'方法不允许'});
    const root=resolve('web/dist');
    let decoded;
    try { decoded=decodeURIComponent(url.pathname); } catch { err(400,'无效URL'); }
    const file=resolve(root,'.'+decoded);
    if (file!==root && !file.startsWith(root+'/')) err(403,'无权访问文件');
    const asset=existsSync(file)&&file!==root?file:resolve(root,'index.html');
    if (!existsSync(asset)) err(404,'请先构建前端：npm run build');
    // SPA fallback only for routes, never for missing JS/CSS assets.
    if (!existsSync(file) && extname(decoded)) err(404,'静态资源不存在');
    res.writeHead(200,{'Content-Type':mime[extname(asset)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
    res.end(readFileSync(asset));
  } catch (error) {
    const status=error.status||500;
    if (status===500) console.error('server error:',error);
    if (!res.headersSent) json(res,status,{error:status===500?'服务器内部错误':error.message}); else res.end();
  }
});
server.listen(PORT,HOST,()=>console.log(`Appointment Assistant on http://${HOST}:${PORT}`));
export {server};
