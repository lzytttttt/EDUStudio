import type { Evaluator } from '../types'
import { RuleEvaluator } from './ruleEvaluator'

/**
 * 自评 Provider 工厂（v0.9.1）：规则版本地实现，mock / api 共用、零 LLM 成本。
 * mode 参数预留：LLM 版 Evaluator（二期）按 mode 分流。
 */
export function getEvaluator(): Evaluator {
  return new RuleEvaluator()
}

export { RuleEvaluator, evaluateDoc } from './ruleEvaluator'
