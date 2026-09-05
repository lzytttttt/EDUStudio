import type { AgentTraceEvent, RoleId } from '../types'
import type { ScriptStep } from '../scripts/agent'
import type { Skill } from './types'
import { MAX_TRIGGERS } from './types'
import { DeepSeekAdapter } from '../llm/adapter'
import { useSkillStore } from '../../stores/skillStore'

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

/* ---------- API 模式 LLM 提炼（v0.8 M4 落地） ---------- */

/**
 * SkillDistiller —— API 模式下由 LLM 驱动的技能提炼接口。
 * LLM 复盘执行轨迹 → 结构化技能 JSON → 校验 → 与现有技能去重（进化/新建）。
 */
export interface SkillDistiller {
  /** LLM 复盘执行轨迹并产出技能；提炼失败返回 null（静默跳过，不阻断任务） */
  distill(input: { goal: string; events: AgentTraceEvent[]; role: RoleId }): Promise<DistillResult | null>
}

/** 提炼超时护栏：任务已完成，提炼不应拖住会话太久 */
const DISTILL_TIMEOUT_MS = 10_000
/** trace 摘要事件上限（控制 token 成本） */
const MAX_TRACE_LINES = 40

/**
 * trace 摘要：仅保留可沉淀事件（plan/tool_call/tool_result/artifact_meta），
 * text/done/reflect 属一次性话术不进入复盘。导出供单测。
 */
export function summarizeTrace(events: AgentTraceEvent[]): string {
  const lines: string[] = []
  for (const e of events) {
    if (e.kind === 'plan') {
      lines.push(`plan: ${e.steps.join(' → ')}`)
    } else if (e.kind === 'tool_call') {
      lines.push(`tool: ${e.tool} ${JSON.stringify(e.args).slice(0, 120)}`)
    } else if (e.kind === 'tool_result') {
      lines.push(`result: ${e.summary.slice(0, 120)}`)
    } else if (e.kind === 'artifact_meta') {
      lines.push(`artifact: ${e.docKind}《${e.title}》`)
    }
  }
  return lines.slice(0, MAX_TRACE_LINES).join('\n')
}

const SKILL_SCHEMA_PROMPT = `你是智能体技能提炼器。复盘一次任务执行轨迹，判断是否沉淀出可复用技能。
只输出一个 JSON 对象（禁止 markdown 代码块与任何解释文字），格式：
{"action":"create|evolve|none","name":"技能名(≤14字)","description":"一句话说明","triggers":["触发词"],"steps":[{"type":"tool","tool":"工具名","args":{}}]}
规则：
- 轨迹中没有工具调用或文档产出（纯寒暄/纯文字回答）→ {"action":"none"}
- 能力与「现有技能」重叠（触发词语义相近）→ action=evolve，系统会自动合并触发词并版本+1
- 全新可复用能力 → action=create
- triggers：2-12 字的名词短语，≤8 个，来自任务目标关键词
- steps：2~6 步，type 仅限 tool/text/artifact；工具名必须来自轨迹中出现过的工具；artifact 的 kind 取 lessonPlan|report|notice|analysis|generic`

