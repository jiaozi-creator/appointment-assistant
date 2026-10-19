ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
ALTER TABLE sessions ADD COLUMN csrf_hash TEXT;
ALTER TABLE bookings ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 90;
UPDATE bookings SET duration_minutes = (SELECT duration_minutes FROM services WHERE services.id=bookings.service_id);
CREATE TABLE merchant_applications (
 id TEXT PRIMARY KEY, business_name TEXT NOT NULL, desired_slug TEXT NOT NULL,
 contact_email TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 merchant_id TEXT REFERENCES merchants(id), handled_by TEXT REFERENCES users(id),
 handled_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE invitations (
 id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id),
 email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','staff')),
 token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL, accepted_at TEXT, revoked_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE platform_events (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL, subject_id TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_apps_status ON merchant_applications(status,created_at);
CREATE INDEX idx_invitations_merchant ON invitations(merchant_id,created_at);
CREATE INDEX idx_bookings_overlap ON bookings(merchant_id,preferred_date,status,preferred_time);
CREATE INDEX idx_users_merchant ON users(merchant_id,active);
