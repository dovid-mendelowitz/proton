// Shared rule scope checks. A missing context value never satisfies a rule that constrains it.
function ruleMatchesContext(rule, context = {}) {
  if (rule.enabled === 0 || rule.enabled === false) return false
  if (rule.account_id != null && (!context.accountId || Number(rule.account_id) !== Number(context.accountId))) return false
  if (rule.min_amount != null && (context.amount == null || context.amount < Number(rule.min_amount))) return false
  if (rule.max_amount != null && (context.amount == null || context.amount > Number(rule.max_amount))) return false
  if (rule.valid_from && (!context.date || context.date < rule.valid_from)) return false
  if (rule.valid_to && (!context.date || context.date > rule.valid_to)) return false
  return true
}

function filterEligibleRules(rules, context = {}) {
  return (rules || []).filter(rule => ruleMatchesContext(rule, context))
}

module.exports = { ruleMatchesContext, filterEligibleRules }
