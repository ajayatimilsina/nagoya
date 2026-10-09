PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  options TEXT NOT NULL DEFAULT '[]',
  sold_out INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  table_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  adults INTEGER NOT NULL DEFAULT 1,
  children INTEGER NOT NULL DEFAULT 0,
  gender TEXT NOT NULL DEFAULT 'All',
  allergy TEXT NOT NULL DEFAULT 'なし',
  member_price INTEGER NOT NULL DEFAULT 0,
  receipt_needed INTEGER NOT NULL DEFAULT 0,
  addressee TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  menu_item_id INTEGER REFERENCES menu_items(id),
  name TEXT NOT NULL,
  base_price INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  options TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received'
);

CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_no INTEGER NOT NULL,
  type TEXT NOT NULL,
  order_id TEXT,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_no INTEGER NOT NULL,
  order_ids TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount_type TEXT NOT NULL,
  discount_value REAL NOT NULL,
  discount_amount INTEGER NOT NULL,
  total INTEGER NOT NULL,
  method TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
  system_count INTEGER NOT NULL,
  actual_count INTEGER NOT NULL,
  difference INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL CHECK (amount >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_table_open ON orders(table_no, closed_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_notices_table_open ON notices(table_no, acknowledged);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);