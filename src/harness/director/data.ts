/**
 * Director 原型演示数据（Mock，全部来自 seed 锚点）
 *
 * 数字口径（与 doc/v1.0-roadmap.md 附录 C、doc/v1.1-roadmap.md 附录 E 对齐）：
 * - 82.4 / 78.6 / 80.2 = 高一（3）班物理 / 数学 / 化学的「均分」；
 * - 93% = 作业完成率；86 = 课堂专注度；61% = 函数单调性判定掌握率；
 * - 82.4 不是「班级均分」；t8 旧文案的 +1.8 与 seed 的 +2.1 冲突，本原型统一 +2.1；
 * - 80.4 = 三科均分（派生值：82.4/78.6/80.2），引用时必须标「派生」。
 *
 * v1.1（M3 第二剧本）模板化：
 * - `MISSION_TEMPLATES` 收口两条剧本（parent_meeting / exam_loop），store 按 `mission.kind` 取
 *   plan / script / artifacts，done 页统计取模板 `meta`；
 * - 旧导出 `MISSION_PLAN` / `MISSION_SCRIPT` / `ARTIFACTS` 由 parent_meeting 模板派生，旧调用点零改动；
 * - 所有统计型数字带 `{{值~来源}}` 引用（P0-3）；「3 封 / 8 页 / 12 题 / 45 分钟 / 70%」等结构性数字
 *   走 verifyCitations 的结构白名单，不再逐条引用；
 * - 不写学生姓名（只到班级口径）。
 */
import type {
  AgentProfile,
  ArtifactTile,
  DecisionItem,
  DirectorAgentId,
  GateId,
  GuideStep,
  MissionKind,
  MissionPlanTask,
  MissionScriptEvent,
  MissionTemplate,
} from '../director/types'

export type { MissionScriptEvent } from '../director/types'

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

/* ------------------------------------------------------------------ */
/* 剧本模板注册表（roadmap §6.1）                                        */
/* ------------------------------------------------------------------ */

/** 审批门 → 被卡住的成员（弃权/退回只重跑该成员负责的那一段） */
export const GATE_OWNER: Record<GateId, DirectorAgentId> = {
  speech: 'curriculum',
  letters: 'communicator',
  worksheet: 'assessor',
  lesson: 'curriculum',
}

/** 决策卡 → 剧本联动（d-drill 采纳后种下单元考闭环计划，roadmap D9） */
export const DECISION_TO_MISSION: Partial<Record<string, MissionKind>> = {
  'd-drill': 'exam_loop',
}

/**
 * 「件交付」统计口径（仅用于 stats.hosted 累加，保持 v1.0 演示数字不变）：
 * - parent_meeting 旧口径把「家长信 ×3」计 3 件 → 4 张卡共 6 件（旧单测断言 hosted 4 → 10）；
 * - exam_loop 为 4 件。done 页「可点卡数」仍以 `template.artifacts.length` / meta.delivered 为准。
 */
export const MISSION_HOSTED_PIECES: Record<MissionKind, number> = {
  parent_meeting: 6,
  exam_loop: 4,
}

/* ---------- 剧本一：家长会材料包（v1.0 沿用） ---------- */

const PARENT_MEETING_PLAN: MissionPlanTask[] = [
  { id: 't1', agentId: 'analyst', title: '核对学情与名单', seconds: 40 },
  { id: 't2', agentId: 'curriculum', title: '起草发言稿 + PPT 大纲', seconds: 90, gate: 'speech' },
  { id: 't3', agentId: 'communicator', title: '写 3 封家长信', seconds: 90, gate: 'letters' },
  { id: 't4', agentId: 'communicator', title: '安抚信沟通要点', seconds: 40 },
  { id: 't5', agentId: 'chief', title: '汇总与三道校验', seconds: 30 },
]

