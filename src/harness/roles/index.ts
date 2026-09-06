import type { MemoryEntry, RoleId, RolePreset } from '../types'
import type { UserPreferences } from '../../stores/settingsStore'
import { TEACHER_TOOLS, SCHOOL_ADMIN_TOOLS, BUREAU_TOOLS } from '../agent/tools'
import { formatEpisodicLines, formatSemanticLines } from '../memory/format'

export const TEACHER_PRESET: RolePreset = {
  id: 'teacher',
  name: '教师',
  subtitle: '备课 · 学情 · 家校',
  description: '面向一线教师：备课教案、试题命制、学情点评、家校沟通一站式完成。',
  tools: TEACHER_TOOLS,
  accent: 'mint',
  systemPrompt:
    '你是一位 K12 一线教师的 AI 教学助手。熟悉课程标准与教材体系，擅长教案设计、试题命制、' +
    '学情分析与家校沟通。回答要具体可落地：教案给出环节与时间分配，试题标注考点与难度，' +
    '学情点评引用真实数据并给出分层建议。语言亲切专业，避免空话。',
}

export const SCHOOL_ADMIN_PRESET: RolePreset = {
  id: 'schoolAdmin',
  name: '学校管理',
  subtitle: '治理 · 预警 · 教研',
  description: '面向校长与教务：治理简报、异常预警、评课分析、会议纪要与通知起草。',
  tools: SCHOOL_ADMIN_TOOLS,
  accent: 'primary',
  systemPrompt:
    '你是一位学校管理者的 AI 治理助手。服务对象为校长、教务主任与年级组长，擅长治理简报撰写、' +
    '教学质量异常预警、评课分析与行政文书起草。回答以数据说话：引用具体班级、学科与趋势数字，' +
    '预警项明确给出证据与建议动作。语言简练、结论先行。',
}

export const BUREAU_PRESET: RolePreset = {
  id: 'bureau',
  name: '教育局',
  subtitle: '区域 · 公文 · 督导',
  description: '面向教育局科室：区域数据汇总、公文报告起草、检查评估与任务跟踪。',
  tools: BUREAU_TOOLS,
  accent: 'coral',
  systemPrompt:
    '你是一位教育局科室工作人员的 AI 公文助手。擅长区域教育数据汇总分析、公文与报告起草、' +
    '督导检查材料准备与任务跟踪。行文符合机关公文规范：结构完整、用语准确、数据可溯源，' +
    '重要结论附数据依据。避免夸饰，注重可执行性。',
}

export const ROLE_PRESETS: Record<RoleId, RolePreset> = {
  teacher: TEACHER_PRESET,
  schoolAdmin: SCHOOL_ADMIN_PRESET,
  bureau: BUREAU_PRESET,
}

export function getRolePreset(role: RoleId): RolePreset {
  return ROLE_PRESETS[role]
}

export function listRoles(): RolePreset[] {
  return [TEACHER_PRESET, SCHOOL_ADMIN_PRESET, BUREAU_PRESET]
}

/**
 * 将用户偏好画像拼接进 system prompt（v0.3 专项 ③）。
 * v0.9.1 注入 A：新增可选记忆参数（L2 情景 + L3 语义偏好，由调用方在 async 上下文 await 后传入，
 * 保持本函数同步签名）——输出段序：【场景记忆】→【用户偏好】（用户画像行与语义偏好合并同段）。
 * 无偏好且无记忆时逐字节返回 preset.systemPrompt（回归基线不变）；
 * Mock 剧本模式不受影响（剧本驱动，不走此注入，改用 reflect 事件展示注入内容）。
 */
export function buildSystemPrompt(
  preset: RolePreset,
  p?: UserPreferences,
  memory?: { episodic: MemoryEntry[]; semantic: MemoryEntry[] },
): string {
  const sections: string[] = []
  const epiLines = memory ? formatEpisodicLines(memory.episodic) : []
  if (epiLines.length) sections.push(`【场景记忆】\n${epiLines.map((l) => `- ${l}`).join('\n')}`)
  const lines = [
    p?.nickname.trim() && `用户称呼：${p.nickname.trim()}，回复时自然使用该称呼。`,
    p?.stage.trim() && `用户背景：${p.stage.trim()}。`,
    p?.style.trim() && `表达偏好：${p.style.trim()}。`,
    ...(memory ? formatSemanticLines(memory.semantic) : []),
  ].filter(Boolean) as string[]
  if (lines.length) sections.push(`【用户偏好】\n${lines.join('\n')}`)
  return sections.length ? `${preset.systemPrompt}\n\n${sections.join('\n\n')}` : preset.systemPrompt
}
