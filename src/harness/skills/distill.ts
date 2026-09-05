import type { AgentTraceEvent, RoleId } from '../types'
import type { ScriptStep } from '../scripts/agent'
import type { Skill } from './types'
import { MAX_TRIGGERS } from './types'

/** 提炼结果：evolved=true 表示合并进已有技能（版本+1），false 表示全新技能 */
export interface DistillResult {
  skill: Skill
  evolved: boolean
}

/* ---------- 触发词提取（确定性，v0.6 M1③） ---------- */

/** 前缀剥离表：称谓/客套 → 动词 → 量词，循环剥离直到无变化 */
const STRIP_PREFIX = [
  '请帮我', '帮我', '麻烦你', '麻烦', '请你', '请', '我想', '我要', '我需要', '我打算', '我',
  '帮忙', '给我', '再', '先', '来', '把', '给', '帮',
]
const STRIP_VERB = [
  '整理', '生成', '撰写', '起草', '制定', '拟定', '编写', '汇总', '分析', '统计', '查询', '查',
  '准备', '安排', '设计', '规划', '产出', '输出', '完成', '做', '出', '写', '弄', '搞',
]
const STRIP_QUANT = ['一份', '一个', '一组', '一套', '一份份', '一下', '一些']

/** 分段：标点 → 连接词（和/与/包含…）二级切分 */
const SEGMENT_RE = /[，。！？；、,\.;!?\n（）()【】\[\]]+/
const CONNECT_RE = /(?:和|与|及|或|以及|包含|包括|含有|含|要含|加上|还有|附)/

const TRIGGER_MIN = 2
const TRIGGER_MAX = 12
const MAX_TRIGGERS_PER_GOAL = 4

/** 寒暄/时间类停用词：不作为触发词（避免「你好」这类输入沉淀出垃圾技能） */
const STOPWORDS = new Set([
  '你好', '您好', '谢谢', '感谢', '请问', '一下', '现在', '今天', '明天', '后天', '上午', '下午',
  '我们', '你们', '他们', '这个', '那个', '什么', '怎么', '如何', '可以', '需要', '想要',
])

function stripPrefixes(seg: string): string {
  let cur = seg.trim()
  let changed = true
  while (changed && cur.length > TRIGGER_MIN) {
    changed = false
    for (const table of [STRIP_PREFIX, STRIP_VERB, STRIP_QUANT]) {
      for (const p of table) {
        if (cur.startsWith(p) && cur.length - p.length >= TRIGGER_MIN) {
          cur = cur.slice(p.length)
          changed = true
        }
      }
    }
  }
  return cur
}

/**
 * 从目标提取触发词：标点分段 → 连接词切分 → 前缀剥离 → 长度窗口过滤 → 去重取前 4。
 * 纯函数，同输入同输出（演示可重复的关键）。
 */
export function extractTriggers(goal: string): string[] {
  const out: string[] = []
  for (const seg of goal.split(SEGMENT_RE)) {
    for (const part of seg.split(CONNECT_RE)) {
      const t = stripPrefixes(part)
      if (
        t.length >= TRIGGER_MIN &&
        t.length <= TRIGGER_MAX &&
        !STOPWORDS.has(t) &&
        !out.includes(t)
      ) {
        out.push(t)
        if (out.length >= MAX_TRIGGERS_PER_GOAL) return out
      }
    }
  }
  return out
}

/* ---------- 步骤提取 ---------- */

/** 单技能步骤上限（防超长 trace 撑爆技能） */
const MAX_SKILL_STEPS = 8

/**
 * 从执行轨迹提取可复用步骤序列：plan 原样保留；tool_call 顺序保留；
 * 同组并行调用合并为 parallel 步骤；artifact_meta 映射为 artifact 步骤。
 * reflect/text/done 不沉淀（属一次性话术）。
 */
export function stepsFromTrace(events: AgentTraceEvent[]): ScriptStep[] {
  const steps: ScriptStep[] = []
  const emittedGroups = new Set<string>()
  for (const e of events) {
    if (e.kind === 'plan') {
      steps.push({ type: 'plan', steps: [...e.steps] })
      continue
    }
    if (e.kind === 'tool_call') {
      if (e.group) {
        if (emittedGroups.has(e.group)) continue
        emittedGroups.add(e.group)
        steps.push({
          type: 'parallel',
          label: '并行工具组',
          steps: events
            .filter((x): x is Extract<AgentTraceEvent, { kind: 'tool_call' }> => x.kind === 'tool_call' && x.group === e.group)
            .map((x) => ({ tool: x.tool, args: { ...x.args } })),
        })
        continue
      }
      steps.push({ type: 'tool', tool: e.tool, args: { ...e.args } })
      continue
    }
    if (e.kind === 'artifact_meta') {
      steps.push({ type: 'artifact', kind: e.docKind as 'lessonPlan' | 'report' | 'notice' | 'analysis' | 'generic' })
    }
  }
  return steps.slice(0, MAX_SKILL_STEPS)
}