/** 从模型输出提取技能 JSON（容忍代码块包裹与前后噪声） */
function extractSkillJson(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null
  const cleaned = text.replace(/```(?:json)?/g, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 校验后的技能候选 */
export interface SkillCandidate {
  name: string
  description: string
  triggers: string[]
  steps: ScriptStep[]
}

const ARTIFACT_KINDS = ['lessonPlan', 'report', 'notice', 'analysis', 'generic']

/**
 * 校验 LLM 技能 JSON（纯函数，导出供单测）：
 * - name/triggers 必须有效（触发词 2-12 字、去重、≤8）
 * - steps 仅保留合法类型（tool/text/artifact），无实质步骤（无 tool/artifact）→ null
 */
export function validateSkillCandidate(raw: unknown): SkillCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, 14) : ''
  const description = typeof obj.description === 'string' ? obj.description.trim().slice(0, 80) : ''
  const rawTriggers = Array.isArray(obj.triggers) ? obj.triggers : []
  const triggers: string[] = []
  for (const t of rawTriggers) {
    if (typeof t !== 'string') continue
    const trimmed = t.trim()
    if (trimmed.length >= TRIGGER_MIN && trimmed.length <= TRIGGER_MAX && !triggers.includes(trimmed)) {
      triggers.push(trimmed)
    }
    if (triggers.length >= MAX_TRIGGERS) break
  }
  if (!name || triggers.length === 0) return null

  const rawSteps = Array.isArray(obj.steps) ? obj.steps : []
  const steps: ScriptStep[] = []
  for (const s of rawSteps.slice(0, MAX_SKILL_STEPS)) {
    if (!s || typeof s !== 'object') continue
    const st = s as Record<string, unknown>
    if (st.type === 'tool' && typeof st.tool === 'string' && st.tool.trim()) {
      steps.push({ type: 'tool', tool: st.tool.trim(), args: (st.args as Record<string, unknown>) ?? {} })
    } else if (st.type === 'text' && typeof st.text === 'string' && st.text.trim()) {
      steps.push({ type: 'text', text: st.text })
    } else if (st.type === 'artifact' && typeof st.kind === 'string') {
      const kind = ARTIFACT_KINDS.includes(st.kind) ? st.kind : 'generic'
      steps.push({ type: 'artifact', kind: kind as 'lessonPlan' | 'report' | 'notice' | 'analysis' | 'generic' })
    }
  }
  const hasSubstance = steps.some((s) => s.type === 'tool' || s.type === 'artifact')
  if (!hasSubstance) return null
  return { name, description: description || `LLM 沉淀：${name}`, triggers, steps }
}

/**
 * 候选 → DistillResult（纯函数，导出供单测）：
 * 与现有学习技能触发词重叠 → 合并进最相关技能（版本+1，触发词并集截断，保留原步骤）；
 * 否则新建 v1 技能。无可合并且候选无效时返回 null。
 */
export function mergeSkillCandidate(
  cand: SkillCandidate,
  existing: Skill[],
  role: RoleId,
  now = Date.now(),
): DistillResult | null {
  const candidates = existing.filter((s) => s.roles.includes(role) && triggersOverlap(cand.triggers, s.triggers))
  if (candidates.length > 0) {
    const target = [...candidates].sort((a, b) => {
      const oa = cand.triggers.filter((t) => triggersOverlap([t], a.triggers)).length
      const ob = cand.triggers.filter((t) => triggersOverlap([t], b.triggers)).length
      return ob - oa
    })[0]
    const mergedTriggers = [...new Set([...target.triggers, ...cand.triggers])].slice(0, MAX_TRIGGERS)
    const version = target.version + 1
    const evolved: Skill = {
      ...target,
      triggers: mergedTriggers,
      version,
      updatedAt: now,
      evolution: [
        ...target.evolution,
        { at: now, version, kind: 'refined', note: `LLM 复盘扩充触发词：${cand.triggers.join('、')}` },
      ],
    }
    return { skill: evolved, evolved: true }
  }

  const skill: Skill = {
    id: `learned-${now.toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: cand.name,
    description: cand.description,
    roles: [role],
    triggers: cand.triggers,
    steps: cand.steps,
    origin: 'learned',
    version: 1,
    enabled: true,
    stats: { usageCount: 0, successCount: 0, lastUsedAt: 0 },
    evolution: [{ at: now, version: 1, kind: 'created', note: `LLM 复盘任务轨迹自动沉淀` }],
    createdAt: now,
    updatedAt: now,
  }
  return { skill, evolved: false }
}

/** LLM 驱动的技能提炼（v0.8 M4）：复盘 → 技能 JSON → 校验 → 去重进化；失败静默 null */
export class LlmSkillDistiller implements SkillDistiller {
  constructor(private llm: DeepSeekAdapter) {}

  async distill(input: { goal: string; events: AgentTraceEvent[]; role: RoleId }): Promise<DistillResult | null> {
    try {
      const trace = summarizeTrace(input.events)
      if (!trace) return null
      const existing = useSkillStore.getState().learned.filter((s) => s.roles.includes(input.role))
      const skillList =
        existing.map((s) => `- ${s.name}（v${s.version}）：${s.triggers.join('、')}`).join('\n') || '（暂无）'

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), DISTILL_TIMEOUT_MS)
      let full = ''
      try {
        for await (const delta of this.llm.streamChat(
          [
            { role: 'system', content: SKILL_SCHEMA_PROMPT },
            {
              role: 'user',
              content: `任务目标：${input.goal}\n\n执行轨迹：\n${trace}\n\n现有技能：\n${skillList}`,
            },
          ],
          controller.signal,
        )) {
          full += delta
        }
      } finally {
        clearTimeout(timer)
      }

      const obj = extractSkillJson(full)
      if (!obj || obj.action === 'none') return null
      const cand = validateSkillCandidate(obj)
      if (!cand) return null
      return mergeSkillCandidate(cand, existing, input.role)
    } catch (err) {
      console.warn('[distill] LLM 技能提炼失败（静默跳过）：', (err as Error)?.message ?? String(err))
      return null
    }
  }
}
