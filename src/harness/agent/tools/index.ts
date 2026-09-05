import type { RoleId, ToolDef, ToolResult } from '../../types'
import {
  SCHOOLS,
  TEACHERS,
  POLICIES,
} from '../../../data/seed'
import { getSourceProvider } from '../../sources'
import { useQuizStore, type QuizItem } from '../../../stores/quizStore'
import {
  searchCurriculum,
  searchResources,
  listDocuments,
  quoteDocument,
  mergeDocuments,
} from './knowledge'

const ALL: RoleId[] = ['bureau', 'schoolAdmin', 'teacher']

/** 学情查询：按班级关键词返回成绩/作业/专注度聚合（v0.5 M1①：经 SourceProvider 取数，导入数据优先） */
export const queryClassLearning: ToolDef = {
  name: 'queryClassLearning',
  label: '学情查询',
  description: '按班级查询成绩均分、作业完成率、课堂专注度与薄弱知识点',
  roles: ['teacher', 'schoolAdmin'],
  parameters: {
    type: 'object',
    properties: { className: { type: 'string', description: '班级名称，如「高一（3）班」' } },
    required: ['className'],
  },
  async run(args) {
    const kw = String(args.className ?? args.keyword ?? '高一（3）班')
    const { profile: c, meta } = await getSourceProvider().getClassProfile(kw)
    if (!c) {
      return { summary: `未找到班级「${kw}」的学情数据`, payload: null }
    }
    const src = meta.kind === 'csv' ? '（本地导入数据）' : meta.degraded ? '（演示数据）' : ''
    const result: ToolResult = {
      summary: `${c.className}${src}：均分 ${c.scores.map((s) => `${s.subject} ${s.avg}`).join(' / ')}，作业完成率 ${c.homeworkCompletion}%，专注度 ${c.attentionIndex}`,
      payload: c,
    }
    return result
  },
}

/** 校情统计：学校规模、周趋势、结构化预警、教师队伍（v0.3 专项 ①；v0.5 经 SourceProvider 取数） */
export const querySchoolStats: ToolDef = {
  name: 'querySchoolStats',
  label: '校情统计',
  description: '查询学校规模、近8周教学质量趋势、预警清单与教师队伍概况',
  roles: ['schoolAdmin'],
  parameters: { type: 'object', properties: {} },
  async run() {
    const s = SCHOOLS[0]
    const { trend, alerts, meta } = await getSourceProvider().getSchoolOverview()
    const src = meta.degraded ? '（演示数据）' : ''
    return {
      summary: `${s.name}（${s.level}）${src}：${s.classes} 个教学班，教师 ${s.teachers} 人，学生 ${s.students} 人；当前预警 ${alerts.length} 项`,
      payload: { school: s, trend, alerts, teachers: TEACHERS },
    }
  },
}

/** 区域数据：教育局区域指标（v0.5 经 SourceProvider 取数，远端优先） */
export const queryRegionData: ToolDef = {
  name: 'queryRegionData',
  label: '区域数据',
  description: '查询区域教学质量指数、覆盖率、师资达标率等核心指标',
  roles: ['bureau'],
  parameters: { type: 'object', properties: {} },
  async run() {
    const { metrics, meta } = await getSourceProvider().getRegionMetrics()
    const src = meta.degraded ? '（演示数据）' : ''
    return {
      summary: `区域综合指数 ${metrics[0].value}（环比 +${metrics[0].trend}%），AI 分析覆盖率 ${metrics[1]?.value ?? '-'}${src}`,
      payload: { metrics, schools: SCHOOLS },
    }
  },
}

