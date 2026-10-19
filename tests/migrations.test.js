import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('Upgrades legacy unversioned SQLite schema without destroying existing records',()=>{
  const dir=mkdtempSync(join(tmpdir(),'legacy-appointment-'));
  try {
    const file=join(dir,'legacy.sqlite');
    const db=new DatabaseSync(file);db.exec(readFileSync('server/migrations/001_initial.sql','utf8'));
    db.prepare('INSERT INTO merchants(id,slug,name) VALUES (?,?,?)').run('legacy-merchant','legacy-studio','旧版工作室');
    db.prepare('INSERT INTO services(id,merchant_id,title,price_cents,duration_minutes) VALUES (?,?,?,?,?)').run('service-old','legacy-merchant','旧服务',50000,120);
    db.prepare(`INSERT INTO bookings(id,merchant_id,service_id,code,contact_name,contact_phone,preferred_date,preferred_time,consent_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run('booking-old','legacy-merchant','service-old','YK-LEGACY','旧模拟客户','13800138000','2027-01-01','10:00','2026-10-01');
    db.close();
    const child=spawnSync(process.execPath,['--experimental-sqlite','--input-type=module','-e',"import('./server/db.js')"],
      {env:{...process.env,DB_PATH:file,INIT_OWNER_EMAIL:'',INIT_OWNER_PASSWORD:'',INIT_PLATFORM_EMAIL:'',INIT_PLATFORM_PASSWORD:''},encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);
    const upgraded=new DatabaseSync(file);
    assert.deepEqual(upgraded.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r=>r.version),['001_initial.sql','002_saas.sql','003_resources_packages.sql']);
    assert.equal(upgraded.prepare('SELECT duration_minutes FROM bookings WHERE id=?').get('booking-old').duration_minutes,120);
    assert.equal(upgraded.prepare('SELECT package_id FROM bookings WHERE id=?').get('booking-old').package_id,'service-old:standard');
    assert.equal(upgraded.prepare('SELECT quantity FROM booking_requirements WHERE booking_id=?').get('booking-old').quantity,1);
    assert.equal(upgraded.prepare('SELECT package_price_cents FROM bookings WHERE id=?').get('booking-old').package_price_cents,50000);
    assert.equal(upgraded.prepare('SELECT slug FROM merchants WHERE id=?').get('legacy-merchant').slug,'legacy-studio');
    upgraded.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
