const test = require('node:test')
const assert = require('node:assert/strict')
const { ruleMatchesContext, filterEligibleRules } = require('../src/lib/transactionRules')

test('applies account and amount constraints inclusively', () => {
  const rule = { account_id: 3, min_amount: 50, max_amount: 200, enabled: 1 }
  assert.equal(ruleMatchesContext(rule, { accountId: 3, amount: 50 }), true)
  assert.equal(ruleMatchesContext(rule, { accountId: 3, amount: 200 }), true)
  assert.equal(ruleMatchesContext(rule, { accountId: 4, amount: 100 }), false)
  assert.equal(ruleMatchesContext(rule, { accountId: 3, amount: 49.99 }), false)
  assert.equal(ruleMatchesContext(rule, { accountId: 3, amount: 200.01 }), false)
})

test('applies date boundaries inclusively and refuses missing dates for date-scoped rules', () => {
  const rule = { valid_from: '2026-01-01', valid_to: '2026-12-31', enabled: 1 }
  assert.equal(ruleMatchesContext(rule, { date: '2026-01-01' }), true)
  assert.equal(ruleMatchesContext(rule, { date: '2026-12-31' }), true)
  assert.equal(ruleMatchesContext(rule, { date: '2025-12-31' }), false)
  assert.equal(ruleMatchesContext(rule, { date: null }), false)
})

test('disabled rules never match; unscoped rules remain eligible', () => {
  assert.equal(ruleMatchesContext({ enabled: 0 }, {}), false)
  assert.equal(ruleMatchesContext({}, {}), true)
  assert.deepEqual(filterEligibleRules([{ enabled: 0 }, {}, { account_id: 2 }], {}), [{}])
})