/** 政策检索 */
export const searchPolicy: ToolDef = {
  name: 'searchPolicy',
  label: '政策检索',
  description: '检索教育政策文件标题、发文单位与要点摘要',
  roles: ['bureau', 'schoolAdmin'],
  parameters: {
    type: 'object',
    properties: { keyword: { type: 'string', description: '检索关键词，如「减负」「人工智能」' } },
    required: ['keyword'],
  },
  async run(args) {
    const kw = String(args.keyword ?? '')
    const hits = kw
      ? POLICIES.filter((p) => p.title.includes(kw) || p.summary.includes(kw))
      : POLICIES
    return {
      summary: hits.length
        ? `命中 ${hits.length} 份文件：${hits.map((p) => `《${p.title}》`).join('、')}`
        : '未命中相关政策文件',
      payload: hits,
    }
  },
}

/** 生成教案（Mock：返回结构化教案骨架数据） */
export const genLessonPlan: ToolDef = {
  name: 'genLessonPlan',
  label: '生成教案',
  description: '按课题生成教案骨架：目标、重难点、教学过程环节',
  roles: ['teacher'],
  parameters: {
    type: 'object',
    properties: { topic: { type: 'string', description: '课题名称，如「摩擦力」' } },
    required: ['topic'],
  },
  async run(args) {
    const topic = String(args.topic ?? '新授课')
    return {
      summary: `已生成《${topic}》教案骨架：教学目标 3 条、重难点 2 项、教学过程 5 环节`,
      payload: { topic, sections: ['教学目标', '教学重难点', '教学过程', '板书设计', '作业布置'] },
    }
  },
}

/** 按知识点生成结构化试题组（Mock 骨架，API 模式下同样回填工作台） */
function buildQuizItems(point: string): QuizItem[] {
  const base = point || '综合'
  return [
    {
      id: `q_${Date.now().toString(36)}_1`,
      type: 'single',
      stem: `下列关于「${base}」的说法，正确的是（　）`,
      options: [
        'A. 概念界定与题设相符',
        'B. 混淆了适用条件，判断错误',
        'C. 忽略了前提约束，结论不成立',
        'D. 计算过程有误，结果偏差',
      ],
      answer: 'A',
      analysis: `本题考查「${base}」的核心定义与适用条件：A 项符合定义；B 项混淆条件；C 项忽略前提；D 项计算失误。故选 A。`,
      difficulty: 0.55,
      knowledgePoint: base,
    },
    {
      id: `q_${Date.now().toString(36)}_2`,
      type: 'single',
      stem: `运用「${base}」分析下列情境，其中推理正确的是（　）`,
      options: [
        'A. 情境条件完整，推理链正确',
        'B. 条件缺失，推理不充分',
        'C. 结论与条件无必然联系',
        'D. 推理方向颠倒',
      ],
      answer: 'A',
      analysis: `围绕「${base}」的推理需先确认条件完整性：A 项条件与推理链一致；B、C、D 分别存在条件缺失、无关与方向错误。故选 A。`,
      difficulty: 0.65,
      knowledgePoint: base,
    },
    {
      id: `q_${Date.now().toString(36)}_3`,
      type: 'blank',
      stem: `已知某对象满足「${base}」的典型特征，其关键量值为________（保留两位有效数字）。`,
      answer: '按参考解答给分',
      analysis: `解题要点：先由「${base}」的定义列出关系式，代入已知量求解，注意单位换算与有效数字要求。`,
      difficulty: 0.7,
      knowledgePoint: base,
    },
    {
      id: `q_${Date.now().toString(36)}_4`,
      type: 'blank',
      stem: `在涉及「${base}」的变式情境中，判断该结论是否仍然成立：________（填「成立」或「不成立」），并简述理由。`,
      answer: '成立（需说明适用条件未变）',
      analysis: `变式情境考查条件迁移：只要「${base}」的适用前提未被破坏，结论依然成立；答题需点明前提条件。`,
      difficulty: 0.72,
      knowledgePoint: base,
    },
    {
      id: `q_${Date.now().toString(36)}_5`,
      type: 'solve',
      stem: `综合应用：请结合「${base}」的相关规律，完成下列小题。\n（1）写出必要的依据与关系式；\n（2）代入数据求解并说明结果的合理性。`,
      answer: '按步骤给分：依据 2 分、关系式 3 分、求解 3 分、合理性说明 2 分',
      analysis: `评分要点：①明确「${base}」的适用条件与依据；②正确列出关系式；③运算规范、结果合理；④能对结果进行检验与讨论。`,
      difficulty: 0.78,
      knowledgePoint: base,
    },
  ]
}

