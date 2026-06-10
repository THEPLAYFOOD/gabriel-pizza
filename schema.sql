PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS store (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT 'Pizzaria artesanal',
  phone TEXT NOT NULL,
  display_phone TEXT NOT NULL,
  pix_key TEXT NOT NULL DEFAULT '88992258066',
  address TEXT NOT NULL,
  opening_hours TEXT NOT NULL,
  delivery_estimate TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1,
  closed_message TEXT NOT NULL DEFAULT 'Estamos fechados no momento. Volte mais tarde para fazer seu pedido.',
  auto_hours INTEGER NOT NULL DEFAULT 0,
  weekly_hours TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  allow_half INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  price REAL NOT NULL,
  description TEXT NOT NULL,
  ingredients TEXT NOT NULL,
  image_url TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  out_of_stock INTEGER NOT NULL DEFAULT 0,
  combo_product_ids TEXT NOT NULL DEFAULT '[]',
  combo_product_discounts TEXT NOT NULL DEFAULT '{}',
  combo_allow_half INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  common_fee REAL NOT NULL DEFAULT 8,
  estimated_time TEXT NOT NULL DEFAULT '35 a 55 min',
  store_address TEXT NOT NULL DEFAULT 'Av. das Pizzas, 1200 - Fortaleza, CE',
  store_lat REAL NOT NULL DEFAULT -3.7319,
  store_lng REAL NOT NULL DEFAULT -38.5267,
  max_radius_km REAL NOT NULL DEFAULT 8,
  per_km_fee REAL NOT NULL DEFAULT 1,
  google_maps_key TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS condominiums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  fee REAL NOT NULL,
  towers TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value REAL NOT NULL,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS admin_email_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  current_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at REAL NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at REAL NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  status TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  change_for TEXT,
  coupon_code TEXT,
  notes TEXT,
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('common', 'condo')),
  street TEXT,
  number TEXT,
  district TEXT,
  zip TEXT,
  complement TEXT,
  reference TEXT,
  condominium_name TEXT,
  tower TEXT,
  apartment TEXT,
  delivery_note TEXT,
  subtotal REAL NOT NULL,
  delivery_fee REAL NOT NULL,
  discount REAL NOT NULL,
  total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  category_name TEXT NOT NULL,
  unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  line_total REAL NOT NULL
);
