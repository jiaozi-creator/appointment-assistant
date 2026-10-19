import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=mkdtempSync(join(tmpdir(),'appointment-saas-'));
const port=30000+Math.floor(Math.random()*20000);
let proc;
const accounts={};
const date=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+10*86400000));
const date2=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+12*86400000));
async function req(path,method='GET',payload=null,who=null,headers={}) {
  const actor=who?accounts[who]:null;
  const res=await fetch(`http://127.0.0.1:${port}/api${path}`,{
    method,headers:{ ...(payload!==null?{'Content-Type':'application/json'}:{}),
      ...(actor?{Cookie:actor.cookie,'X-CSRF-Token':actor.csrf}:{}),...headers },
    body:payload!==null?JSON.stringify(payload):undefined
  });
  let data;
  try {data=await res.json();}catch {data=null;}
  return {status:res.status,data,headers:res.headers};
}
async function login(name,email,password) {
  const r=await req('/auth/login','POST',{email,password});
  assert.equal(r.status,200,JSON.stringify(r.data));
  const cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  accounts[name]={cookie,csrf:cookie.match(/aa_csrf=([^;]+)/)?.[1]};
  assert.ok(accounts[name].csrf);
  return r;
}
async function apply(name,slug,email) {
  return req('/public/merchant-applications','POST',{business_name:name,desired_slug:slug,contact_email:email,message:'为摄影预约业务申请账号',consent:true});
}
async function publicBook(slug,serviceId,day,slot='10:00',key='') {
  return req(`/public/shops/${slug}/bookings`,'POST',{
    service_id:serviceId,preferred_date:day,preferred_time:slot,contact_name:'虚拟客户',contact_phone:'13800138000',consent:true
  },null,key?{'Idempotency-Key':key}:{});
}

before(async()=>{
  proc=spawn(process.execPath,['--experimental-sqlite','server/index.js'],{
    cwd:process.cwd(),env:{...process.env,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',
      DB_PATH:join(dir,'test.sqlite'),INIT_OWNER_EMAIL:'owner@example.test',INIT_OWNER_PASSWORD:'strong-password-for-test',
      INIT_PLATFORM_EMAIL:'platform@example.test',INIT_PLATFORM_PASSWORD:'strong-platform-password-test'}
  });
  let ready=false;
  for(let i=0;i<120;i++){
    try{if((await req('/health')).status===200){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,50));
  }
  assert.ok(ready,'server must become healthy');
});
after(async()=>{proc?.kill(); await new Promise(r=>setTimeout(r,80));rmSync(dir,{recursive:true,force:true})});

test('Migration, public listing and no personal details exposed',async()=>{
  const h=await req('/health');assert.equal(h.data.version,'2.0.0');
  const shop=await req('/public/shops/forest-photo'),services=await req('/public/shops/forest-photo/services');
  assert.equal(shop.status,200);assert.equal(shop.data.merchant.phone,undefined);assert.equal(services.data.items.length,3);
  assert.equal((await req('/admin/bookings')).status,401);
  assert.equal((await req('/platform/overview')).status,401);
});

test('Separate owner and platform logins; CSRF is enforced',async()=>{
  assert.equal((await req('/auth/login','POST',{email:'owner@example.test',password:'bad'})).status,401);
  await login('owner','owner@example.test','strong-password-for-test');
  await login('platform','platform@example.test','strong-platform-password-test');
  assert.equal((await req('/platform/overview','GET',null,'owner')).status,403);
  assert.equal((await req('/admin/bookings','GET',null,'platform')).status,403);
  assert.equal((await req('/admin/merchant','PATCH',{name:'Changed'},'owner',{'X-CSRF-Token':'invalid'})).status,403);
  assert.equal((await req('/auth/me','GET',null,'platform')).data.user.role,'platform');
});

test('Application validation, platform approval and secure owner activation',async()=>{
  assert.equal((await apply('工作室A','forest-photo','new@example.test')).status,409);
  const applied=await apply('海盐影像','sea-photo','sea@example.test');assert.equal(applied.status,201);
  const apps=await req('/platform/applications','GET',null,'platform');assert.equal(apps.data.items.length,1);
  const id=apps.data.items[0].id;
  assert.equal((await req(`/platform/applications/${id}/decision`,'POST',{decision:'approved'},'owner')).status,403);
  const done=await req(`/platform/applications/${id}/decision`,'POST',{decision:'approved'},'platform');
  assert.equal(done.status,200);assert.match(done.data.activation.token,/^[a-f\d]{64}$/);
  assert.equal((await req(`/platform/applications/${id}/decision`,'POST',{decision:'approved'},'platform')).status,409);
  assert.equal((await req('/public/shops/sea-photo')).status,200);
  const token=done.data.activation.token;
  assert.equal((await req('/invitations/'+token)).data.role,'owner');
  const accepted=await req('/invitations/'+token+'/accept','POST',{password:'sea-owner-password-test'});
  assert.equal(accepted.status,201);
  assert.equal((await req('/invitations/'+token+'/accept','POST',{password:'sea-owner-password-test'})).status,410);
  await login('sea','sea@example.test','sea-owner-password-test');
});

