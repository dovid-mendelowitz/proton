const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { runMigrations } = require('../src/db/migrations')

function makeDatabase() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Accounts (id INTEGER PRIMARY KEY);
    CREATE TABLE Transactions (id INTEGER PRIMARY KEY);
    CREATE TABLE Assets (id INTEGER PRIMARY KEY);
    CREATE TABLE Insurance_Policies (id INTEGER PRIMARY KEY);
    CREATE TABLE Liabilities (id INTEGER PRIMARY KEY);
    CREATE TABLE Recurring_Templates (id INTEGER PRIMARY KEY);
    CREATE TABLE Savings_Goals (id INTEGER PRIMARY KEY);
  `)
  return db
}

test('repairs missing columns in a fresh/minimal schema', () => {
  const db = makeDatabase()
  try {
    runMigrations(db)
    const txColumns = db.prepare('PRAGMA table_info(Transactions)').all().map(c => c.name)
    const accountColumns = db.prepare('PRAGMA table_info(Accounts)').all().map(c => c.name)
    const assetColumns = db.prepare('PRAGMA table_info(Assets)').all().map(c => c.name)

    for (const column of ['value_date', 'import_id', 'settles_credit_card_id', 'parent_id', 'offset_group_id', 'insurance_id', 'liability_id', 'recurring_id', 'savings_goal_id']) {
      assert.ok(txColumns.includes(column), `Transactions.${column} should exist`)
    }
    for (const column of ['billing_day', 'settlement_account_id', 'current_balance', 'balance_updated_at']) {
      assert.ok(accountColumns.includes(column), `Accounts.${column} should exist`)
    }
    for (const column of ['exchange', 'last_api_price', 'price_currency', 'price_override', 'price_updated_at', 'purchase_price', 'purchase_date']) {
      assert.ok(assetColumns.includes(column), `Assets.${column} should exist`)
    }
    assert.equal(db.prepare('SELECT name FROM Schema_Migrations WHERE name=?').get('repair_missing_columns_v1').name, 'repair_missing_columns_v1')
  } finally {
    db.close()
  }
})

test('can safely run the schema repair more than once', () => {
  const db = makeDatabase()
  try {
    runMigrations(db)
    assert.doesNotThrow(() => runMigrations(db))
    const names = db.prepare('PRAGMA table_info(Transactions)').all().map(c => c.name)
    assert.equal(names.filter(name => name === 'import_id').length, 1)
  } finally {
    db.close()
  }
})
