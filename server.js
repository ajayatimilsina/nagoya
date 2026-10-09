const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const QRCode = require('qrcode');

const app = express();
const port = Number(process.env.PORT || 3000);
const root = __dirname;
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(process.env.DB_PATH || path.join(dataDir, 'ajimaruy.sqlite'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8'));

function transaction(callback) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = callback(...args);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
}

const seed = JSON.parse(fs.readFileSync(path.join(root, 'db', 'seed.json'), 'utf8'));
if (db.prepare('SELECT COUNT(*) AS count FROM menu_items').get().count === 0) {
  const insert = db.prepare(`INSERT INTO menu_items
    (id, name, category, price, options, sold_out, stock, updated_at)
    VALUES (@id, @name, @category, @price, @options, @soldOut, @stock, @updatedAt)`);
  const addSeed = transaction((items) => {
    for (const item of items) insert.run({
      ...item,
      options: JSON.stringify(item.options),
      soldOut: Number(item.soldOut),
      updatedAt: new Date().toISOString()
    });
  });
  addSeed(seed);
}

app.use(express.json({ limit: '1mb' }));
app.use('/vendor/bootstrap', express.static(path.join(root, 'node_modules', 'bootstrap', 'dist')));
app.use(express.static(path.join(root, 'public')));

const sessions = new Map();
const failedPins = new Map();
const eventClients = new Set();
const staffPin = process.env.STAFF_PIN || '2468';

function publish(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of eventClients) client.write(payload);
}

function staffOnly(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: 'スタッフPINを入力してください。' });
  }
  next();
}

function parseMenu(row) {
  return {
    ...row,
    options: JSON.parse(row.options),
    soldOut: Boolean(row.sold_out),
    active: Boolean(row.active)
  };
}

function getOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  return {
    ...order,
    receiptNeeded: Boolean(order.receipt_needed),
    memberPrice: Boolean(order.member_price),
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid').all(id)
      .map((item) => ({ ...item, options: JSON.parse(item.options) }))
  };
}

function getOrders(whereSql = '', params = []) {
  const orders = db.prepare(`SELECT id FROM orders ${whereSql} ORDER BY created_at DESC`).all(...params);
  return orders.map(({ id }) => getOrder(id));
}