/** 命制试题：结构化输出并写入出题工作台（v0.3 专项 ①） */
export const genQuiz: ToolDef = {
  name: 'genQuiz',
  label: '命制试题',
  description: '按知识点与难度生成试题组（选择/填空/解答），结果写入出题工作台',
  roles: ['teacher'],
  parameters: {
    type: 'object',
    properties: {
      knowledgePoint: { type: 'string', description: '知识点，如「函数单调性判定」' },
      difficulty: { type: 'string', description: '难度描述，可选' },
    },
    required: ['knowledgePoint'],
  },
  async run(args) {
    const point = String(args.knowledgePoint ?? '综合')
    const items = buildQuizItems(point)
    // payload 直接写入出题工作台（Mock/API 模式一致）
    useQuizStore.getState().setItems(point, items)
    return {
      summary: `围绕「${point}」命制试题 5 道：单选 2、填空 2、解答 1，已写入出题工作台`,
      payload: { knowledgePoint: point, counts: { single: 2, blank: 2, solve: 1 }, items },
    }
  },
}

/** 起草通知 */
export const draftNotice: ToolDef = {
  name: 'draftNotice',
  label: '起草通知',
  description: '按事项起草行政通知/会议纪要文稿',
  roles: ['schoolAdmin', 'bureau'],
  parameters: {
    type: 'object',
    properties: { matter: { type: 'string', description: '通知事项，如「学生体质健康专项督导」' } },
    required: ['matter'],
  },
  async run(args) {
    const matter = String(args.matter ?? '工作事项')
    return {
      summary: `已起草「${matter}」通知文稿：含依据、事项安排、时间节点与落款`,
      payload: { matter },
    }
  },
}

/** 评课分析 */
export const analyzeClass: ToolDef = {
  name: 'analyzeClass',
  label: '评课分析',
  description: '对课堂录像分析结果进行五维评课（规范性/互动性/创新性等）',
  roles: ['teacher', 'schoolAdmin'],
  parameters: {
    type: 'object',
    properties: { teacher: { type: 'string', description: '教师姓名，可选，默认最近被评课教师' } },
  },
  async run(args) {
    const teacher = String(args.teacher ?? '李建国')
    const t = TEACHERS.find((x) => x.name === teacher) ?? TEACHERS[0]
    return {
      summary: `${t.name}（${t.subject}）综合评分 ${t.score}，环比 ${t.trend > 0 ? '+' : ''}${t.trend}；优势：规范性，待提升：互动性`,
      payload: t,
    }
  },
}

export const TOOLS: ToolDef[] = [
  queryClassLearning,
  querySchoolStats,
  queryRegionData,
  searchPolicy,
  genLessonPlan,
  genQuiz,
  draftNotice,
  analyzeClass,
  // v0.5 M3①：知识检索 + 跨文档工具
  searchCurriculum,
  searchResources,
  listDocuments,
  quoteDocument,
  mergeDocuments,
]

export const TEACHER_TOOLS = [
  'queryClassLearning', 'genLessonPlan', 'genQuiz', 'analyzeClass',
  'searchCurriculum', 'searchResources', 'listDocuments', 'quoteDocument', 'mergeDocuments',
]
export const SCHOOL_ADMIN_TOOLS = [
  'queryClassLearning', 'querySchoolStats', 'analyzeClass', 'draftNotice', 'searchPolicy',
  'searchCurriculum', 'searchResources', 'listDocuments', 'quoteDocument', 'mergeDocuments',
]
export const BUREAU_TOOLS = [
  'queryRegionData', 'searchPolicy', 'draftNotice',
  'searchCurriculum', 'searchResources', 'listDocuments', 'quoteDocument', 'mergeDocuments',
]
