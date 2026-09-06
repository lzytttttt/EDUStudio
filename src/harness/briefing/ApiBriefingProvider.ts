/**
 * ApiBriefingProvider —— LLM 结构化生成简报卡组（v0.7 骨架 → v0.8 数据驱动）
 *
 * 流程：角色 systemPrompt + 上下文（真实数据/历史决策/收藏）→ LLM 输出 JSON 卡片数组
 * → extractJsonArray 提取 → validateBriefingCard 逐卡校验（非法丢弃）。
 * 解析/校验失败自动重试一次（共两次尝试，每次 12s 超时）；仍失败 → 回退 MockBriefingProvider。
 *
 * v0.8 M2：注入 buildDataContext 真实数据上下文，卡片数据必须来自上下文，禁止编造。
 * 同步 getDeck 始终返回 Mock（契约兜底）；异步 getDeckAsync 才走 LLM。
 *
 * v0.8.4：支持 BriefingGenOptions 重新生成选项——自定义提示词/种类约束/数量/风格/payload 要求/
 * 参考资料段落开关注入 prompt；超时与重试次数参数化（clamp 护栏）。
 */
import type { BriefingCard, BriefingGenContext, BriefingGenOptions, BriefingProvider, CardType, RoleId } from '../types'
import { DeepSeekAdapter, type DeepSeekConfig } from '../llm/adapter'
import { getRolePreset, buildSystemPrompt } from '../roles'
import { useSettingsStore } from '../../stores/settingsStore'
import { buildDocAttachments } from '../../stores/dataStore'
import { buildDataContext } from '../sources/dataContext'
import { MockBriefingProvider } from './MockBriefingProvider'
import { extractJsonArray, validateBriefingCard } from './validate'

const TIMEOUT_MS = 12_000
/** 解析/校验失败后的最大尝试次数（含首次） */
const MAX_ATTEMPTS = 2

/* ---------- 重新生成选项 clamp 边界（v0.8.4，导出供单测与弹窗复用） ---------- */

/** 自定义提示词限长（防 prompt 超长） */
export const GEN_PROMPT_MAX_LEN = 200
/** 单次尝试超时边界（ms） */
export const GEN_TIMEOUT = { min: 6000, max: 30000, default: TIMEOUT_MS } as const
/** 最大尝试次数边界（含首次） */
export const GEN_ATTEMPTS = { min: 1, max: 3, default: MAX_ATTEMPTS } as const
/** 卡片数量边界 */
export const GEN_COUNT = { min: 3, max: 10 } as const

/** 超时 clamp：非法/缺省回退默认 12s */
export function clampGenTimeout(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return GEN_TIMEOUT.default
  return Math.min(GEN_TIMEOUT.max, Math.max(GEN_TIMEOUT.min, Math.round(v)))
}

/** 重试次数 clamp：非法/缺省回退默认 2 次 */
export function clampGenAttempts(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return GEN_ATTEMPTS.default
  return Math.min(GEN_ATTEMPTS.max, Math.max(GEN_ATTEMPTS.min, Math.round(v)))
}

/** 卡片数量 clamp：非法/缺省返回 undefined（= 默认 5-7） */
export function clampGenCount(v: number | undefined): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.min(GEN_COUNT.max, Math.max(GEN_COUNT.min, Math.round(v)))
}

/** 提示词 clamp：去首尾空白 + 截断 200 字 */
export function clampGenPrompt(v: string | undefined): string {
  return (v ?? '').trim().slice(0, GEN_PROMPT_MAX_LEN)
}

