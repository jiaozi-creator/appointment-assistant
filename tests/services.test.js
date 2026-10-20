import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createDatabase, dropDatabase } from './pg-setup.js';
import { localToUtcMs } from '../server/time.js';

const port = 51000 + Math.floor(Math.random() * 7000);
let proc, databaseUrl, logs = '';
const accounts = {};
const phone = '13800138000';
const email = 'guest@example.test';
let submittedCode = '';
let submittedId = '';

const day = offset => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86400000));

async function req(path, method = 'GET', payload = null, who = null) {
  const actor = who ? accounts[who] : null;
  const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: {
      ...(payload !== null ? { 'Content-Type': 'application/json' } : {}),
      ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrf } : {})
    },
    body: payload !== null ? JSON.stringify(payload) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

async function login(name, user, password) {
  const raw = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user, password })
  });
  const data = await raw.json();
  assert.equal(raw.status, 200, JSON.stringify(data) + logs);
  const set = raw.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
  accounts[name] = { cookie: set, csrf: set.match(/aa_csrf=([^;]+)/)?.[1] };
  assert.ok(accounts[name].csrf);
}

before(async () => {
  databaseUrl = await createDatabase();
  proc = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: databaseUrl,
      INIT_OWNER_EMAIL: 'owner@example.test', INIT_OWNER_PASSWORD: 'strong-password-for-test',
      INIT_PLATFORM_EMAIL: 'platform@example.test', INIT_PLATFORM_PASSWORD: 'strong-platform-password-test'
    }
  });
  proc.stdout.on('data', chunk => { logs += chunk; });
  proc.stderr.on('data', chunk => { logs += chunk; });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await req('/health')).status === 200) { ready = true; break; } } catch { /* booting */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, 'server must become healthy\n' + logs);
  await login('owner', 'owner@example.test', 'strong-password-for-test');
  const me = await req('/auth/me', 'GET', null, 'owner');
  assert.equal((await req('/admin/merchant', 'PATCH', { ...me.data.merchant, phone: '13900001111' }, 'owner')).status, 200);
});

after(async () => {
  proc?.kill();
  await new Promise(resolve => setTimeout(resolve, 300));
  if (databaseUrl) await dropDatabase(databaseUrl);
});

test('submit records email and sms without returning the phone', async () => {
  const services = (await req('/public/shops/forest-photo/services')).data.items;
  const made = await req('/public/shops/forest-photo/bookings', 'POST', {
    service_id: services[0].id, preferred_date: day(15), preferred_time: '11:00',
    contact_name: '通知客户', contact_phone: phone, contact_email: email, note: '不要出现在查询里', consent: true
  });
  assert.equal(made.status, 201, JSON.stringify(made.data) + logs);
  submittedCode = made.data.code;
  const notes = await req('/admin/notifications?event=submitted', 'GET', null, 'owner');
  assert.equal(notes.status, 200, JSON.stringify(notes.data));
  const sent = notes.data.items.filter(item => item.status === 'sent' && item.provider === 'test' && item.body.includes(submittedCode));
  assert.ok(sent.some(item => item.channel === 'email' && item.recipient === email));
  assert.ok(sent.some(item => item.channel === 'email' && item.recipient === 'owner@example.test'));
  assert.ok(sent.some(item => item.channel === 'sms' && item.recipient === phone));
  assert.ok(sent.some(item => item.channel === 'sms' && item.recipient === '13900001111'));
  const lookup = await req('/public/shops/forest-photo/bookings/' + submittedCode);
  const body = JSON.stringify(lookup.data);
  assert.equal(body.includes(phone), false);
  assert.equal(body.includes(email), false);
  assert.equal(body.includes('通知客户'), false);
  assert.equal(lookup.data.booking.time_zone, 'Asia/Shanghai');
  assert.match(lookup.data.booking.time_zone_label, /中国标准时间/);
  const listed = (await req('/admin/bookings?q=' + submittedCode, 'GET', null, 'owner')).data.items.find(item => item.code === submittedCode);
  submittedId = listed.id;
});

test('test payment moves unpaid to paid for the merchant', async () => {
  const paid = await req('/public/shops/forest-photo/bookings/' + submittedCode + '/pay', 'POST', { contact_phone: phone });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal(paid.data.payment_status, 'paid');
  assert.equal(paid.data.provider, 'test');
  assert.equal(JSON.stringify(paid.data).includes(phone), false);
  const listed = (await req('/admin/bookings?q=' + submittedCode, 'GET', null, 'owner')).data.items.find(item => item.code === submittedCode);
  assert.equal(listed.payment_status, 'paid');
  const lookup = await req('/public/shops/forest-photo/bookings/' + submittedCode);
  assert.equal(lookup.data.booking.payment_status, 'paid');
  assert.equal(JSON.stringify(lookup.data).includes(phone), false);
});