/* ---------- 去重与版本进化 ---------- */

/** 触发词重叠判定：相等或互为包含（≥2 字）视为同一技能族 */
function triggersOverlap(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => x === y || (x.includes(y) && y.length >= TRIGGER_MIN) || (y.includes(x) && x.length >= TRIGGER_MIN)))
}

function skillName(goal: string, triggers: string[]): string {
  const base = triggers[0] ?? goal.slice(0, 12)
  return base.length > 14 ? base.slice(0, 14) : base
}

/**
 * 确定性提炼（v0.6 M1③）：
 * - 触发词为空或无可复用步骤（无工具/文档产出）→ 返回 null（不沉淀）
 * - 与现有学习技能触发词重叠 → 合并触发词（上限 8）并版本+1（refined 进化）
 * - 否则新建 v1 技能（created）
 */
export function distillSkill(
  goal: string,
  events: AgentTraceEvent[],
  existing: Skill[],
  role: RoleId,
  now = Date.now(),
): DistillResult | null {
  const triggers = extractTriggers(goal)
  if (triggers.length === 0) return null
  const steps = stepsFromTrace(events)
  const hasSubstance = steps.some((s) => s.type === 'tool' || s.type === 'parallel' || s.type === 'artifact')
  if (!hasSubstance) return null

  const candidates = existing.filter((s) => s.roles.includes(role) && triggersOverlap(triggers, s.triggers))
  if (candidates.length > 0) {
    // 合并到最相关（重叠触发词最多）的技能：版本+1，触发词并集截断
    const target = [...candidates].sort((a, b) => {
      const oa = triggers.filter((t) => triggersOverlap([t], a.triggers)).length
      const ob = triggers.filter((t) => triggersOverlap([t], b.triggers)).length
      return ob - oa
    })[0]
    const mergedTriggers = [...new Set([...target.triggers, ...triggers])].slice(0, MAX_TRIGGERS)
    const version = target.version + 1
    const evolved: Skill = {
      ...target,
      triggers: mergedTriggers,
      version,
      updatedAt: now,
      evolution: [...target.evolution, { at: now, version, kind: 'refined', note: `复用中扩充触发词：${triggers.join('、')}` }],
    }
    return { skill: evolved, evolved: true }
  }

  const planStep = steps.find((s) => s.type === 'plan')
  const description =
    planStep && planStep.type === 'plan'
      ? `自动沉淀：${planStep.steps.join(' → ')}`
      : `自动沉淀自任务「${goal.slice(0, 24)}」`
  const skill: Skill = {
    id: `learned-${now.toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: skillName(goal, triggers),
    description,
    roles: [role],
    triggers,
    steps,
    origin: 'learned',
    version: 1,
    enabled: true,
    stats: { usageCount: 0, successCount: 0, lastUsedAt: 0 },
    evolution: [{ at: now, version: 1, kind: 'created', note: `由任务「${goal.slice(0, 24)}」自动沉淀` }],
    createdAt: now,
    updatedAt: now,
  }
  return { skill, evolved: false }
}

/* ---------- API 模式 LLM 提炼接口（骨架，v0.6 M2③） ---------- */

/**
 * SkillDistiller —— API 模式下由 LLM 驱动的技能提炼接口。
 * v0.6 仅落地契约与 Mock 确定性实现；LLM 实现（复盘 → 结构化技能 JSON → 校验入库）留待后续版本，
 * 接入点：Orchestrator 任务完成后调用 distill（当前 no-op 返回 null）。
 */
export interface SkillDistiller {
  /** LLM 复盘执行轨迹并产出技能；未实现或提炼失败返回 null（静默跳过，不阻断任务） */
  distill(input: { goal: string; events: AgentTraceEvent[]; role: RoleId }): Promise<DistillResult | null>
}

export class LlmSkillDistiller implements SkillDistiller {
  // TODO(v0.7+): 组装复盘 prompt（goal + trace 摘要 + 现有技能清单）→ LLM 输出技能 JSON →
  // 校验（触发词/步骤合法性）→ 与现有技能去重 → 返回 DistillResult。
  async distill(): Promise<DistillResult | null> {
    return null
  }
}
