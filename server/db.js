import { DatabaseSync } from 'node:sqlite';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export const path = resolve(process.env.DB_PATH || './data/appointment.sqlite');
mkdirSync(dirname(path),{recursive:true});
export const db = new DatabaseSync(path);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS merchants(id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, intro TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', accent TEXT NOT NULL DEFAULT '#376854', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, merchant_id TEXT REFERENCES merchants(id), email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','staff','platform')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS services(id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL CHECK(price_cents>=0), duration_minutes INTEGER NOT NULL CHECK(duration_minutes>0), image_url TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), service_id TEXT NOT NULL REFERENCES services(id), code TEXT NOT NULL UNIQUE, contact_name TEXT NOT NULL, contact_phone TEXT NOT NULL, preferred_date TEXT NOT NULL, preferred_time TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','completed','cancelled','rejected')), consent_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE, actor TEXT NOT NULL, action TEXT NOT NULL, before_value TEXT, after_value TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS days_off(merchant_id TEXT NOT NULL REFERENCES merchants(id), date TEXT NOT NULL, PRIMARY KEY(merchant_id,date));
CREATE TABLE IF NOT EXISTS idempotency(merchant_id TEXT NOT NULL, request_key TEXT NOT NULL, booking_id TEXT NOT NULL, PRIMARY KEY(merchant_id,request_key));
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_date ON bookings(merchant_id,preferred_date);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_status ON bookings(merchant_id,status);
CREATE INDEX IF NOT EXISTS idx_services_merchant ON services(merchant_id);
CREATE INDEX IF NOT EXISTS idx_events_booking ON events(booking_id);
`);
export const uid=()=>randomUUID();
export function hashPassword(password){const salt=randomUUID();return salt+':'+scryptSync(password,salt,64).toString('hex')}
export function checkPassword(password,encoded){try{const [salt,hash]=encoded.split(':');return timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(password,salt,64))}catch{return false}}
export function bootstrap(){if(db.prepare('SELECT COUNT(*) n FROM users').get().n)return;
 const email=process.env.INIT_OWNER_EMAIL,password=process.env.INIT_OWNER_PASSWORD;
 if(!email||!password||password.length<12){console.error('SETUP REQUIRED: set INIT_OWNER_EMAIL and INIT_OWNER_PASSWORD (at least 12 chars) to initialize first merchant.');return}
 const mid=uid(), user=uid();db.prepare('INSERT INTO merchants(id,slug,name,intro,address) VALUES(?,?,?,?,?)').run(mid,'forest-photo','森屿摄影','把日常记录成值得珍藏的瞬间','线上预约 · 具体拍摄地点以商家确认为准');db.prepare('INSERT INTO users(id,merchant_id,email,password_hash,role) VALUES(?,?,?,?,?)').run(user,mid,email.toLowerCase(),hashPassword(password),'owner');
 for(const [title,description,price,duration] of [['自然光个人写真','户外自然光拍摄 · 精修照片',39900,90],['双人纪念写真','情侣、闺蜜及双人纪念 · 精修照片',59900,120],['毕业纪念照','毕业纪念 · 个性化拍摄安排',49900,120]])db.prepare('INSERT INTO services(id,merchant_id,title,description,price_cents,duration_minutes) VALUES(?,?,?,?,?,?)').run(uid(),mid,title,description,price,duration);
 console.log('Initialized merchant forest-photo and owner '+email)
}
bootstrap();