function addNotice(tableNo, type, orderId = null, message = '') {
  const info = db.prepare(`INSERT INTO notices (table_no, type, order_id, message, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(tableNo, type, orderId, message, new Date().toISOString());
  return db.prepare('SELECT * FROM notices WHERE id = ?').get(info.lastInsertRowid);
}

function validOptions(item, requestedOptions) {
  const groups = JSON.parse(item.options);
  const chosen = [];
  for (const request of requestedOptions || []) {
    const group = groups.find((option) => option.name === request.group);
    const choice = group?.choices?.find((option) => option.name === request.name);
    if (!choice) throw new Error(`${item.name}のオプションを確認してください。`);
    chosen.push({ group: group.name, name: choice.name, extraPrice: Number(choice.extraPrice || 0) });
  }
  return chosen;
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/api/staff/login', (req, res) => {
  const key = req.ip;
  const failure = failedPins.get(key) || { count: 0, until: 0 };
  if (failure.until > Date.now()) return res.status(429).json({ error: 'しばらくしてから再度お試しください。' });
  if (String(req.body.pin || '') !== staffPin) {
    failure.count += 1;
    if (failure.count >= 5) {
      failure.count = 0;
      failure.until = Date.now() + 10 * 60 * 1000;
    }
    failedPins.set(key, failure);
    return res.status(401).json({ error: 'PINが違います。' });
  }
  failedPins.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
  res.json({ token, expiresIn: 12 * 60 * 60 * 1000 });
});

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  eventClients.add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    eventClients.delete(res);
  });
});

app.get('/api/menu', (_req, res) => {
  res.json(db.prepare('SELECT * FROM menu_items WHERE active = 1 ORDER BY category, id').all().map(parseMenu));
});

app.get('/api/customer/tables/:tableNo', (req, res) => {
  const tableNo = Number(req.params.tableNo);
  if (!Number.isInteger(tableNo) || tableNo < 1) return res.status(400).json({ error: 'テーブル番号が不正です。' });
  const orders = getOrders('WHERE table_no = ? AND closed_at IS NULL', [tableNo]);
  const notices = db.prepare(`SELECT * FROM notices WHERE table_no IN (0, ?) AND acknowledged = 0
    ORDER BY created_at DESC`).all(tableNo);
  res.json({ tableNo, orders, notices, closed: orders.length === 0 && notices.some((notice) => notice.type === 'thanks') });
});

app.post('/api/orders', (req, res) => {
  const body = req.body || {};
  const tableNo = Number(body.tableNo);
  if (!Number.isInteger(tableNo) || tableNo < 1 || tableNo > 999) return res.status(400).json({ error: 'テーブル番号が不正です。' });
  if (!Array.isArray(body.items) || body.items.length === 0) return res.status(400).json({ error: '商品を選択してください。' });
  if (body.items.length > 100) return res.status(400).json({ error: '注文数が上限を超えています。' });
  const orderId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  let total = 0;
  const prepared = [];
  try {
    for (const line of body.items) {
      const menuItem = db.prepare('SELECT * FROM menu_items WHERE id = ? AND active = 1').get(Number(line.menuItemId));
      const quantity = Number(line.quantity);
      if (!menuItem || menuItem.sold_out || menuItem.stock < quantity) throw new Error('欠品または在庫不足の商品が含まれています。メニューを更新してください。');
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error('数量が不正です。');
      const options = validOptions(menuItem, line.options);
      const unitPrice = menuItem.price + options.reduce((sum, option) => sum + option.extraPrice, 0);
      total += unitPrice * quantity;
      prepared.push({ menuItem, quantity, options, unitPrice, note: String(line.note || '').slice(0, 300) });
    }
    const save = transaction(() => {
      db.prepare(`INSERT INTO orders (id, table_no, adults, children, gender, allergy, member_price,
        receipt_needed, addressee, notes, total, created_at)
        VALUES (@id, @tableNo, @adults, @children, @gender, @allergy, @memberPrice,
        @receiptNeeded, @addressee, @notes, @total, @createdAt)`).run({
        id: orderId,
        tableNo,
        adults: Math.max(1, Math.min(10, Number(body.adults) || 1)),
        children: Math.max(0, Math.min(9, Number(body.children) || 0)),
        gender: ['All', 'Men', 'Women'].includes(body.gender) ? body.gender : 'All',
        allergy: body.allergy === 'あり' ? 'あり' : 'なし',
        memberPrice: Number(Boolean(body.memberPrice)),
        receiptNeeded: Number(Boolean(body.receiptNeeded)),
        addressee: String(body.addressee || '').slice(0, 80),
        notes: String(body.notes || '').slice(0, 500),
        total,
        createdAt
      });
      const insertLine = db.prepare(`INSERT INTO order_items
        (id, order_id, menu_item_id, name, base_price, unit_price, quantity, options, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const decrement = db.prepare(`UPDATE menu_items SET stock = stock - ?, sold_out = CASE WHEN stock - ? <= 0 THEN 1 ELSE sold_out END,
        updated_at = ? WHERE id = ?`);
      for (const line of prepared) {
        insertLine.run(crypto.randomUUID(), orderId, line.menuItem.id, line.menuItem.name,
          line.menuItem.price, line.unitPrice, line.quantity, JSON.stringify(line.options), line.note);
        decrement.run(line.quantity, line.quantity, createdAt, line.menuItem.id);
      }
    });
    save();
  } catch (error) {
    return res.status(400).json({ error: error.message || '注文を受け付けられませんでした。' });
  }
  const order = getOrder(orderId);
  publish({ type: 'order.created', tableNo, orderId });
  res.status(201).json(order);
});

app.post('/api/tables/:tableNo/call', (req, res) => {
  const tableNo = Number(req.params.tableNo);
  if (!Number.isInteger(tableNo) || tableNo < 1) return res.status(400).json({ error: 'テーブル番号が不正です。' });
  const notice = addNotice(tableNo, 'staff_call', null, '店員を呼んでいます');
  publish({ type: 'staff.call', tableNo, noticeId: notice.id });
  res.status(201).json({ ok: true });
});

