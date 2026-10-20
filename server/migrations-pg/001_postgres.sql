CREATE TABLE merchants (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  intro TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT '#376854',
  active INTEGER NOT NULL DEFAULT 1,
  time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  merchant_id TEXT REFERENCES merchants(id),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','staff','platform')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  csrf_hash TEXT
);
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  image_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  seq BIGSERIAL UNIQUE,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  code TEXT NOT NULL UNIQUE,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  contact_email TEXT NOT NULL DEFAULT '',
  preferred_date TEXT NOT NULL,
  preferred_time TEXT NOT NULL,
  starts_at BIGINT NOT NULL,
  time_zone TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled','rejected')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded')),
  consent_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  package_id TEXT,
  buffer_before INTEGER NOT NULL DEFAULT 0,
  buffer_after INTEGER NOT NULL DEFAULT 0,
  package_title_snapshot TEXT NOT NULL DEFAULT '',
  package_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (package_price_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE days_off (
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  date TEXT NOT NULL,
  PRIMARY KEY (merchant_id, date)
);
CREATE TABLE idempotency (
  merchant_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  PRIMARY KEY (merchant_id, request_key)
);
CREATE TABLE merchant_applications (
  id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  desired_slug TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  merchant_id TEXT REFERENCES merchants(id),
  handled_by TEXT REFERENCES users(id),
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','staff')),
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at BIGINT NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE platform_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  kind TEXT NOT NULL CHECK (kind IN ('photographer','room','equipment')),
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 50),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, merchant_id)
);
CREATE TABLE resource_blocks (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  resource_id TEXT NOT NULL,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_min < end_min),
  FOREIGN KEY (resource_id, merchant_id) REFERENCES resources(id, merchant_id)
);
CREATE TABLE resource_weekly_hours (
  resource_id TEXT NOT NULL REFERENCES resources(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  CHECK (start_min < end_min),
  PRIMARY KEY (resource_id, weekday, start_min)
);
CREATE TABLE service_packages (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 100000000),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 720),
  buffer_before INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before BETWEEN 0 AND 180),
  buffer_after INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after BETWEEN 0 AND 180),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, merchant_id)
);
CREATE UNIQUE INDEX idx_one_default_package ON service_packages(service_id) WHERE is_default = 1;
CREATE TABLE package_requirements (
  package_id TEXT NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('photographer','room','equipment')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  PRIMARY KEY (package_id, kind)
);
CREATE TABLE booking_requirements (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('photographer','room','equipment')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  PRIMARY KEY (booking_id, kind)
);
CREATE TABLE booking_allocations (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  PRIMARY KEY (booking_id, resource_id)
);
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending','paid','refunded','failed')),
  provider TEXT NOT NULL,
  provider_ref TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  merchant_id TEXT REFERENCES merchants(id),
  booking_id TEXT REFERENCES bookings(id),
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  event TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_tenant_date ON bookings(merchant_id, preferred_date);
CREATE INDEX idx_bookings_tenant_status ON bookings(merchant_id, status);
CREATE INDEX idx_services_merchant ON services(merchant_id);
CREATE INDEX idx_events_booking ON events(booking_id);
CREATE INDEX idx_apps_status ON merchant_applications(status, created_at);
CREATE INDEX idx_invitations_merchant ON invitations(merchant_id, created_at);
CREATE INDEX idx_users_merchant ON users(merchant_id, active);
CREATE INDEX idx_resources_tenant_kind ON resources(merchant_id, kind, active);
CREATE INDEX idx_blocks_resource_date ON resource_blocks(resource_id, date);
CREATE INDEX idx_packages_service ON service_packages(merchant_id, service_id, active);
CREATE INDEX idx_booking_alloc_resource ON booking_allocations(resource_id);
CREATE INDEX idx_notifications_merchant ON notifications(merchant_id, created_at DESC);
CREATE INDEX idx_payments_booking ON payments(booking_id, created_at DESC);
