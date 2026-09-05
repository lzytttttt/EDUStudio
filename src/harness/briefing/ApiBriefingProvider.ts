/**
 * ApiBriefingProvider —— LLM 结构化生成简报卡组（v0.7 骨架 → v0.8 数据驱动）
 *
 * 流程：角色 systemPrompt + 上下文（真实数据/历史决策/收藏）→ LLM 输出 JSON 卡片数组
 * → extractJsonArray 提取 → validateBriefingCard 逐卡校验（非法丢弃）。
 * 解析/校验失败自动重试一次（共两次尝试，每次 12s 超时）；仍失败 → 回退 MockBriefingProvider。
 *
 * v0.8 M2：注入 buildDataContext 真实数据上下文，卡片数据必须来自上下文，禁止编造。
 * 同步 getDeck 始终返回 Mock（契约兜底）；异步 getDeckAsync 才走 LLM。
 */
import type { BriefingCard, BriefingGenContext, BriefingProvider, RoleId } from '../types'
import { DeepSeekAdapter, type DeepSeekConfig } from '../llm/adapter'
import { getRolePreset, buildSystemPrompt } from '../roles'
import { useSettingsStore } from '../../stores/settingsStore'
import { buildDataContext } from '../sources/dataContext'
import { MockBriefingProvider } from './MockBriefingProvider'
import { extractJsonArray, validateBriefingCard } from './validate'

const TIMEOUT_MS = 12_000
/** 解析/校验失败后的最大尝试次数（含首次） */
const MAX_ATTEMPTS = 2

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
要求：生成 5-7 张卡片，类型多样，至少 2 张带 payload；决策类卡片给出 action；内容贴合角色身份与下方上下文，数据具体不虚构来源。`

/** 组装 user prompt：角色/日期 + 历史决策/收藏 + 真实数据上下文（导出供单测） */
export function composeBriefingUser(role: RoleId, ctx?: BriefingGenContext, dataText = ''): string {
  const preset = getRolePreset(role)
  const lines = [
    `角色：${preset.name}（${preset.subtitle}）`,
    `日期：${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}`,
  ]
  if (dataText) {
    lines.push(
      `【真实数据上下文】（卡片中的具体数字必须来自此处或历史决策，禁止编造；来源标注进 source 字段）\n${dataText}`,
    )
  } else {
    lines.push('【真实数据上下文】暂无可用数据：请使用定性描述，不要给出具体数字。')
  }
  if (ctx) {
    const counts = { skip: 0, fav: 0, accept: 0 } as Record<string, number>
    for (const d of Object.values(ctx.decisions)) counts[d] = (counts[d] ?? 0) + 1
    lines.push(`历史决策：跳过 ${counts.skip ?? 0} 张、收藏 ${counts.fav ?? 0} 张、采纳 ${counts.accept ?? 0} 张（跳过较多的主题请降低优先级或换角度）`)
    if (ctx.favorites.length) {
      lines.push(`收藏过的卡片（用户兴趣，可生成关联跟进卡）：${ctx.favorites.slice(0, 5).map((f) => `《${f.title}》`).join('、')}`)
    }
  }
  return lines.join('\n')
}

export class ApiBriefingProvider implements BriefingProvider {
  private mock = new MockBriefingProvider()

  constructor(private config: DeepSeekConfig) {}

  /** 同步契约兜底：始终返回 Mock 剧本（个性化排序） */
  getDeck(role: RoleId, ctx?: BriefingGenContext): BriefingCard[] {
    return this.mock.getDeck(role, ctx)
  }

  /** 异步生成：LLM 结构化输出 → 逐卡校验；两次尝试仍失败回退 Mock */
  async getDeckAsync(role: RoleId, ctx?: BriefingGenContext): Promise<BriefingCard[]> {
    // v0.8 M2：先聚合真实数据上下文（buildDataContext 内部容错，失败返回空串）
    const dataText = await buildDataContext(role)
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const cards = await this.attempt(role, ctx, dataText)
      if (cards) return cards
      if (attempt < MAX_ATTEMPTS) console.warn(`[briefing] 第 ${attempt} 次生成失败，重试…`)
    }
    console.warn('[briefing] API 生成两次尝试均失败，回退 Mock 剧本')
    return this.mock.getDeck(role, ctx)
  }

  /** 单次尝试：LLM 流式输出 → JSON 提取 → 逐卡校验；任一环节失败返回 null */
  private async attempt(role: RoleId, ctx: BriefingGenContext | undefined, dataText: string): Promise<BriefingCard[] | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const preset = getRolePreset(role)
      const system = `${buildSystemPrompt(preset, useSettingsStore.getState().preferences)}\n\n${CARD_SCHEMA_PROMPT}`
      const user = composeBriefingUser(role, ctx, dataText)

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
