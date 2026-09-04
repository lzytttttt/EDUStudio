import type { ArtifactKind, RoleId } from '../types'

/** Agent 预制剧本：Plan→Act→Reflect 步骤序列，按角色 + 关键词匹配，任何输入都有降级剧本 */

export type ScriptStep =
  | { type: 'plan'; steps: string[] }
  | { type: 'tool'; tool: string; args: Record<string, unknown> }
  | { type: 'reflect'; text: string }
  | { type: 'artifact'; kind: ArtifactKind }
  | { type: 'text'; text: string }
  | { type: 'done'; text: string }

export interface AgentScript {
  id: string
  roles: RoleId[]
  match: string[]
  steps: ScriptStep[]
}

export const AGENT_SCRIPTS: AgentScript[] = [
  /* ---------- 教师 ---------- */
  {
    id: 'teacher-weakpoint-drill',
    roles: ['teacher'],
    match: ['薄弱', '习题课', '分层练习', '掌握率', '练习题', '出题', '试题', '命制'],
    steps: [
      { type: 'plan', steps: ['查询班级学情，定位薄弱知识点', '围绕薄弱点命制分层试题', '生成习题课教案文档'] },
      { type: 'tool', tool: 'queryClassLearning', args: { className: '高一（3）班' } },
      { type: 'tool', tool: 'genQuiz', args: { knowledgePoint: '函数单调性判定' } },
      { type: 'reflect', text: '学情显示「函数单调性」掌握率 61%，试题已按 A/B/C 三层命制，与薄弱点匹配，可生成教案。' },
      { type: 'artifact', kind: 'lessonPlan' },
      { type: 'done', text: '已完成：学情定位 → 分层试题 → 习题课教案。教案已在右侧打开，可直接编辑调整分层比例。' },
    ],
  },
  {
    id: 'teacher-lesson-plan',
    roles: ['teacher'],
    match: ['教案', '备课', '公开课', '课件'],
    steps: [
      { type: 'plan', steps: ['确认课题与课标要求', '生成教案骨架（目标/重难点/过程）', '输出可编辑教案文档'] },
      { type: 'tool', tool: 'genLessonPlan', args: { topic: '本课课题' } },
      { type: 'reflect', text: '教案骨架已含五环节与时间分配，重难点已按课标标注，可进入文档细化。' },
      { type: 'artifact', kind: 'lessonPlan' },
      { type: 'done', text: '教案已生成到右侧工作区。需要补充例题、调整环节时长或生成配套课件，直接继续对话即可。' },
    ],
  },
  {
    id: 'teacher-parent-talk',
    roles: ['teacher'],
    match: ['家长会', '讲稿', '家长'],
    steps: [
      { type: 'plan', steps: ['调取班级成绩与表现数据', '按四段结构生成家长会讲稿'] },
      { type: 'tool', tool: 'queryClassLearning', args: { className: '高一（3）班' } },
      { type: 'reflect', text: '数据齐备：均分、作业完成率、专注度均可引用，进步亮点与分层建议已归纳。' },
      { type: 'artifact', kind: 'report' },
      { type: 'done', text: '家长会讲稿已生成，四段结构完整，数据自动引用。可在右侧编辑个性化表述。' },
    ],
  },
  /* ---------- 学校管理 ---------- */
  {
    id: 'admin-support-plan',
    roles: ['schoolAdmin'],
    match: ['帮扶', '下滑', '预警', '诊断'],
    steps: [
      { type: 'plan', steps: ['核查预警班级学情数据', '调取校情与教师队伍概况', '起草教学质量帮扶方案'] },
      { type: 'tool', tool: 'queryClassLearning', args: { className: '高一（7）班' } },
      { type: 'tool', tool: 'querySchoolStats', args: {} },
      { type: 'reflect', text: '证据链完整：均分 -3.2、作业完成率 85%、专注度 74，三项数据互相印证，帮扶方案可落地。' },
      { type: 'artifact', kind: 'report' },
      { type: 'done', text: '帮扶方案已生成：含数据证据、跟班诊断安排与两周复查节点。可在右侧编辑后提交行政会。' },
    ],
  },
  {
    id: 'admin-briefing',
    roles: ['schoolAdmin'],
    match: ['简报', '治理', '月度', '行政会'],
    steps: [
      { type: 'plan', steps: ['汇总校情统计与预警', '生成治理简报（质量/师资/预警）'] },
      { type: 'tool', tool: 'querySchoolStats', args: {} },
      { type: 'reflect', text: '本月评课优良率 78%，预警 3 项（1 高 1 中 1 低），简报结构按「成效-问题-建议」组织。' },
      { type: 'artifact', kind: 'report' },
      { type: 'done', text: '治理简报已生成，预警项均附证据与建议动作，可直接用于行政会汇报。' },
    ],
  },
  {
    id: 'admin-notice',
    roles: ['schoolAdmin'],
    match: ['通知', '例会', '方案', '申报'],
    steps: [
      { type: 'plan', steps: ['检索相关政策依据', '起草通知/方案文稿'] },
      { type: 'tool', tool: 'searchPolicy', args: { keyword: '人工智能' } },
      { type: 'tool', tool: 'draftNotice', args: { matter: '例会改革试运行' } },
      { type: 'reflect', text: '已引用市局 AI 教育实施意见作为依据，文稿含依据、安排、要求三段，符合行政文书规范。' },
      { type: 'artifact', kind: 'notice' },
      { type: 'done', text: '文稿已生成到右侧，落款与报送方式已按规范填写，核对时间节点后即可发布。' },
    ],
  },
  {
    id: 'admin-lesson-review',
    roles: ['schoolAdmin'],
    match: ['评课', '听课', '课堂分析'],
    steps: [
      { type: 'plan', steps: ['调取评课数据', '生成评课分析报告'] },
      { type: 'tool', tool: 'analyzeClass', args: { teacher: '李建国' } },
      { type: 'reflect', text: '五维评分已汇总，互动性为共性短板，建议在报告中附「提问链 + 小组互评」改进策略。' },
      { type: 'artifact', kind: 'report' },
      { type: 'done', text: '评课分析已生成，含五维明细与改进建议，可作为教研活动材料。' },
    ],
  },
  /* ---------- 教育局 ---------- */
  {
    id: 'bureau-quarter-report',
    roles: ['bureau'],
    match: ['报告', '汇总', '分析', '季度', '质量'],
    steps: [
      { type: 'plan', steps: ['调取区域核心指标', '核对政策口径', '起草季度分析报告'] },
      { type: 'tool', tool: 'queryRegionData', args: {} },
      { type: 'tool', tool: 'searchPolicy', args: { keyword: '质量' } },
      { type: 'reflect', text: '指标齐备且口径与省厅评价指南一致，问题部分引用体质与薄弱班级数据，报告可成稿。' },
      { type: 'artifact', kind: 'report' },
      { type: 'done', text: '季度分析报告已生成：总体情况、成效、问题、建议四部分完整，数据均可溯源。' },
    ],
  },
  {
    id: 'bureau-supervision',
    roles: ['bureau'],
    match: ['督导', '通报', '检查', '评估', '体质'],
    steps: [
      { type: 'plan', steps: ['检索政策依据', '起草督导通知文稿'] },
      { type: 'tool', tool: 'searchPolicy', args: { keyword: '减负' } },
      { type: 'tool', tool: 'draftNotice', args: { matter: '学生体质健康专项督导' } },
      { type: 'reflect', text: '已引用减负清单与质量评价指南，督导安排含自查、整改、检查三阶段，抽查比例已明确。' },
      { type: 'artifact', kind: 'notice' },
      { type: 'done', text: '督导通知已生成，报送方式与问责条款已按公文规范成稿，核对后可印发。' },
    ],
  },
  {
    id: 'bureau-training-plan',
    roles: ['bureau'],
    match: ['培训', '实施方案', '师资', '评审', '申报'],
    steps: [
      { type: 'plan', steps: ['核对政策要求与时间表', '起草实施方案/评审意见'] },
      { type: 'tool', tool: 'searchPolicy', args: { keyword: '人工智能' } },
      { type: 'reflect', text: '政策要求 2027 年前全覆盖，方案按「骨干轮训 + 二级培训」路径设计，经费与考核已纳入。' },
      { type: 'artifact', kind: 'report' },
      { type: 'done', text: '方案已生成，含目标路径、阶段安排与保障机制，可直接进入征求意见环节。' },
    ],
  },
]

