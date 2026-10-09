const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

test('schema accepts the supplied seed menu and preserves unique menu IDs', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.json'), 'utf8'));
  const insert = db.prepare(`INSERT INTO menu_items (id, name, category, price, options, sold_out, stock, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN');
  seed.forEach((item) => insert.run(
    item.id, item.name, item.category, item.price, JSON.stringify(item.options), Number(item.soldOut), item.stock, '2026-10-09T00:00:00.000Z'
  ));
  db.exec('COMMIT');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM menu_items').get().count, 19);
  assert.equal(db.prepare('SELECT stock FROM menu_items WHERE id = 80').get().stock, 30);
  assert.throws(() => insert.run(80, 'duplicate', 'ナンセット', 1, '[]', 0, 1, 'now'));
  db.close();
});