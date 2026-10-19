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
  const h=await req('/health');assert.equal(h.data.version,'2.1.0');
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


test('Resources, package snapshots, concurrent teams, allocation capacity, tenant isolation',async()=>{
  const existing=(await req('/admin/resources','GET',null,'owner')).data.items;
  assert.equal(existing.filter(r=>r.kind==='photographer').length,1);
  const second=await req('/admin/resources','POST',{kind:'photographer',name:'摄影师乙',capacity:1},'owner');
  assert.equal(second.status,201,JSON.stringify(second.data));
  const photo2=second.data.id;
  const room1=(await req('/admin/resources','POST',{kind:'room',name:'A号影棚',capacity:1},'owner')).data.id;
  const room2=(await req('/admin/resources','POST',{kind:'room',name:'B号影棚',capacity:1},'owner')).data.id;
  const gear=(await req('/admin/resources','POST',{kind:'equipment',name:'柔光灯组',capacity:2},'owner')).data.id;
  const id=(await req('/admin/services','GET',null,'owner')).data.items[0].id;
  const newPkg=await req('/admin/packages','POST',{service_id:id,title:'影棚写真双机位',description:'团队套餐',price_cents:89900,
    duration_minutes:60,buffer_before:30,buffer_after:30,active:true,
    requirements:[{kind:'photographer',quantity:1},{kind:'room',quantity:1},{kind:'equipment',quantity:1}]},'owner');
  assert.equal(newPkg.status,201,JSON.stringify(newPkg.data));const pid=newPkg.data.id;
  const day=date2();
  const book=async(t)=>req('/public/shops/forest-photo/bookings','POST',{service_id:id,package_id:pid,
    preferred_date:day,preferred_time:t,contact_name:'模拟用户',contact_phone:'13800138000',consent:true});
  const b1=await book('10:00'),b2=await book('10:00');assert.equal(b1.status,201);assert.equal(b2.status,201);
  const all=(await req('/admin/bookings','GET',null,'owner')).data.items;
  const x=all.find(b=>b.code===b1.data.code),y=all.find(b=>b.code===b2.data.code);
  assert.ok(x&&y);
  assert.equal((await req('/admin/bookings/'+x.id+'/status','PATCH',{status:'confirmed',allocations:[
    {resource_id:existing.find(r=>r.kind==='photographer').id,quantity:1},{resource_id:room1,quantity:1},{resource_id:gear,quantity:1}
  ]},'owner')).status,200);
  const other=(await req('/admin/bookings/'+y.id+'/status','PATCH',{status:'confirmed',allocations:[
    {resource_id:photo2,quantity:1},{resource_id:room2,quantity:1},{resource_id:gear,quantity:1}
  ]},'owner'));assert.equal(other.status,200,JSON.stringify(other.data));
  const avail=await req('/public/shops/forest-photo/availability?date='+day+'&service_id='+id+'&package_id='+pid);
  assert.equal(avail.status,200);assert.equal(avail.data.available_slots.includes('10:00'),false);
  assert.equal(JSON.stringify(avail.data).includes('柔光灯'),false);
  assert.equal((await book('10:00')).status,409);
  const pEdit=await req('/admin/packages/'+pid,'PATCH',{title:'影棚写真双机位·升级版',description:'',price_cents:99000,duration_minutes:120,
    buffer_before:0,buffer_after:0,requirements:[{kind:'photographer',quantity:2},{kind:'room',quantity:1}]},'owner');
  assert.equal(pEdit.status,200,JSON.stringify(pEdit.data));
  const saved=(await req('/admin/bookings','GET',null,'owner')).data.items.find(b=>b.id===x.id);
  assert.equal(saved.duration_minutes,60); // Existing booking retains snapshot even when package edited.
  assert.equal(saved.package_price_cents,89900);assert.equal(saved.package_title,'影棚写真双机位');
  assert.equal(saved.allocations.length,3);
  assert.equal((await req('/admin/resources','GET',null,'sea')).data.items.every(r=>r.id!==photo2),true);
  assert.equal((await req('/admin/resources','POST',{kind:'equipment',name:'拒绝操作',capacity:1},'staff')).status,401);
  assert.equal((await req('/admin/packages','POST',{service_id:id,title:'无权',price_cents:1000,duration_minutes:60,
    requirements:[{kind:'photographer',quantity:1}]},'sea')).status,404);
  const calendar=(await req('/admin/resource-calendar?date='+day,'GET',null,'owner')).data;
  assert.equal(calendar.items.filter(r=>r.kind==='equipment').length,2);
  assert.equal((await req('/admin/resource-calendar?date='+day,'GET',null,'sea')).data.items.length,0);
  assert.equal((await req('/admin/resource-blocks','POST',{resource_id:room1,date:day,start_time:'10:00',end_time:'11:00',reason:'维护'},'owner')).status,409);
  assert.equal((await req('/admin/bookings/'+x.id+'/status','PATCH',{status:'cancelled'},'owner')).status,200);
  const blocked=await req('/admin/resource-blocks','POST',{resource_id:room1,date:day,start_time:'09:30',end_time:'11:30',reason:'场地维护'},'owner');
  assert.equal(blocked.status,201,JSON.stringify(blocked.data));
  assert.equal((await req('/admin/resources/'+room2,'PATCH',{name:'B号影棚',capacity:1,active:false},'owner')).status,409);
  const blocks=(await req('/admin/resource-blocks?date='+day,'GET',null,'owner')).data.items;
  assert.equal(blocks.length,1);
  assert.equal((await req('/admin/resource-blocks/'+blocks[0].id,'DELETE',null,'owner')).status,200);
});