const CARD_SCHEMA_PROMPT = `你现在为用户生成「今日简报」卡片组。只输出一个 JSON 数组，不要代码块包裹、不要任何解释文字。
每张卡片结构：
{"id":"ai-1","type":"insight|decision|creation|todo|data|question","tag":"2-4字标签","title":"一句话标题(≤40字)","body":"2-3句说明，引用具体数据","confidence":1|2|3,"source":"来源 · 时间",
 "payload":可选,"action":可选{"kind":"openTask","goal":"采纳后执行的任务目标"},"link":可选{"kind":"source|task|favorite","label":"跳转文案"}}
payload 按 kind：
- chart: {"kind":"chart","title":"图表标题","bars":[{"label":"≤4字","value":数字,"display":"61%","peak":true}]}
- options: {"kind":"options","options":[{"text":"选项","sub":"说明"}]}
- editable: {"kind":"editable","text":"可编辑正文"}
- todos: {"kind":"todos","todos":[{"text":"事项","meta":"截止时间","done":false}]}
- expandable: {"kind":"expandable","title":"展开标题","content":"正文，可用<br>换行"}
要求：决策类卡片给出 action；内容贴合角色身份与下方上下文，数据具体不虚构来源。`

/** 全部卡片种类（v0.8.4）：种类约束判断「全选 = 不限」用 */
const ALL_CARD_TYPES: CardType[] = ['insight', 'decision', 'creation', 'todo', 'data', 'question']

/**
 * 组装生成约束段（v0.8.4）：数量/种类/风格/payload 按 options 动态拼装（导出供单测）。
 * 缺省 options = 既有默认（5-7 张、类型多样、至少 2 张带 payload）。
 */
export function composeGenConstraints(options?: BriefingGenOptions): string {
  const parts: string[] = []
  const count = clampGenCount(options?.count)
  parts.push(count ? `生成 ${count} 张卡片` : '生成 5-7 张卡片')

  const types = options?.types?.filter((t) => ALL_CARD_TYPES.includes(t))
  if (types && types.length > 0 && types.length < ALL_CARD_TYPES.length) {
    parts.push(`卡片类型仅限：${types.join('|')}`)
  } else {
    parts.push('类型多样')
  }

  const p = options?.payloads
  const kinds = [p?.chart !== false && 'chart', p?.options !== false && 'options', p?.todos !== false && 'todos'].filter(
    (k): k is string => Boolean(k),
  )
  if (kinds.length === 3) {
    parts.push('至少 2 张带 payload')
  } else if (kinds.length === 0) {
    parts.push('不要使用 payload（全部为纯文本卡）')
  } else {
    parts.push(`payload 仅限 ${kinds.join('/')} 类型，至少 1 张带 payload`)
  }

  const style = options?.style
  if (style === 'concise') parts.push('风格：简洁扼要，每张 body 1-2 句')
  else if (style === 'detailed') parts.push('风格：详细展开，每张 body 3-4 句并给出可执行细节')
  else if (style === 'data') parts.push('风格：数据导向，优先引用具体数字与环比对比')

  return parts.join('；') + '。'
}

/** 组装 user prompt：角色/日期 + 真实数据上下文 + 历史决策/收藏 + 自定义要求（导出供单测）。
 *  v0.8.4：options.references 控制三段参考资料开关；options.prompt 注入【自定义要求】（≤200 字）
 *  v0.9 M6②：docText 非空时注入【导入文档材料】（附件直通上下文，卡片可引用） */
export function composeBriefingUser(
  role: RoleId,
  ctx?: BriefingGenContext,
  dataText = '',
  options?: BriefingGenOptions,
  docText = '',
): string {
  const preset = getRolePreset(role)
  const refs = options?.references
  const lines = [
    `角色：${preset.name}（${preset.subtitle}）`,
    `日期：${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}`,
  ]
  if (refs?.dataContext !== false) {
    if (dataText) {
      lines.push(
        `【真实数据上下文】（卡片中的具体数字必须来自此处或历史决策，禁止编造；来源标注进 source 字段）\n${dataText}`,
      )
    } else {
      lines.push('【真实数据上下文】暂无可用数据：请使用定性描述，不要给出具体数字。')
    }
  }
  if (ctx && refs?.decisions !== false) {
    const counts = { skip: 0, fav: 0, accept: 0 } as Record<string, number>
    for (const d of Object.values(ctx.decisions)) counts[d] = (counts[d] ?? 0) + 1
    lines.push(`历史决策：跳过 ${counts.skip ?? 0} 张、收藏 ${counts.fav ?? 0} 张、采纳 ${counts.accept ?? 0} 张（跳过较多的主题请降低优先级或换角度）`)
  }
  if (ctx && refs?.favorites !== false && ctx.favorites.length) {
    lines.push(`收藏过的卡片（用户兴趣，可生成关联跟进卡）：${ctx.favorites.slice(0, 5).map((f) => `《${f.title}》`).join('、')}`)
  }
  const prompt = clampGenPrompt(options?.prompt)
  if (prompt) lines.push(`【自定义要求】（用户本次生成偏好，优先级高于默认要求）\n${prompt}`)
  if (docText) lines.push(`【导入文档材料】（用户导入的文档与说明，卡片内容可引用，禁止编造文档中不存在的数据）\n${docText}`)
  return lines.join('\n')
}

