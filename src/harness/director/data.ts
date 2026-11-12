/**
 * Director 原型演示数据（Mock，全部来自 seed 锚点）
 *
 * 数字口径（与 doc/v1.0-roadmap.md 附录 C 对齐）：
 * - 82.4 / 78.6 / 80.2 = 高一（3）班物理 / 数学 / 化学的「均分」；
 * - 93% = 作业完成率；86 = 课堂专注度；61% = 函数单调性判定掌握率；
 * - 82.4 不是「班级均分」；t8 旧文案的 +1.8 与 seed 的 +2.1 冲突，本原型统一 +2.1。
 */
import type {
  AgentProfile,
  ArtifactTile,
  DecisionItem,
  DirectorAgentId,
  GuideStep,
  MissionPlanTask,
} from '../director/types'

export const AGENTS: AgentProfile[] = [
  {
    id: 'chief',
    name: '总指挥',
    role: '编排',
    tone: 'primary',
    expertise: ['拆解', '校验'],
    autonomy: 'L2',
    stats: { done: 18, rate: 94 },
    boundary: '不写正文、不报数字，只做拆解、分派与交叉校验。',
  },
  {
    id: 'analyst',
    name: '学情分析师',
    role: '数据',
    tone: 'mint',
    expertise: ['学情', '溯源'],
    autonomy: 'L2',
    stats: { done: 12, rate: 96 },
    boundary: '唯一有权说数字的成员；不出题、不写家长信。',
  },
  {
    id: 'assessor',
    name: '命题官',
    role: '命题',
    tone: 'primary',
    expertise: ['分层', '难度'],
    autonomy: 'L2',
    stats: { done: 9, rate: 92 },
    boundary: '只消费学情诊断，不自造薄弱点、不超纲。',
  },
  {
    id: 'curriculum',
    name: '备课研究员',
    role: '设计',
    tone: 'amber',
    expertise: ['教案', '跨学科'],
    autonomy: 'L2',
    stats: { done: 7, rate: 90 },
    boundary: '创意必须落课标；不碰真实成绩数字。',
  },
  {
    id: 'communicator',
    name: '家校沟通官',
    role: '沟通',
    tone: 'coral',
    expertise: ['语气', '合规'],
    autonomy: 'L1',
    stats: { done: 6, rate: 88 },
    boundary: '对外发送永远需要你签字；不承诺、不贴标签。',
  },
  {
    id: 'steward',
    name: '班务管家',
    role: '事务',
    tone: 'graphite',
    expertise: ['回执', '日程'],
    autonomy: 'L3',
    stats: { done: 11, rate: 97 },
    boundary: '只处理可核对事务；不做学业评价、不给处分建议。',
  },
]

export const AGENT_MAP: Record<DirectorAgentId, AgentProfile> = AGENTS.reduce(
  (acc, agent) => ({ ...acc, [agent.id]: agent }),
  {} as Record<DirectorAgentId, AgentProfile>,
)

