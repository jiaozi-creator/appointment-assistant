import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createDatabase, dropDatabase } from './pg-setup.js';

function start(port, databaseUrl) {
  const logs = { text: '' };
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: databaseUrl,
      INIT_OWNER_EMAIL: 'owner@example.test', INIT_OWNER_PASSWORD: 'strong-password-for-test',
      INIT_PLATFORM_EMAIL: 'platform@example.test', INIT_PLATFORM_PASSWORD: 'strong-platform-password-test'
    }
  });
  proc.stdout.on('data', chunk => { logs.text += chunk; });
  proc.stderr.on('data', chunk => { logs.text += chunk; });
  return { proc, logs };
}

async function waitHealthy(port) {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.status === 200) return;
    } catch { /* booting */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('server ' + port + ' did not start');
}

test('two processes cannot confirm the same photographer slot', async () => {
  const databaseUrl = await createDatabase();
  const portA = 41000 + Math.floor(Math.random() * 2000);
  const portB = portA + 1;
  const first = start(portA, databaseUrl);
  let second;
  try {
    await waitHealthy(portA);
    second = start(portB, databaseUrl);
    await waitHealthy(portB);
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 18 * 86400000));
    const login = await fetch(`http://127.0.0.1:${portA}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.test', password: 'strong-password-for-test' })
    });
    const cookie = login.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
    const csrf = cookie.match(/aa_csrf=([^;]+)/)[1];
    const services = await (await fetch(`http://127.0.0.1:${portA}/api/public/shops/forest-photo/services`)).json();
    async function book(port) {
      const res = await fetch(`http://127.0.0.1:${port}/api/public/shops/forest-photo/bookings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: services.items[0].id, preferred_date: day, preferred_time: '16:00',
          contact_name: '并发客户', contact_phone: '13800138000', contact_email: 'race@example.test', consent: true
        })
      });
      return res.json();
    }
    const left = await book(portA);
    const right = await book(portB);
    const listRes = await fetch(`http://127.0.0.1:${portA}/api/admin/bookings`, { headers: { Cookie: cookie } });
    const list = await listRes.json();
    const rows = [left.code, right.code].map(code => list.items.find(item => item.code === code));
    assert.ok(rows[0] && rows[1], JSON.stringify(list) + first.logs.text);
    const results = await Promise.all(rows.map((row, index) => fetch(`http://127.0.0.1:${index ? portB : portA}/api/admin/bookings/${row.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf },
      body: JSON.stringify({ status: 'confirmed' })
    }).then(async res => ({ status: res.status, body: await res.json() }))));
    const ok = results.filter(item => item.status === 200);
    const conflict = results.filter(item => item.status === 409);
    assert.equal(ok.length, 1, JSON.stringify(results) + first.logs.text + second.logs.text);
    assert.equal(conflict.length, 1, JSON.stringify(results));
    const after = await (await fetch(`http://127.0.0.1:${portB}/api/admin/bookings`, { headers: { Cookie: cookie } })).json();
    assert.equal(after.items.filter(item => item.preferred_date === day && item.preferred_time === '16:00' && item.status === 'confirmed').length, 1);
  } finally {
    first.proc.kill();
    second?.proc.kill();
    await new Promise(resolve => setTimeout(resolve, 400));
    await dropDatabase(databaseUrl);
  }
});