app.post('/api/notices/:id/ack', (req, res) => {
  const tableNo = Number(req.body.tableNo);
  db.prepare('UPDATE notices SET acknowledged = 1 WHERE id = ? AND table_no IN (0, ?)').run(Number(req.params.id), tableNo);
  res.json({ ok: true });
});

app.use('/api/staff', staffOnly);

app.get('/api/staff/orders', (_req, res) => {
  res.json(getOrders('WHERE closed_at IS NULL'));
});

app.post('/api/staff/order-items/:itemId/status', (req, res) => {
  const statuses = ['preparing', 'ready', 'served'];
  const status = String(req.body.status || '');
  if (!statuses.includes(status)) return res.status(400).json({ error: 'ステータスが不正です。' });
  const item = db.prepare('SELECT * FROM order_items WHERE id = ?').get(req.params.itemId);
  if (!item) return res.status(404).json({ error: '注文が見つかりません。' });
  db.prepare('UPDATE order_items SET status = ? WHERE id = ?').run(status, item.id);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(item.order_id);
  const lineStatuses = db.prepare('SELECT status FROM order_items WHERE order_id = ?').all(item.order_id).map((line) => line.status);
  const orderStatus = lineStatuses.every((value) => value === 'served') ? 'served'
    : lineStatuses.every((value) => value === 'ready' || value === 'served') ? 'ready'
      : lineStatuses.some((value) => value === 'preparing' || value === 'ready') ? 'preparing' : 'received';
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(orderStatus, order.id);
  publish({ type: 'order.updated', tableNo: order.table_no, orderId: order.id });
  res.json(getOrder(order.id));
});

app.post('/api/staff/tables/:tableNo/notice', (req, res) => {
  const tableNo = Number(req.params.tableNo);
  const type = String(req.body.type || '');
  const allowed = ['pickup', 'thanks', 'welcome'];
  if (!Number.isInteger(tableNo) || tableNo < 1 || !allowed.includes(type)) return res.status(400).json({ error: '通知内容が不正です。' });
  let orderId = req.body.orderId || null;
  if (type === 'pickup' && orderId) {
    db.prepare("UPDATE orders SET status = 'ready' WHERE id = ? AND table_no = ? AND closed_at IS NULL").run(orderId, tableNo);
    db.prepare("UPDATE order_items SET status = 'ready' WHERE order_id = ? AND status != 'served'").run(orderId);
  }
  const messages = { pickup: 'お料理ができました。カウンターまで取りに来てください。', thanks: 'ありがとうございました', welcome: 'いらっしゃいませ' };
  const notice = addNotice(tableNo, type, orderId, messages[type]);
  publish({ type: 'customer.notice', tableNo, notice });
  res.status(201).json(notice);
});

app.post('/api/staff/announcement', (req, res) => {
  const type = ['welcome', 'thanks'].includes(req.body.type) ? req.body.type : null;
  if (!type) return res.status(400).json({ error: 'アナウンスが不正です。' });
  const message = type === 'welcome' ? 'いらっしゃいませ' : 'ありがとうございました';
  let notice = null;
  if (req.body.showCustomers) {
    notice = addNotice(0, type, null, message);
    publish({ type: 'customer.notice', tableNo: 0, notice });
  }
  res.json({ ok: true, message, notice });
});

app.get('/api/staff/tables', (_req, res) => {
  const active = getOrders('WHERE closed_at IS NULL');
  const calls = db.prepare("SELECT * FROM notices WHERE type = 'staff_call' AND acknowledged = 0 ORDER BY created_at").all();
  const byTable = new Map();
  for (const order of active) {
    if (!byTable.has(order.table_no)) byTable.set(order.table_no, []);
    byTable.get(order.table_no).push(order);
  }
  res.json({ tables: [...byTable].map(([tableNo, orders]) => ({ tableNo, orders })), calls });
});