/** 降级剧本：任何输入都有响应（单步规划 + 角色化引导） */
export const FALLBACK_SCRIPTS: Record<RoleId, AgentScript> = {
  teacher: {
    id: 'fallback-teacher',
    roles: ['teacher'],
    match: [],
    steps: [
      { type: 'plan', steps: ['理解需求并给出建议路径'] },
      {
        type: 'text',
        text: '收到。我建议把这个需求拆成两步：先明确学情与课标要求，再产出具体材料。你可以更具体地描述，例如「针对高一（3）班函数单调性薄弱点，出一组分层练习题」或「帮我备一节《摩擦力》公开课」，我会调用学情查询、试题命制、教案生成等工具完成。',
      },
      { type: 'done', text: '已给出建议路径。补充具体目标后，我会自动规划并执行。' },
    ],
  },
  schoolAdmin: {
    id: 'fallback-admin',
    roles: ['schoolAdmin'],
    match: [],
    steps: [
      { type: 'plan', steps: ['理解需求并给出建议路径'] },
      {
        type: 'text',
        text: '收到。作为治理助手，我会先核对数据再给结论。例如「对比高一两个班本月物理成绩并给出预警建议」或「生成本月治理简报」，我会调用校情统计、学情查询、评课分析等工具，输出带数据依据的分析与文书。',
      },
      { type: 'done', text: '已给出建议路径。补充具体班级或事项后，我会自动规划并执行。' },
    ],
  },
  bureau: {
    id: 'fallback-bureau',
    roles: ['bureau'],
    match: [],
    steps: [
      { type: 'plan', steps: ['理解需求并给出建议路径'] },
      {
        type: 'text',
        text: '收到。作为区域公文助手，我会确保行文规范、数据可溯源。例如「汇总本学期区域教学质量情况并起草季度报告」或「起草学生体质健康专项督导通知」，我会调用区域数据、政策检索等工具，按公文结构产出文稿。',
      },
      { type: 'done', text: '已给出建议路径。补充具体事项或文种后，我会自动规划并执行。' },
    ],
  },
}

export function matchScript(role: RoleId, goal: string): AgentScript {
  const g = goal.toLowerCase()
  const hit = AGENT_SCRIPTS.find((s) => s.roles.includes(role) && s.match.some((k) => g.includes(k)))
  return hit ?? FALLBACK_SCRIPTS[role]
}
