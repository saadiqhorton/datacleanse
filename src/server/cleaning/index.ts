/**
 * Rule-based cleaning engine. Pure TypeScript, no database.
 *
 *   rulesFromOptions(opts, headers, columns) -> RuleSpec[]   built-in rules for the Upload options
 *   proposeChanges(table, rules)             -> ProposedChange[]
 *   applyChanges(table, changes)             -> { table, rowsRemoved }
 *   previewRule(table, rule, limit?)         -> { matches, examples }
 *   matchRuleSet(headers, sets)              -> rule-set id | null
 *   globMatch(pattern, header)               -> boolean
 */

export { globMatch } from "./glob";
export { matchRuleSet, rulesFromOptions } from "./rules";
export { previewRule, proposeChanges } from "./propose";
export { applyChanges } from "./apply";