export class ApiBriefingProvider implements BriefingProvider {
  private mock = new MockBriefingProvider()

  constructor(private config: DeepSeekConfig) {}

  /** 同步契约兜底：始终返回 Mock 剧本（个性化排序） */
  getDeck(role: RoleId, ctx?: BriefingGenContext): BriefingCard[] {
    return this.mock.getDeck(role, ctx)
  }

  /** 异步生成：LLM 结构化输出 → 逐卡校验；重试次数可调（v0.8.4），仍失败回退 Mock（透传 options 保持种类过滤） */
  async getDeckAsync(role: RoleId, ctx?: BriefingGenContext, options?: BriefingGenOptions): Promise<BriefingCard[]> {
    // v0.8 M2：先聚合真实数据上下文（buildDataContext 内部容错，失败返回空串）；v0.8.4 参考资料开关关闭时跳过取数
    const dataText = options?.references?.dataContext === false ? '' : await buildDataContext(role)
    const maxAttempts = clampGenAttempts(options?.maxAttempts)
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const cards = await this.attempt(role, ctx, dataText, options)
      if (cards) return cards
      if (attempt < maxAttempts) console.warn(`[briefing] 第 ${attempt} 次生成失败，重试…`)
    }
    console.warn('[briefing] API 生成全部尝试均失败，回退 Mock 剧本')
    return this.mock.getDeck(role, ctx, options)
  }

  /** 单次尝试：LLM 流式输出 → JSON 提取 → 逐卡校验；任一环节失败返回 null（超时可调，v0.8.4） */
  private async attempt(
    role: RoleId,
    ctx: BriefingGenContext | undefined,
    dataText: string,
    options?: BriefingGenOptions,
  ): Promise<BriefingCard[] | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), clampGenTimeout(options?.timeoutMs))
    try {
      const preset = getRolePreset(role)
      const system = `${buildSystemPrompt(preset, useSettingsStore.getState().preferences)}\n\n${CARD_SCHEMA_PROMPT}\n\n${composeGenConstraints(options)}`
      // v0.9 M6②：导入文档附件注入（ApiBriefingProvider 仅 API 模式运行；Mock 剧本不消费）
      const docText = buildDocAttachments(role)
      const user = composeBriefingUser(role, ctx, dataText, options, docText)

      const llm = new DeepSeekAdapter(this.config)
      let full = ''
      for await (const delta of llm.streamChat(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        controller.signal,
      )) {
        full += delta
      }

      const arr = extractJsonArray(full)
      if (!arr) throw new Error('输出中未找到 JSON 卡片数组')
      const cards = arr
        .map((raw, i) => {
          const card = validateBriefingCard(raw, role)
          if (!card) console.warn(`[briefing] 第 ${i + 1} 张卡片校验失败，已丢弃`)
          return card
        })
        .filter((c): c is BriefingCard => c !== null)
      if (cards.length === 0) throw new Error('校验后无有效卡片')
      console.info(`[briefing] API 生成 ${cards.length}/${arr.length} 张卡片`)
      return cards
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[briefing] 本次尝试失败：${msg.slice(0, 120)}`)
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}