/** 战情台初始决策卡（3 张：已备好 / 待发送 / 需要拍板） */
export const INITIAL_DECISIONS: DecisionItem[] = [
  {
    id: 'd-drill',
    agentId: 'analyst',
    kind: 'prepared',
    title: '分层练习已备好',
    subtitle: '函数单调性 · 掌握率 61%',
    readiness: 92,
    minutes: 2,
    tag: '学情',
    status: 'new',
    primaryLabel: '采纳',
    preview: {
      rows: [
        { label: '学情', value: '物理 82.4 · 数学 78.6 · 化学 80.2' },
        { label: '分层', value: '基础 70% · 提高 30%' },
        { label: '题量', value: '12 题 · 约 25 分钟' },
      ],
      note: '依据：单元考数据（86 专注度 · 93% 作业完成率）',
    },
  },
  {
    id: 'd-letters',
    agentId: 'communicator',
    kind: 'approve',
    title: '3 封家长信待发送',
    subtitle: '今天 18:00 前',
    readiness: 100,
    minutes: 1,
    tag: '家校',
    status: 'new',
    primaryLabel: '发送',
    preview: {
      rows: [
        { label: '收件人', value: '3 位家长' },
        { label: '语气', value: '进步 / 临界 / 退步' },
        { label: '校验', value: '数字已核对 · 无承诺词' },
      ],
      note: '对外发送需要你签字；发送后仅登记，演示不会真实外发。',
    },
  },
  {
    id: 'd-conflict',
    agentId: 'chief',
    kind: 'conflict',
    title: '1 处数字口径待拍板',
    subtitle: '「班级均分 82.4」',
    readiness: 100,
    minutes: 1,
    tag: '校验',
    status: 'new',
    primaryLabel: '裁决',
    preview: {
      rows: [
        { label: '发现', value: '82.4 是物理均分，不是班级均分' },
        { label: '来源', value: '学情库 · 高一（3）班 · 单元考' },
      ],
      note: '选一个口径，战队会同步到发言稿、家长信与简报。',
    },
    conflict: {
      question: '82.4 应该怎么表述？',
      options: [
        { id: 'subject', label: '物理均分 82.4', detail: '较上次 +2.1 · 与溯源一致（推荐）' },
        { id: 'class', label: '三科均分 80.4', detail: '由 82.4/78.6/80.2 计算 · 标注派生值' },
      ],
    },
  },
]

/** 一句话委托 → 作战计划（5 个环节 / 3 位执行成员 / 2 次拍板） */
export const MISSION_PLAN: MissionPlanTask[] = [
  { id: 't1', agentId: 'analyst', title: '核对学情与名单', seconds: 40 },
  { id: 't2', agentId: 'curriculum', title: '起草发言稿 + PPT 大纲', seconds: 90 },
  { id: 't3', agentId: 'communicator', title: '写 3 封家长信', seconds: 90 },
  { id: 't4', agentId: 'communicator', title: '安抚信沟通要点', seconds: 40 },
  { id: 't5', agentId: 'chief', title: '汇总与三道校验', seconds: 30 },
]

interface ScriptFeed {
  kind: 'feed'
  agentId: DirectorAgentId
  text: string
  after: number
  task?: string
  progress: number
}
interface ScriptGate {
  kind: 'gate'
  agentId: DirectorAgentId
  text: string
  after: number
  gate: 'speech' | 'letters'
  progress: number
}
interface ScriptDone {
  kind: 'done'
  text: string
  after: number
  progress: 100
}
export type MissionScriptEvent = ScriptFeed | ScriptGate | ScriptDone

/** 演示加速版时间线：真实约 8 分钟压缩到 ~9 秒 */
export const MISSION_SCRIPT: MissionScriptEvent[] = [
  { kind: 'feed', agentId: 'analyst', text: '核对了月考数据', after: 700, task: 't1', progress: 12 },
  { kind: 'feed', agentId: 'analyst', text: '标出 1 处数字口径', after: 600, progress: 20 },
  { kind: 'feed', agentId: 'curriculum', text: '发言稿起草完成', after: 800, task: 't2', progress: 34 },
  { kind: 'feed', agentId: 'curriculum', text: 'PPT 大纲 8 页', after: 500, progress: 42 },
  { kind: 'gate', agentId: 'chief', text: '发言稿待你过目', after: 600, gate: 'speech', progress: 46 },
  { kind: 'feed', agentId: 'communicator', text: '3 封信已起草', after: 800, task: 't3', progress: 60 },
  { kind: 'feed', agentId: 'communicator', text: '安抚信要点完成', after: 500, task: 't4', progress: 68 },
  { kind: 'gate', agentId: 'chief', text: '3 封信待你发送', after: 600, gate: 'letters', progress: 72 },
  { kind: 'feed', agentId: 'chief', text: '三道路径校验完成', after: 700, progress: 84 },
  { kind: 'feed', agentId: 'chief', text: '作战包已生成', after: 600, task: 't5', progress: 92 },
  { kind: 'done', text: '作战包已交付', after: 500, progress: 100 },
]

