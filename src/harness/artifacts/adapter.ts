import type { ArtifactKind, ArtifactProvider, RoleId } from '../types'
import { DeepSeekAdapter, type DeepSeekConfig } from '../llm/adapter'
import { getRolePreset, buildSystemPrompt } from '../roles'
import { matchTemplate } from '../scripts/artifacts'
import { useSettingsStore } from '../../stores/settingsStore'
import { buildDataContext } from '../sources/dataContext'

const KIND_LABEL: Record<ArtifactKind, string> = {
  lessonPlan: '教案（含教学目标/重难点/教学过程/板书设计/作业布置）',
  report: '分析报告（含总体情况/成效/问题/建议）',
  notice: '行政通知（含依据/安排/要求/报送方式/落款）',
  analysis: '分析报告（含总体情况/成效/问题/建议）',
  generic: '结构化文档（含背景/主要内容/结论建议）',
}

/**
 * ArtifactApiAdapter —— 真实 LLM 流式生成文档。
 * 结构化 prompt（角色 systemPrompt + 文档类型要求 + 真实数据上下文）→ streamChat 逐块 onChunk。
 * v0.8 M3：注入 buildDataContext 真实数据，文档引用具体数字时以数据上下文为准，禁止编造。
 */
export class ArtifactApiAdapter implements ArtifactProvider {
  constructor(private config: DeepSeekConfig) {}

  async generate(
    input: { role: RoleId; goal: string; kindHint?: ArtifactKind; signal?: AbortSignal },
    onChunk: (chunk: string) => void,
  ): Promise<{ title: string; kind: ArtifactKind }> {
    const kind: ArtifactKind = input.kindHint ?? matchTemplate(input.goal, input.role).kind
    const preset = getRolePreset(input.role)
    const fallbackTitle = matchTemplate(input.goal, input.role).title(input.goal)

    const system =
      `${buildSystemPrompt(preset, useSettingsStore.getState().preferences)}\n\n` +
      `你现在直接产出一份完整的 Markdown 文档，要求：\n` +
      `1. 首行为「# 文档标题」；\n` +
      `2. 文档类型：${KIND_LABEL[kind]}；\n` +
      `3. 直接输出 Markdown 正文，不要代码块包裹，不要任何解释性前后缀；\n` +
      `4. 内容具体可落地，结构完整，语言符合角色身份。`

    // v0.8 M3：聚合真实数据上下文（内部容错，失败返回空串则跳过数据段）
    const dataText = await buildDataContext(input.role)
    const dataSection = dataText
      ? `\n\n【真实数据上下文】（引用具体数字必须以此为准并注明来源，禁止编造）\n${dataText}`
      : ''
    const user = `请围绕以下目标产出文档：${input.goal}${dataSection}`

    const llm = new DeepSeekAdapter(this.config)
    let full = ''
    for await (const delta of llm.streamChat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      input.signal,
    )) {
      full += delta
      onChunk(delta)
    }

    // 标题：优先取正文首个一级标题，否则回退模板标题
    const m = full.match(/^#\s+(.+)$/m)
    const title = m?.[1]?.trim() || fallbackTitle
    return { title, kind }
  }
}
