import { DatabaseSync } from 'node:sqlite';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

export const databasePath = resolve(process.env.DB_PATH || './data/appointment.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
export const db = new DatabaseSync(databasePath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
export const uid = () => randomUUID();

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // Baseline databases created by the original non-versioned V1 initializer.
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='merchants'").get() &&
      !db.prepare('SELECT 1 FROM schema_migrations LIMIT 1').get()) {
    db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run('001_initial.sql');
  }
  const directory = resolve('server/migrations');
  const files = readdirSync(directory).filter(f => /^\d+_[\w-]+\.sql$/.test(f)).sort();
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
  // Never create a second initial demo merchant after the installation has real merchants.
  if (db.prepare('SELECT COUNT(*) AS n FROM merchants').get().n) return;
  transaction(() => {
    const mid = uid();
    db.prepare('INSERT INTO merchants(id,slug,name,intro,address) VALUES(?,?,?,?,?)').run(mid,'forest-photo','森屿摄影','把日常记录成值得珍藏的瞬间','线上预约 · 具体地点以商家确认为准');
    db.prepare('INSERT INTO users(id,merchant_id,email,password_hash,role) VALUES(?,?,?,?,?)').run(uid(),mid,email,hashPassword(password),'owner');
    db.prepare('INSERT INTO resources(id,merchant_id,kind,name,capacity) VALUES(?,?,?,?,?)').run(uid(),mid,'photographer','默认摄影师',1);
    for (const [name, description, price, minutes] of [
      ['自然光个人写真','户外自然光拍摄 · 精修照片',39900,90],
      ['双人纪念写真','情侣、闺蜜及双人纪念 · 精修照片',59900,120],
      ['毕业纪念照','毕业纪念 · 个性化拍摄安排',49900,120]
    ]) {
      const serviceId=uid(),packageId=uid();
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

migrate();
seedMerchant();
seedPlatform();
