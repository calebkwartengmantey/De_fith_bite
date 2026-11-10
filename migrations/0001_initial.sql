CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_pesewas INTEGER NOT NULL CHECK (price_pesewas > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

INSERT INTO products (id, name, price_pesewas) VALUES
  ('chicken-shawarma', 'Chicken Shawarma', 4000),
  ('sausage-shawarma', 'Sausage Shawarma', 4000),
  ('beef-shawarma', 'Beef Shawarma', 5000),
  ('mixed-shawarma', 'Mixed Shawarma', 6000),
  ('loaded-shawarma', 'Loaded Shawarma', 8000),
  ('ultimate-shawarma', 'Ultimate Shawarma', 10000),
  ('loaded-fries-chicken', 'Loaded Fries Chicken', 8000),
  ('loaded-fries-mix-combo', 'Loaded Fries Mix Combo', 10000);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  paystack_reference TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  items_json TEXT NOT NULL,
  total_pesewas INTEGER NOT NULL CHECK (total_pesewas > 0),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
  status TEXT NOT NULL DEFAULT 'awaiting_restaurant' CHECK (status IN ('awaiting_restaurant', 'received', 'preparing', 'ready', 'completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT
);

CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL,
  actor_phone TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sms_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  recipient TEXT NOT NULL,
  message_type TEXT NOT NULL,
  message TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sending_at TEXT,
  sent_at TEXT,
  UNIQUE (order_id, recipient, message_type)
);

CREATE TABLE admin_otp_challenges (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL
);

CREATE INDEX orders_payment_status_created ON orders(payment_status, created_at DESC);
CREATE INDEX orders_status_created ON orders(status, created_at DESC);
CREATE INDEX order_events_order_created ON order_events(order_id, created_at);
CREATE INDEX sms_outbox_order_status ON sms_outbox(order_id, delivery_status);
CREATE INDEX otp_phone_created ON admin_otp_challenges(phone, created_at DESC);