app.post('/api/staff/checkout', (req, res) => {
  const tableNo = Number(req.body.tableNo);
  const method = String(req.body.method || '');
  const discountType = req.body.discountType === 'percent' ? 'percent' : 'yen';
  const discountValue = Math.max(0, Number(req.body.discountValue) || 0);
  if (!Number.isInteger(tableNo) || tableNo < 1 || !['cash', 'paypay', 'card'].includes(method)) {
    return res.status(400).json({ error: '会計内容を確認してください。' });
  }
  const orders = getOrders('WHERE table_no = ? AND closed_at IS NULL', [tableNo]);
  if (!orders.length) return res.status(400).json({ error: '未会計の注文がありません。' });
  const subtotal = orders.reduce((sum, order) => sum + order.total, 0);
  const discountAmount = discountType === 'percent'
    ? Math.min(subtotal, Math.round(subtotal * Math.min(100, discountValue) / 100))
    : Math.min(subtotal, Math.round(discountValue));
  const total = subtotal - discountAmount;
  const createdAt = new Date().toISOString();
  const orderIds = orders.map((order) => order.id);
  const save = transaction(() => {
    db.prepare(`INSERT INTO payments (table_no, order_ids, subtotal, discount_type, discount_value,
      discount_amount, total, method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(tableNo, JSON.stringify(orderIds), subtotal, discountType, discountValue, discountAmount, total, method, createdAt);
    db.prepare("UPDATE orders SET closed_at = ?, status = 'served' WHERE table_no = ? AND closed_at IS NULL").run(createdAt, tableNo);
    return addNotice(tableNo, 'thanks', null, 'ありがとうございました');
  });
  const notice = save();
  const receipt = {
    store: 'あじまるや',
    branch: '中島駅',
    tableNo,
    orders,
    subtotal,
    discountAmount,
    total,
    method,
    receiptNeeded: orders.some((order) => order.receiptNeeded),
    addressee: orders.find((order) => order.addressee)?.addressee || '',
    createdAt
  };
  publish({ type: 'table.closed', tableNo, notice });
  res.json(receipt);
});

app.get('/api/staff/summary', (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT method, COUNT(*) AS count, SUM(total) AS total, SUM(discount_amount) AS discounts
    FROM payments WHERE date(created_at) = ? GROUP BY method`).all(date);
  const methods = { cash: 0, paypay: 0, card: 0 };
  let orders = 0;
  let discounts = 0;
  for (const row of rows) {
    methods[row.method] = row.total || 0;
    orders += row.count;
    discounts += row.discounts || 0;
  }
  res.json({ date, methods, orders, discounts, sales: Object.values(methods).reduce((sum, value) => sum + value, 0) });
});

app.get('/api/staff/menu', (_req, res) => {
  res.json(db.prepare('SELECT * FROM menu_items ORDER BY category, id').all().map(parseMenu));
});

app.post('/api/staff/menu', (req, res) => {
  const item = req.body || {};
  const id = Number(item.id);
  const price = Number(item.price);
  const stock = Number(item.stock);
  if (!Number.isInteger(id) || !String(item.name || '').trim() || !String(item.category || '').trim()
      || !Number.isInteger(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ error: '商品情報を確認してください。ID・価格・在庫は整数です。' });
  }
  try {
    const options = JSON.stringify(Array.isArray(item.options) ? item.options : []);
    db.prepare(`INSERT INTO menu_items (id, name, category, price, options, sold_out, stock, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(id, String(item.name).trim(), String(item.category).trim(),
      price, options, Number(Boolean(item.soldOut || stock === 0)), stock, new Date().toISOString());
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  publish({ type: 'menu.updated' });
  res.status(201).json(parseMenu(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id)));
});

app.put('/api/staff/menu/:id', (req, res) => {
  const id = Number(req.params.id);
  const item = req.body || {};
  const price = Number(item.price);
  const stock = Number(item.stock);
  if (!String(item.name || '').trim() || !String(item.category || '').trim()
      || !Number.isInteger(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ error: '商品情報を確認してください。' });
  }
  const result = db.prepare(`UPDATE menu_items SET name = ?, category = ?, price = ?, options = ?,
    sold_out = ?, stock = ?, active = ?, updated_at = ? WHERE id = ?`).run(
    String(item.name).trim(), String(item.category).trim(), price,
    JSON.stringify(Array.isArray(item.options) ? item.options : []), Number(Boolean(item.soldOut || stock === 0)),
    stock, Number(item.active !== false), new Date().toISOString(), id);
  if (!result.changes) return res.status(404).json({ error: '商品が見つかりません。' });
  publish({ type: 'menu.updated' });
  res.json(parseMenu(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id)));
});

app.delete('/api/staff/menu/:id', (req, res) => {
  db.prepare('UPDATE menu_items SET active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), Number(req.params.id));
  publish({ type: 'menu.updated' });
  res.json({ ok: true });
});

app.get('/api/staff/inventory', (_req, res) => {
  const items = db.prepare('SELECT id, name, category, stock, sold_out FROM menu_items WHERE active = 1 ORDER BY category, name').all();
  res.json(items.map((item) => ({ ...item, soldOut: Boolean(item.sold_out), lowStock: item.stock > 0 && item.stock < 5 })));
});

app.post('/api/staff/inventory/:id/stocktake', (req, res) => {
  const id = Number(req.params.id);
  const actual = Number(req.body.actualCount);
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ? AND active = 1').get(id);
  if (!item || !Number.isInteger(actual) || actual < 0) return res.status(400).json({ error: '実在庫数を確認してください。' });
  const difference = actual - item.stock;
  const update = transaction(() => {
    db.prepare('INSERT INTO inventory_logs (menu_item_id, system_count, actual_count, difference, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, item.stock, actual, difference, new Date().toISOString());
    db.prepare('UPDATE menu_items SET stock = ?, sold_out = ?, updated_at = ? WHERE id = ?')
      .run(actual, Number(actual === 0), new Date().toISOString(), id);
  });
  update();
  publish({ type: 'inventory.updated', itemId: id });
  res.json({ systemCount: item.stock, actualCount: actual, difference });
});

app.get('/api/staff/finance', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const sales = db.prepare(`SELECT date(created_at) AS day, SUM(total) AS amount FROM payments
    WHERE strftime('%Y-%m', created_at) = ? GROUP BY date(created_at) ORDER BY day`).all(month);
  const expenseDays = db.prepare(`SELECT expense_date AS day, SUM(amount) AS amount FROM expenses
    WHERE substr(expense_date, 1, 7) = ? GROUP BY expense_date ORDER BY expense_date`).all(month);
  const expenses = db.prepare(`SELECT * FROM expenses WHERE substr(expense_date, 1, 7) = ? ORDER BY expense_date DESC, id DESC`).all(month);
  const salesTotal = sales.reduce((sum, row) => sum + (row.amount || 0), 0);
  const expenseTotal = expenses.reduce((sum, row) => sum + row.amount, 0);
  const dailySales = new Map(sales.map((row) => [row.day, row.amount || 0]));
  const dailyExpenses = new Map(expenseDays.map((row) => [row.day, row.amount || 0]));
  const days = [...new Set([...dailySales.keys(), ...dailyExpenses.keys()])].sort();
  const daily = days.map((day) => ({ day, sales: dailySales.get(day) || 0, expenses: dailyExpenses.get(day) || 0 }))
    .map((row) => ({ ...row, profit: row.sales - row.expenses }));
  res.json({ month, sales, expenses, daily, salesTotal, expenseTotal, profit: salesTotal - expenseTotal });
});

app.post('/api/staff/expenses', (req, res) => {
  const { date, category, description = '' } = req.body || {};
  const amount = Number(req.body.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !String(category || '').trim()
      || !Number.isInteger(amount) || amount < 0) return res.status(400).json({ error: '経費の内容を確認してください。' });
  const result = db.prepare(`INSERT INTO expenses (expense_date, category, description, amount, created_at)
    VALUES (?, ?, ?, ?, ?)`).run(date, String(category).trim(), String(description).slice(0, 200), amount, new Date().toISOString());
  res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid));
});

app.get('/api/staff/qr/:tableNo', async (req, res) => {
  const tableNo = Number(req.params.tableNo);
  if (!Number.isInteger(tableNo) || tableNo < 1 || tableNo > 999) return res.status(400).json({ error: 'テーブル番号が不正です。' });
  const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${baseUrl.replace(/\/$/, '')}/index.html?table=${tableNo}`;
  try {
    res.json({ url, dataUrl: await QRCode.toDataURL(url, { width: 280, margin: 1 }) });
  } catch {
    res.status(500).json({ error: 'QRコードを作成できませんでした。' });
  }
});

app.listen(port, () => console.log(`あじまるや POS: http://localhost:${port}`));