test('customer cancel refunds, releases the slot and notifies', async () => {
  assert.equal((await req('/admin/bookings/' + submittedId + '/status', 'PATCH', { status: 'confirmed' }, 'owner')).status, 200);
  const wrong = await req('/public/shops/forest-photo/bookings/' + submittedCode + '/cancel', 'POST', { contact_phone: '13911112222' });
  assert.equal(wrong.status, 403);
  const cancelled = await req('/public/shops/forest-photo/bookings/' + submittedCode + '/cancel', 'POST', { contact_phone: phone });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data) + logs);
  assert.equal(cancelled.data.status, 'cancelled');
  assert.equal(cancelled.data.payment_status, 'refunded');
  const lookup = await req('/public/shops/forest-photo/bookings/' + submittedCode);
  assert.equal(lookup.data.booking.status, 'cancelled');
  assert.equal(lookup.data.booking.payment_status, 'refunded');
  assert.equal(JSON.stringify(lookup.data).includes(phone), false);
  const notes = await req('/admin/notifications?event=cancelled', 'GET', null, 'owner');
  const sent = notes.data.items.filter(item => item.body.includes(submittedCode) && item.status === 'sent');
  assert.ok(sent.some(item => item.channel === 'email' && item.recipient === email));
  assert.ok(sent.some(item => item.channel === 'sms' && item.recipient === phone && item.body.includes('退')));
  const services = (await req('/public/shops/forest-photo/services')).data.items;
  const again = await req('/public/shops/forest-photo/bookings', 'POST', {
    service_id: services[0].id, preferred_date: day(15), preferred_time: '11:00',
    contact_name: '后续客户', contact_phone: phone, contact_email: email, consent: true
  });
  assert.equal(again.status, 201, JSON.stringify(again.data));
  const replacement = (await req('/admin/bookings?q=' + again.data.code, 'GET', null, 'owner')).data.items.find(item => item.code === again.data.code);
  assert.equal((await req('/admin/bookings/' + replacement.id + '/status', 'PATCH', { status: 'confirmed' }, 'owner')).status, 200);
  assert.equal((await req('/public/shops/forest-photo/bookings/' + submittedCode + '/cancel', 'POST', { contact_phone: phone })).status, 409);
});

test('slot time is stored as UTC and labeled in the studio zone', async () => {
  const me = await req('/auth/me', 'GET', null, 'owner');
  assert.equal((await req('/admin/merchant', 'PATCH', { ...me.data.merchant, time_zone: 'America/Los_Angeles' }, 'owner')).status, 200);
  const services = (await req('/public/shops/forest-photo/services')).data.items;
  const when = day(21);
  const made = await req('/public/shops/forest-photo/bookings', 'POST', {
    service_id: services[0].id, preferred_date: when, preferred_time: '10:00',
    contact_name: '时区客户', contact_phone: phone, contact_email: email, consent: true
  });
  assert.equal(made.status, 201, JSON.stringify(made.data) + logs);
  const listed = (await req('/admin/bookings?q=' + made.data.code, 'GET', null, 'owner')).data.items.find(item => item.code === made.data.code);
  assert.equal(Number(listed.starts_at), localToUtcMs(when, '10:00', 'America/Los_Angeles'));
  assert.equal(listed.time_zone, 'America/Los_Angeles');
  const lookup = await req('/public/shops/forest-photo/bookings/' + made.data.code);
  assert.equal(lookup.data.booking.time_zone, 'America/Los_Angeles');
  assert.equal(lookup.data.booking.time_zone_label, '美国太平洋时间');
  assert.equal(lookup.data.booking.preferred_time, '10:00');
  assert.equal((await req('/admin/merchant', 'PATCH', { ...me.data.merchant, time_zone: 'Asia/Shanghai' }, 'owner')).status, 200);
});

test('automatic assignment prefers remaining capacity and load, not name', async () => {
  const early = day(24);
  const aaa = await req('/admin/resources', 'POST', { kind: 'photographer', name: 'AAA', capacity: 1 }, 'owner');
  const zzz = await req('/admin/resources', 'POST', { kind: 'photographer', name: 'ZZZ', capacity: 1 }, 'owner');
  assert.equal(aaa.status, 201, JSON.stringify(aaa.data));
  const services = (await req('/public/shops/forest-photo/services')).data.items;
  const first = await req('/public/shops/forest-photo/bookings', 'POST', {
    service_id: services[0].id, preferred_date: early, preferred_time: '09:00',
    contact_name: '早场', contact_phone: phone, contact_email: email, consent: true
  });
  const firstRow = (await req('/admin/bookings?q=' + first.data.code, 'GET', null, 'owner')).data.items.find(item => item.code === first.data.code);
  assert.equal((await req('/admin/bookings/' + firstRow.id + '/status', 'PATCH', {
    status: 'confirmed', allocations: [{ resource_id: aaa.data.id, quantity: 1 }]
  }, 'owner')).status, 200, logs);
  const second = await req('/public/shops/forest-photo/bookings', 'POST', {
    service_id: services[0].id, preferred_date: early, preferred_time: '15:00',
    contact_name: '晚场', contact_phone: phone, contact_email: email, consent: true
  });
  const secondRow = (await req('/admin/bookings?q=' + second.data.code, 'GET', null, 'owner')).data.items.find(item => item.code === second.data.code);
  const needs = await req('/admin/bookings/' + secondRow.id + '/resource-needs', 'GET', null, 'owner');
  const free = id => needs.data.resources.find(item => item.id === id).free;
  assert.equal(free(aaa.data.id), 1);
  assert.equal(free(zzz.data.id), 1);
  assert.equal((await req('/admin/bookings/' + secondRow.id + '/status', 'PATCH', { status: 'confirmed' }, 'owner')).status, 200, logs);
  const saved = (await req('/admin/bookings?q=' + second.data.code, 'GET', null, 'owner')).data.items.find(item => item.code === second.data.code);
  assert.equal(saved.allocations.some(item => item.name === 'AAA'), false);
  assert.equal(saved.allocations.some(item => item.kind === 'photographer'), true);
});