/** 演示加速版时间线：真实约 8 分钟压缩到 ~9 秒（旧单测按此时间线推进，勿改） */
const PARENT_MEETING_SCRIPT: MissionScriptEvent[] = [
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

/** 作战包（4 个交付物；统计型数字全部带 `{{值~来源}}`，结构性数字走白名单） */
const PARENT_MEETING_ARTIFACTS: ArtifactTile[] = [
  {
    id: 'a-brief',
    title: '学情简报',
    kind: '简报',
    owner: 'analyst',
    markdown:
      '# 高一（3）班 · 学情简报\n\n' +
      '- 物理 **{{82.4~学情库 · 高一（3）班 · 单元考}}**（较上次 {{+2.1~学情库 · 单元考 · 环比}}）\n' +
      '- 数学 **{{78.6~学情库 · 高一（3）班 · 单元考}}**（{{-1.4~学情库 · 单元考 · 环比}}）· 化学 **{{80.2~学情库 · 高一（3）班 · 单元考}}**（{{+0.8~学情库 · 单元考 · 环比}}）\n' +
      '- 作业完成率 **{{93%~学情库 · 高一（3）班 · 作业记录}}** · 课堂专注度 **{{86~学情库 · 近两周课堂观察}}**\n\n' +
      '## 薄弱点\n\n函数单调性判定（掌握率 **{{61%~学情库 · 近两周测验}}**）\n\n' +
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
      '本次单元考物理均分 **{{82.4~学情库 · 单元考}}**，较上次 **{{+2.1~学情库 · 单元考 · 环比}}**；班级作业完成率 **{{93%~学情库 · 作业记录}}**。\n\n' +
      '## 二、进步亮点\n\n' +
      '课堂专注度 **{{86~学情库 · 课堂观察}}**，高于年级均值；函数单调性仍有 **{{61%~学情库 · 近两周测验}}** 的掌握缺口。\n\n' +
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
      '2. 数据：物理 {{82.4~学情库 · 单元考}}（{{+2.1~学情库 · 单元考 · 环比}}）\n' +
      '3. 学情：专注度 {{86~学情库 · 课堂观察}} · 作业 {{93%~学情库 · 作业记录}}\n' +
      '4. 薄弱点：函数单调性 {{61%~学情库 · 近两周测验}}\n' +
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
      '**进步型**：这次物理 {{82.4~学情库 · 单元考}}，较上次 {{+2.1~学情库 · 单元考 · 环比}}，主要是函数单调性开始稳了……\n\n' +
      '**临界型**：基础题稳定，提高题还有空间；建议每天 15 分钟……\n\n' +
      '**退步型**：这次波动主要在受力分析；我们一起定两周小目标……\n\n' +
      '> 安抚信按 L0 只给沟通要点，教师线下处理。',
  },
]

/* ---------- 剧本二：单元考闭环（v1.1 新增，roadmap §6.3 / 附录 C） ---------- */

const EXAM_LOOP_PLAN: MissionPlanTask[] = [
  { id: 't1', agentId: 'analyst', title: '核对单元考数据', seconds: 40, deps: [] },
  { id: 't2', agentId: 'assessor', title: '分层练习单（基础 70%／提高 30%）', seconds: 90, deps: ['t1'], gate: 'worksheet' },
  { id: 't3', agentId: 'curriculum', title: '习题课教案（45 分钟 5 环节）', seconds: 90, deps: ['t1'], gate: 'lesson' },
  { id: 't4', agentId: 'chief', title: '三道路径校验 + 作战包', seconds: 30, deps: ['t2', 't3'] },
]

/** 演示加速版时间线：真实约 15 分钟压缩到 ~6–7 秒（附录 C，含 1 处数字口径校验） */
const EXAM_LOOP_SCRIPT: MissionScriptEvent[] = [
  { kind: 'feed', agentId: 'analyst', text: '核对单元考数据（物理 82.4 / 数学 78.6 / 化学 80.2）', after: 700, task: 't1', progress: 12 },
  { kind: 'feed', agentId: 'analyst', text: '标出 1 处口径：82.4 是物理均分，不是班级均分', after: 600, progress: 20 },
  { kind: 'feed', agentId: 'assessor', text: '分层练习完成（基础 70% / 提高 30% · 12 题）', after: 700, task: 't2', progress: 34 },
  { kind: 'gate', agentId: 'chief', text: '分层练习待你过目', after: 800, gate: 'worksheet', progress: 46 },
  { kind: 'feed', agentId: 'curriculum', text: '习题课教案完成（45 分钟 · 5 环节）', after: 800, task: 't3', progress: 60 },
  { kind: 'gate', agentId: 'chief', text: '习题课教案待你过目', after: 800, gate: 'lesson', progress: 72 },
  { kind: 'feed', agentId: 'chief', text: '三道路径校验完成', after: 800, progress: 84 },
  { kind: 'feed', agentId: 'chief', text: '作战包已生成', after: 600, task: 't4', progress: 92 },
  { kind: 'done', text: '作战包已交付', after: 500, progress: 100 },
]

/** 作战包（4 件；统计型数字全部可溯源，口径与附录 C/E 一致） */
const EXAM_LOOP_ARTIFACTS: ArtifactTile[] = [
  {
    id: 'a-brief',
    title: '学情简报',
    kind: '简报',
    owner: 'analyst',
    markdown:
      '# 高一（3）班 · 单元考学情简报\n\n' +
      '- 物理均分 **{{82.4~学情库 · 高一（3）班 · 单元考}}**（较上次 {{+2.1~学情库 · 单元考 · 环比}}）\n' +
      '- 数学均分 **{{78.6~学情库 · 高一（3）班 · 单元考}}**（{{-1.4~学情库 · 单元考 · 环比}}）· 化学均分 **{{80.2~学情库 · 高一（3）班 · 单元考}}**（{{+0.8~学情库 · 单元考 · 环比}}）\n' +
      '- 作业完成率 **{{93%~学情库 · 高一（3）班 · 作业记录}}** · 课堂专注度 **{{86~学情库 · 近两周课堂观察}}**\n\n' +
      '## 薄弱点\n\n函数单调性判定掌握率 **{{61%~学情库 · 近两周测验}}**，作为分层练习与习题课的共同依据。\n\n' +
      '> 口径：{{82.4~学情库 · 单元考}} 是物理均分，不是班级均分；三科均分 {{80.4~派生值 · 82.4/78.6/80.2}} 为派生值，引用时须标注「派生」。',
  },
  {
    id: 'a-drill',
    title: '分层练习单',
    kind: '练习单',
    owner: 'assessor',
    markdown:
      '# 分层练习单 · 函数单调性\n\n' +
      '- 题量 12 题：基础 9 题（70%）+ 提高 3 题（30%），约 25 分钟\n' +
      '- 依据：函数单调性判定掌握率 **{{61%~学情库 · 近两周测验}}**（本班薄弱点）\n' +
      '- 每题标注：知识点 / 难度 / 答案；不出现学生姓名，只按分层名单序号发放\n\n' +
      '## 使用建议\n\n' +
      '课上完成基础篇，课后按分层名单发提高篇；已删除 1 道偏难题，保证全班可做。\n\n' +
      '> 比例可调：采纳时当前为 基础 70% / 提高 30%；教师可改为 60% / 40%。',
  },
  {
    id: 'a-lesson',
    title: '习题课教案',
    kind: '教案',
    owner: 'curriculum',
    markdown:
      '# 习题课教案 · 函数单调性（45 分钟）\n\n' +
      '| 环节 | 时长 | 内容 |\n' +
      '| --- | --- | --- |\n' +
      '| 导入 | 5 分钟 | 本班实验情境：气温变化与函数图像 |\n' +
      '| 诊断精讲 | 12 分钟 | 用单元考错题定位判定误区 |\n' +
      '| 分层练习 | 15 分钟 | 基础 70% / 提高 30% |\n' +
      '| 讲评 | 8 分钟 | 三道路径对照 |\n' +
      '| 小结 | 5 分钟 | 一条判定口诀 |\n\n' +
      '> 依据：函数单调性判定掌握率 **{{61%~学情库 · 近两周测验}}**；练习单与教案共用同一套分层比例，导入情境已换成本班实验。',
  },
  {
    id: 'a-pack',
    title: '作战包摘要',
    kind: '摘要',
    owner: 'chief',
    markdown:
      '# 作战包摘要 · 单元考闭环\n\n' +
      '- 交付 4 件：学情简报 / 分层练习单 / 习题课教案 / 本摘要\n' +
      '- 只做 2 个决定：练习单比例、教案环节\n' +
      '- 数字来源：物理均分 {{82.4~学情库 · 单元考}}、作业完成率 {{93%~学情库 · 作业记录}}、函数单调性掌握率 {{61%~学情库 · 近两周测验}}\n' +
      '- 待办 2 条：课前确认分层名单、课后同步家长端练习安排\n\n' +
      '> 口径：{{82.4~学情库 · 单元考}} 是物理均分；三科均分 {{80.4~派生值 · 82.4/78.6/80.2}} 为派生值。',
  },
]

/** 两条演示剧本的模板注册表（store 按 kind 取计划/脚本/产物/统计） */
export const MISSION_TEMPLATES: Record<MissionKind, MissionTemplate> = {
  parent_meeting: {
    kind: 'parent_meeting',
    title: '家长会材料包',
    plan: PARENT_MEETING_PLAN,
    script: PARENT_MEETING_SCRIPT,
    artifacts: PARENT_MEETING_ARTIFACTS,
    gates: ['speech', 'letters'],
    meta: {
      steps: PARENT_MEETING_PLAN.length,
      members: 3,
      gates: 2,
      demoSeconds: 9,
      savedHours: 1.6,
      delivered: PARENT_MEETING_ARTIFACTS.length,
      decisions: 2,
    },
  },
  exam_loop: {
    kind: 'exam_loop',
    title: '单元考闭环',
    plan: EXAM_LOOP_PLAN,
    script: EXAM_LOOP_SCRIPT,
    artifacts: EXAM_LOOP_ARTIFACTS,
    gates: ['worksheet', 'lesson'],
    meta: {
      steps: EXAM_LOOP_PLAN.length,
      members: 3,
      gates: 2,
      demoSeconds: 7,
      savedHours: 1.2,
      delivered: EXAM_LOOP_ARTIFACTS.length,
      decisions: 2,
    },
  },
}

/** 取模板（非法 kind 回退 parent_meeting，坏持久化数据不会打穿 store） */
export function missionTemplate(kind: MissionKind): MissionTemplate {
  return MISSION_TEMPLATES[kind] ?? MISSION_TEMPLATES.parent_meeting
}

/* ---------- 旧导出兼容（由 parent_meeting 模板派生，旧单测/E2E 断言零改动） ---------- */

/** 一句话委托 → 作战计划（5 个环节 / 3 位执行成员 / 2 次拍板） */
export const MISSION_PLAN: MissionPlanTask[] = MISSION_TEMPLATES.parent_meeting.plan

/** 演示加速版时间线：真实约 8 分钟压缩到 ~9 秒 */
export const MISSION_SCRIPT: MissionScriptEvent[] = MISSION_TEMPLATES.parent_meeting.script

/** 作战包（4 个交付物；数字锚点与 seed 一致） */
export const ARTIFACTS: ArtifactTile[] = MISSION_TEMPLATES.parent_meeting.artifacts

/* ------------------------------------------------------------------ */
/* 意图路由（纯函数，便于表驱动单测；roadmap §6.2 / D8）                  */
/* ------------------------------------------------------------------ */

/** 单元考闭环关键词（命中即 exam_loop；混合句 exam 优先） */
export const EXAM_LOOP_KEYWORDS: readonly string[] = ['单元考', '诊断', '分层', '练习', '习题课', '薄弱点']

/** 家长会材料包关键词（仅在没有单元考类关键词时生效） */
export const PARENT_MEETING_KEYWORDS: readonly string[] = ['家长会', '发言稿', '讲稿', 'ppt', '家长信', '安抚']

/**
 * Mock 意图路由：一句话 → 剧本 kind。
 * 规则：exam 关键词优先（混合句也走 exam_loop）→ parent 关键词 → 空/未知默认 parent_meeting。
 * 不加可见场景切换（D8），现场兜底用 URL `?mission=exam_loop`。
 */
export function routeMissionKind(utterance: string): MissionKind {
  const text = (typeof utterance === 'string' ? utterance : '').trim().toLowerCase()
  if (EXAM_LOOP_KEYWORDS.some((keyword) => text.includes(keyword))) return 'exam_loop'
  if (PARENT_MEETING_KEYWORDS.some((keyword) => text.includes(keyword))) return 'parent_meeting'
  return 'parent_meeting'
}

/* ------------------------------------------------------------------ */
/* 引导 / 示例 / 周报                                                    */
/* ------------------------------------------------------------------ */

/** 引导脚本：先看决策卡（光圈只包首卡）→ 再学委托 → 最后认识战队（自动切屏，淡入淡出） */
export const GUIDE_STEPS: GuideStep[] = [
  { screen: 'inbox', target: '[data-guide="decision-first"]', hint: '先看这一张' },
  { screen: 'inbox', target: '[data-guide="compose"]', hint: '长链路事务，一句话交给战队' },
  { screen: 'inbox', target: '[data-guide="mission-strip"]', hint: '它会在后台继续跑' },
  { screen: 'team', target: '[data-guide="roster"]', hint: '像带团队一样，调他们的权限' },
]

/** 一句话示例：输入框内轮播（不占正文；示例本身也要能被路由正确识别） */
export const COMPOSE_HINTS = [
  '下周三家长会，材料帮我备齐',
  '这次单元考后，做个诊断和分层练习',
  '把本周的督导回执和班会材料一起整理好',
]

/** 战队页周报（演示数据，全部来自本机操作记录口径） */
export const WEEKLY = {
  done: 7,
  acceptRate: 83,
  savedHours: 2.5,
  declined: 1,
}
