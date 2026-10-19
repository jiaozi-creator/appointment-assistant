-- Reservation resources and package snapshots; additive SQLite migration.
-- One studio can be operated by a single photographer or a team.
CREATE TABLE resources (
 id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id),
 kind TEXT NOT NULL CHECK(kind IN ('photographer','room','equipment')),
 name TEXT NOT NULL, capacity INTEGER NOT NULL DEFAULT 1 CHECK(capacity BETWEEN 1 AND 50),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id, merchant_id)
);
CREATE INDEX idx_resources_tenant_kind ON resources(merchant_id,kind,active);
CREATE TABLE resource_blocks (
 id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id),
 resource_id TEXT NOT NULL, date TEXT NOT NULL,
 start_min INTEGER NOT NULL CHECK(start_min BETWEEN 0 AND 1439),
 end_min INTEGER NOT NULL CHECK(end_min BETWEEN 1 AND 1440),
 reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(start_min < end_min),
 FOREIGN KEY(resource_id,merchant_id) REFERENCES resources(id,merchant_id)
);
CREATE INDEX idx_blocks_resource_date ON resource_blocks(resource_id,date);
CREATE TABLE resource_weekly_hours (
 resource_id TEXT NOT NULL REFERENCES resources(id), weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 start_min INTEGER NOT NULL CHECK(start_min BETWEEN 0 AND 1439),
 end_min INTEGER NOT NULL CHECK(end_min BETWEEN 1 AND 1440),
 CHECK(start_min < end_min), PRIMARY KEY(resource_id,weekday,start_min)
);
CREATE TABLE service_packages (
 id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id),
 service_id TEXT NOT NULL REFERENCES services(id), title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 0 AND 100000000),
 duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 15 AND 720),
 buffer_before INTEGER NOT NULL DEFAULT 0 CHECK(buffer_before BETWEEN 0 AND 180),
 buffer_after INTEGER NOT NULL DEFAULT 0 CHECK(buffer_after BETWEEN 0 AND 180),
 is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(id,merchant_id)
);
CREATE INDEX idx_packages_service ON service_packages(merchant_id,service_id,active);
CREATE UNIQUE INDEX idx_one_default_package ON service_packages(service_id) WHERE is_default=1;
CREATE TABLE package_requirements (
 package_id TEXT NOT NULL REFERENCES service_packages(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('photographer','room','equipment')),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 50),
 PRIMARY KEY(package_id,kind)
);
CREATE TABLE booking_requirements (
 booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('photographer','room','equipment')),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 50),
 PRIMARY KEY(booking_id,kind)
);
CREATE TABLE booking_allocations (
 booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 resource_id TEXT NOT NULL REFERENCES resources(id),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 50),
 PRIMARY KEY(booking_id,resource_id)
);
CREATE INDEX idx_booking_alloc_resource ON booking_allocations(resource_id);
ALTER TABLE bookings ADD COLUMN package_id TEXT REFERENCES service_packages(id);
ALTER TABLE bookings ADD COLUMN buffer_before INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN buffer_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN package_title_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN package_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(package_price_cents>=0);
-- Existing tenants receive one initial photographer so legacy reservations remain valid.
INSERT INTO resources(id,merchant_id,kind,name,capacity)
 SELECT id||':photographer-default',id,'photographer','默认摄影师',1 FROM merchants;
INSERT INTO service_packages(id,merchant_id,service_id,title,description,price_cents,duration_minutes,is_default,active)
 SELECT id||':standard',merchant_id,id,'标准套餐',description,price_cents,duration_minutes,1,active FROM services;
INSERT INTO package_requirements(package_id,kind,quantity)
 SELECT id,'photographer',1 FROM service_packages;
UPDATE bookings SET package_id=service_id||':standard';
UPDATE bookings SET package_title_snapshot=COALESCE((SELECT title FROM service_packages WHERE service_packages.id=bookings.package_id),'标准套餐'),
 package_price_cents=COALESCE((SELECT price_cents FROM service_packages WHERE service_packages.id=bookings.package_id),0);
INSERT INTO booking_requirements(booking_id,kind,quantity)
 SELECT id,'photographer',1 FROM bookings;
INSERT INTO booking_allocations(booking_id,resource_id,quantity)
 SELECT b.id,b.merchant_id||':photographer-default',1 FROM bookings b
 WHERE b.status IN ('confirmed','completed');