test('Tenant isolation, owner vs staff permissions, immediate member revocation',async()=>{
  const s=await req('/admin/services','GET',null,'owner'),ss=await req('/admin/services','GET',null,'sea');
  assert.equal(s.data.items.length,3);assert.equal(ss.data.items.length,0);
  assert.equal((await req('/admin/team','GET',null,'platform')).status,403);
  const inv=await req('/admin/team/invitations','POST',{email:'staff@sea.test'},'sea');
  assert.equal(inv.status,201);
  const staffToken=inv.data.token;
  assert.equal((await req('/invitations/'+staffToken+'/accept','POST',{password:'secure-staff-passphrase'})).status,201);
  await login('staff','staff@sea.test','secure-staff-passphrase');
  assert.equal((await req('/admin/services','POST',{title:'test',price_cents:10000,duration_minutes:60},'staff')).status,403);
  assert.equal((await req('/admin/team','GET',null,'staff')).status,403);
  assert.equal((await req('/admin/bookings','GET',null,'staff')).status,200);
  const member=(await req('/admin/team','GET',null,'sea')).data.members.find(x=>x.role==='staff');
  assert.equal((await req('/admin/team/members/'+member.id+'/active','PATCH',{active:false},'sea')).status,200);
  assert.equal((await req('/admin/bookings','GET',null,'staff')).status,401);
  assert.equal((await req('/admin/team/members/'+member.id+'/active','PATCH',{active:true},'sea')).status,200);
});

test('Pending overlapping requests, confirmation mutex, availability and day-off guard',async()=>{
  const s=(await req('/public/shops/forest-photo/services')).data.items;
  const first=await publicBook('forest-photo',s[0].id,date(),'10:00','order_idempotency_456');
  assert.equal(first.status,201,JSON.stringify(first.data));
  const again=await publicBook('forest-photo',s[0].id,date(),'10:00','order_idempotency_456');
  assert.equal(again.status,200);assert.equal(again.data.code,first.data.code);
  const second=await publicBook('forest-photo',s[1].id,date(),'10:30');
  assert.equal(second.status,201);
  const list=(await req('/admin/bookings','GET',null,'owner')).data.items;
  const a=list.find(x=>x.code===first.data.code),b=list.find(x=>x.code===second.data.code);
  assert.equal((await req(`/admin/bookings/${a.id}/status`,'PATCH',{status:'confirmed'},'owner')).status,200);
  assert.equal((await req(`/admin/bookings/${b.id}/status`,'PATCH',{status:'confirmed'},'owner')).status,409);
  const busy=await req(`/public/shops/forest-photo/availability?date=${date()}`);
  assert.equal(busy.status,200);assert.equal(busy.data.busy.length,1);assert.ok(!JSON.stringify(busy.data).includes('13800138000'));
  assert.equal((await publicBook('forest-photo',s[0].id,date(),'10:00')).status,409);
  assert.equal((await req('/admin/days-off','PUT',{dates:[date()]},'owner')).status,409);
  assert.equal((await req(`/admin/bookings/${a.id}/status`,'PATCH',{status:'completed'},'owner')).status,200);
  assert.equal((await req(`/admin/bookings/${b.id}/status`,'PATCH',{status:'confirmed'},'owner')).status,409);
  const other=await publicBook('forest-photo',s[0].id,date2(),'14:00');assert.equal(other.status,201);
  const seaService=await req('/admin/services','POST',{title:'工作室B写真',price_cents:19900,duration_minutes:45},'sea');
  assert.equal(seaService.status,201);
  const seaBooking=await publicBook('sea-photo',seaService.data.id,date(),'10:00');assert.equal(seaBooking.status,201);
  assert.equal((await req('/admin/bookings','GET',null,'sea')).data.total,1);
  assert.equal((await req('/admin/bookings','GET',null,'owner')).data.total,3);
  assert.equal((await req(`/admin/bookings/${a.id}/status`,'PATCH',{status:'cancelled'},'sea')).status,404);
});

test('Platform suspends shop without leaking private tenant data',async()=>{
  const overview=await req('/platform/overview','GET',null,'platform');
  const sea=overview.data.merchants.find(x=>x.slug==='sea-photo');assert.ok(sea);
  assert.equal((await req('/platform/merchants/'+sea.id+'/active','PATCH',{active:false},'platform')).status,200);
  assert.equal((await req('/public/shops/sea-photo')).status,404);
  assert.equal((await req('/admin/services','GET',null,'sea')).status,401);
  assert.equal((await req('/platform/merchants/'+sea.id+'/active','PATCH',{active:true},'platform')).status,200);
  assert.equal((await req('/public/shops/sea-photo')).status,200);
});

test('Reject malformed input and unsupported content types',async()=>{
  assert.equal((await req('/public/merchant-applications','POST',{business_name:'abc',desired_slug:'??',contact_email:'bad',consent:true})).status,400);
  const r=await fetch(`http://127.0.0.1:${port}/api/public/merchant-applications`,{method:'POST',body:'foo',headers:{'Content-Type':'text/plain'}});
  assert.equal(r.status,415);
});

test('Logout invalidates owner session',async()=>{
  const r=await req('/auth/logout','POST',{},'owner');assert.equal(r.status,200);
  assert.equal((await req('/auth/me','GET',null,'owner')).status,401);
});
