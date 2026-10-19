CREATE TABLE merchants (
 id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 intro TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
 accent TEXT NOT NULL DEFAULT '#376854', active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE users (
 id TEXT PRIMARY KEY, merchant_id TEXT REFERENCES merchants(id), email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','staff','platform')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE sessions (
 id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE TABLE services (
 id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL CHECK(price_cents>=0),
 duration_minutes INTEGER NOT NULL CHECK(duration_minutes>0), image_url TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE bookings (
 id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id),
 service_id TEXT NOT NULL REFERENCES services(id), code TEXT NOT NULL UNIQUE,
 contact_name TEXT NOT NULL, contact_phone TEXT NOT NULL, preferred_date TEXT NOT NULL,
 preferred_time TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','completed','cancelled','rejected')),
 consent_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE events (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 actor TEXT NOT NULL, action TEXT NOT NULL, before_value TEXT, after_value TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE days_off (merchant_id TEXT NOT NULL REFERENCES merchants(id), date TEXT NOT NULL, PRIMARY KEY(merchant_id,date));
CREATE TABLE idempotency (merchant_id TEXT NOT NULL, request_key TEXT NOT NULL, booking_id TEXT NOT NULL,
 PRIMARY KEY(merchant_id,request_key));
CREATE INDEX idx_bookings_tenant_date ON bookings(merchant_id,preferred_date);
CREATE INDEX idx_bookings_tenant_status ON bookings(merchant_id,status);
CREATE INDEX idx_services_merchant ON services(merchant_id);
CREATE INDEX idx_events_booking ON events(booking_id);
