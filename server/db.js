import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { exec, query, ready } from './pg-bridge.js';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://appointment:appointment@127.0.0.1:5432/appointment';
}

export const databaseUrl = process.env.DATABASE_URL;
export const uid = () => randomUUID();

export const db = {
  exec,
  prepare(sql) {
    return {
      get: (...params) => query(sql, params, 'get'),
      all: (...params) => query(sql, params, 'all'),
      run: (...params) => query(sql, params, 'run')
    };
  }
};

export function transaction(fn) {
  // The callback must stay synchronous. The shared client is held until commit.
  db.exec('BEGIN');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* connection already idle */ }
    throw error;
  }
}

export function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const directory = resolve('server/migrations-pg');
  const files = readdirSync(directory).filter(file => /^\d+_[\w-]+\.sql$/.test(file)).sort();
  for (const file of files) {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(file)) continue;
    const sql = readFileSync(join(directory, file), 'utf8');
    transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(file);
    });
    console.log('[migration]', file);
  }
}

export function hashPassword(password) {
  const salt = randomUUID();
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function checkPassword(password, encoded) {
  try {
    const [salt, hex] = encoded.split(':');
    return timingSafeEqual(Buffer.from(hex, 'hex'), scryptSync(password, salt, 64));
  } catch { return false; }
}

function seedMerchant() {
  const email = process.env.INIT_OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.INIT_OWNER_PASSWORD;
  if (!email && !password) return;
  if (!email || !password || password.length < 12) throw Error('INIT_OWNER_EMAIL 和 INIT_OWNER_PASSWORD 必须正确填写（密码至少12字符）');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return;
  if (db.prepare('SELECT COUNT(*) AS n FROM merchants').get().n) return;
  transaction(() => {
    const mid = uid();
    db.prepare('INSERT INTO merchants(id,slug,name,intro,address,time_zone) VALUES(?,?,?,?,?,?)').run(mid,'forest-photo','森屿摄影','把日常记录成值得珍藏的瞬间','线上预约 · 具体地点以商家确认为准','Asia/Shanghai');
    db.prepare('INSERT INTO users(id,merchant_id,email,password_hash,role) VALUES(?,?,?,?,?)').run(uid(),mid,email,hashPassword(password),'owner');
    db.prepare('INSERT INTO resources(id,merchant_id,kind,name,capacity) VALUES(?,?,?,?,?)').run(uid(),mid,'photographer','默认摄影师',1);
    for (const [name, description, price, minutes] of [
      ['自然光个人写真','户外自然光拍摄 · 精修照片',39900,90],
      ['双人纪念写真','情侣、闺蜜及双人纪念 · 精修照片',59900,120],
      ['毕业纪念照','毕业纪念 · 个性化拍摄安排',49900,120]
    ]) {
      const serviceId = uid(), packageId = uid();
      db.prepare('INSERT INTO services(id,merchant_id,title,description,price_cents,duration_minutes) VALUES(?,?,?,?,?,?)').run(serviceId,mid,name,description,price,minutes);
      db.prepare('INSERT INTO service_packages(id,merchant_id,service_id,title,description,price_cents,duration_minutes,is_default) VALUES(?,?,?,?,?,?,?,1)').run(packageId,mid,serviceId,'标准套餐',description,price,minutes);
      db.prepare('INSERT INTO package_requirements(package_id,kind,quantity) VALUES(?,?,1)').run(packageId,'photographer');
    }
  });
  console.log('[bootstrap] demo merchant forest-photo initialized');
}
function seedPlatform() {
  const email = process.env.INIT_PLATFORM_EMAIL?.trim().toLowerCase();
  const password = process.env.INIT_PLATFORM_PASSWORD;
  if (!email && !password) return;
  if (!email || !password || password.length < 16) throw Error('INIT_PLATFORM_EMAIL 和 INIT_PLATFORM_PASSWORD 必须填写（密码至少16字符）');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return;
  if (db.prepare("SELECT 1 FROM users WHERE role='platform' LIMIT 1").get()) return;
  db.prepare('INSERT INTO users(id,merchant_id,email,password_hash,role) VALUES(?,NULL,?,?,?)').run(uid(),email,hashPassword(password),'platform');
  console.log('[bootstrap] platform operator initialized');
}

await ready;
migrate();
seedMerchant();
seedPlatform();