test('Weekly working hours restrict only the specified resource and preserve active bookings',async()=>{
  const me=(await req('/admin/resources','GET',null,'owner')).data.items;
  const p=me.find(x=>x.kind==='photographer'&&x.name==='摄影师乙');
  const weekday=new Date(date2()+'T00:00:00Z').getUTCDay();
  const result=await req('/admin/resources/'+p.id+'/weekly-hours','PUT',{
    hours:[{weekday,start_time:'12:00',end_time:'18:00'}]
  },'owner');
  assert.equal(result.status,409); // Existing 10am booking must not be invalidated.
  const response=await req('/admin/resources/'+p.id+'/weekly-hours','GET',null,'owner');
  assert.equal(response.status,200);assert.equal(response.data.items.length,0);
});


test('Release resources after cancellation, block only assigned resources, and enforce allocation ownership',async()=>{
  const ownerResources=(await req('/admin/resources','GET',null,'owner')).data.items;
  const ownerServices=(await req('/admin/services','GET',null,'owner')).data.items;
  const photographer=ownerResources.find(r=>r.kind==='photographer'&&r.name==='默认摄影师');
  const room=ownerResources.find(r=>r.kind==='room'&&r.name==='A号影棚');
  const equipment=ownerResources.find(r=>r.kind==='equipment');
  const pkg=(await req('/admin/packages','POST',{service_id:ownerServices[0].id,title:'资源释放验证',price_cents:10000,duration_minutes:60,
    buffer_before:30,buffer_after:30,requirements:[{kind:'photographer',quantity:1},{kind:'room',quantity:1},{kind:'equipment',quantity:1}]},'owner'));
  assert.equal(pkg.status,201,JSON.stringify(pkg.data));
  const body={service_id:ownerServices[0].id,package_id:pkg.data.id,preferred_date:date2(),preferred_time:'10:00',
    contact_name:'测试代号',contact_phone:'13800138000',consent:true};
  const made=await req('/public/shops/forest-photo/bookings','POST',body);
  assert.equal(made.status,201,JSON.stringify(made.data));
  const booking=(await req('/admin/bookings','GET',null,'owner')).data.items.find(b=>b.code===made.data.code);
  const needs=await req('/admin/bookings/'+booking.id+'/resource-needs','GET',null,'owner');
  assert.equal(needs.status,200);assert.equal(needs.data.requirements.length,3);
  const otherResource=(await req('/admin/resources','GET',null,'sea')).data.items[0];
  assert.equal((await req('/admin/bookings/'+booking.id+'/status','PATCH',{status:'confirmed',allocations:[
    {resource_id:otherResource.id,quantity:1},{resource_id:room.id,quantity:1},{resource_id:equipment.id,quantity:1}
  ]},'owner')).status,400);
  assert.equal((await req('/admin/bookings/'+booking.id+'/status','PATCH',{status:'confirmed',allocations:[
    {resource_id:photographer.id,quantity:1},{resource_id:room.id,quantity:1},{resource_id:equipment.id,quantity:1}
  ]},'owner')).status,200);
  assert.equal((await req('/admin/resource-blocks','POST',{resource_id:photographer.id,date:date2(),start_time:'09:30',end_time:'11:30'},'owner')).status,409);
  assert.equal((await req('/admin/bookings/'+booking.id+'/status','PATCH',{status:'cancelled'},'owner')).status,200);
  const b=await req('/admin/resource-blocks','POST',{resource_id:photographer.id,date:date2(),start_time:'09:30',end_time:'11:30'},'owner');
  assert.equal(b.status,201);
  const after=await req('/public/shops/forest-photo/availability?date='+date2()+'&service_id='+ownerServices[0].id+'&package_id='+pkg.data.id);
  assert.equal(after.status,200);assert.equal(after.data.available_slots.includes('10:00'),false);
  const blocks=(await req('/admin/resource-blocks?date='+date2(),'GET',null,'owner')).data.items;
  for(const block of blocks){if(block.resource_id===photographer.id){await req('/admin/resource-blocks/'+block.id,'DELETE',null,'owner')}}
  const open=await req('/public/shops/forest-photo/availability?date='+date2()+'&service_id='+ownerServices[0].id+'&package_id='+pkg.data.id);
  assert.equal(open.data.available_slots.includes('10:00'),true);
});

test('Logout invalidates owner session',async()=>{
  const r=await req('/auth/logout','POST',{},'owner');assert.equal(r.status,200);
  assert.equal((await req('/auth/me','GET',null,'owner')).status,401);
});