/** 作战包（4 个交付物；数字锚点与 seed 一致） */
export const ARTIFACTS: ArtifactTile[] = [
  {
    id: 'a-brief',
    title: '学情简报',
    kind: '简报',
    owner: 'analyst',
    markdown:
      '# 高一（3）班 · 学情简报\n\n' +
      '- 物理 **82.4**（较上次 +2.1）{{82.4~学情库 · 单元考}}\n' +
      '- 数学 **78.6**（-1.4）· 化学 **80.2**（+0.8）\n' +
      '- 作业完成率 **93%** · 课堂专注度 **86**\n\n' +
      '## 薄弱点\n\n函数单调性判定（掌握率 **61%**）{{61%~近14天测验}}\n\n' +
      '> 结论：本周一节习题课，基础 70% + 提高 30%。',
  },
  {
    id: 'a-speech',
    title: '家长会发言稿',
    kind: '讲稿',
    owner: 'curriculum',
    markdown:
      '# 家长会发言稿（节选）\n\n' +
      '各位家长，晚上好。今天我不谈排名，只谈三件具体的事。\n\n' +
      '## 一、整体情况\n\n' +
      '本次单元考物理均分 **82.4**，较上次 **+2.1**；班级作业完成率 **93%**。\n\n' +
      '## 二、进步亮点\n\n' +
      '课堂专注度 **86**，高于年级均值；函数单调性仍有 **61%** 的掌握缺口。\n\n' +
      '## 三、家校配合\n\n' +
      '每天晚上留 15 分钟复盘一道错题；本周内我会发一份分层练习。',
  },
  {
    id: 'a-ppt',
    title: 'PPT 大纲',
    kind: '大纲',
    owner: 'curriculum',
    markdown:
      '# 家长会 PPT · 8 页\n\n' +
      '1. 封面：一起把这一周走稳\n' +
      '2. 数据：物理 82.4（+2.1）\n' +
      '3. 学情：专注度 86 · 作业 93%\n' +
      '4. 薄弱点：函数单调性 61%\n' +
      '5. 分层练习：基础 70% / 提高 30%\n' +
      '6. 家长配合：每天 15 分钟\n' +
      '7. 下周安排\n' +
      '8. 问答',
  },
  {
    id: 'a-letters',
    title: '家长信 ×3',
    kind: '信件',
    owner: 'communicator',
    markdown:
      '# 3 封家长信（草稿）\n\n' +
      '**进步型**：这次物理 82.4，较上次 +2.1，主要是函数单调性开始稳了……\n\n' +
      '**临界型**：基础题稳定，提高题还有 15 分空间；建议每天 15 分钟……\n\n' +
      '**退步型**：这次波动主要在受力分析；我们一起定两周小目标……\n\n' +
      '> 安抚信按 L0 只给沟通要点，教师线下处理。',
  },
]

/** 引导脚本：先看决策卡 → 再学委托 → 最后认识战队（自动切屏，淡入淡出） */
export const GUIDE_STEPS: GuideStep[] = [
  { screen: 'inbox', target: '[data-guide="decisions"]', hint: '事情已经备好，只等你点一下' },
  { screen: 'inbox', target: '[data-guide="compose"]', hint: '长链路事务，一句话交给战队' },
  { screen: 'inbox', target: '[data-guide="mission-strip"]', hint: '它会在后台继续跑' },
  { screen: 'team', target: '[data-guide="roster"]', hint: '像带团队一样，调他们的权限' },
]

/** 一句话示例：输入框内轮播（不占正文） */
export const COMPOSE_HINTS = [
  '下周三家长会，材料帮我备齐',
  '这次单元考后，给退步的孩子家长各写一封信',
  '把本周的督导回执和班会材料一起整理好',
]

/** 战队页周报（演示数据，全部来自本机操作记录口径） */
export const WEEKLY = {
  done: 7,
  acceptRate: 83,
  savedHours: 2.5,
  declined: 1,
}
