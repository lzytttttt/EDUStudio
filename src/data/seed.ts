/**
 * Raw 层种子数据：AI 消费与工具取数的唯一数据源。
 * 分层约定：Raw（本文件）→ Aggregated（工具聚合）→ Agent Output → Presentation。
 */

export interface School {
  id: string
  name: string
  district: string
  level: '小学' | '初中' | '高中'
  classes: number
  teachers: number
  students: number
}

export interface ClassInfo {
  id: string
  schoolId: string
  grade: string
  name: string
  headTeacher: string
  students: number
}

export interface SubjectScore {
  subject: string
  avg: number
  passRate: number
  excellenceRate: number
  trend: number // 环比百分点
}

export interface ClassLearning {
  classId: string
  className: string
  scores: SubjectScore[]
  homeworkCompletion: number
  attentionIndex: number // 课堂专注度 0-100
  weakPoints: string[]
}

export interface RegionMetric {
  name: string
  value: string
  trend: number
  note: string
  /** 近 6 期历史值（用于趋势图，v0.3 专项 ①） */
  history: number[]
}

/** 校情周趋势（校长驾驶舱用，v0.3 专项 ①） */
export interface SchoolTrendPoint {
  week: string
  avgScore: number
  homework: number
  attention: number
}

/** 结构化预警（v0.3 专项 ①：可点击定位） */
export interface SchoolAlert {
  level: 'high' | 'mid' | 'low'
  title: string
  detail: string
  className: string
}

export interface PolicyDoc {
  id: string
  title: string
  issuer: string
  date: string
  summary: string
}

export const SCHOOLS: School[] = [
  { id: 's1', name: '实验一中', district: '城东区', level: '高中', classes: 36, teachers: 142, students: 1890 },
  { id: 's2', name: '育才中学', district: '城西区', level: '初中', classes: 28, teachers: 98, students: 1420 },
  { id: 's3', name: '朝阳小学', district: '城东区', level: '小学', classes: 24, teachers: 76, students: 1180 },
]

export const CLASSES: ClassInfo[] = [
  { id: 'c1', schoolId: 's1', grade: '高一', name: '高一（3）班', headTeacher: '李建国', students: 46 },
  { id: 'c2', schoolId: 's1', grade: '高一', name: '高一（7）班', headTeacher: '王芳', students: 45 },
  { id: 'c3', schoolId: 's2', grade: '初二', name: '初二（5）班', headTeacher: '陈静', students: 42 },
  { id: 'c4', schoolId: 's2', grade: '初三', name: '初三（1）班', headTeacher: '刘强', students: 44 },
  { id: 'c5', schoolId: 's3', grade: '五年级', name: '五（2）班', headTeacher: '赵敏', students: 40 },
]

export const CLASS_LEARNING: ClassLearning[] = [
  {
    classId: 'c1',
    className: '高一（3）班',
    scores: [
      { subject: '物理', avg: 82.4, passRate: 91, excellenceRate: 38, trend: 2.1 },
      { subject: '数学', avg: 78.6, passRate: 87, excellenceRate: 31, trend: -1.4 },
      { subject: '化学', avg: 80.2, passRate: 89, excellenceRate: 34, trend: 0.8 },
    ],
    homeworkCompletion: 93,
    attentionIndex: 86,
    /* 薄弱点带掌握率（v0.9.3 P1-C①）：与 Mock 剧本 / 宣传片「函数单调性 61%」同组数字 */
    weakPoints: ['函数单调性判定（掌握率 61%）', '受力分析斜面模型', '氧化还原配平'],
  },
  {
    classId: 'c2',
    className: '高一（7）班',
    scores: [
      { subject: '物理', avg: 74.1, passRate: 78, excellenceRate: 19, trend: -3.2 },
      { subject: '数学', avg: 76.8, passRate: 84, excellenceRate: 27, trend: 0.5 },
      { subject: '英语', avg: 79.5, passRate: 88, excellenceRate: 30, trend: 1.2 },
    ],
    homeworkCompletion: 85,
    attentionIndex: 74,
    weakPoints: ['牛顿第二定律应用', '阅读理解推理题'],
  },
  {
    classId: 'c3',
    className: '初二（5）班',
    scores: [
      { subject: '数学', avg: 81.3, passRate: 90, excellenceRate: 35, trend: 1.8 },
      { subject: '物理', avg: 77.9, passRate: 85, excellenceRate: 26, trend: 0.4 },
    ],
    homeworkCompletion: 91,
    attentionIndex: 82,
    weakPoints: ['全等三角形判定', '浮力综合计算'],
  },
  {
    classId: 'c4',
    className: '初三（1）班',
    scores: [
      { subject: '数学', avg: 84.7, passRate: 95, excellenceRate: 42, trend: 2.6 },
      { subject: '物理', avg: 83.1, passRate: 93, excellenceRate: 40, trend: 1.9 },
      { subject: '化学', avg: 81.8, passRate: 92, excellenceRate: 37, trend: 1.1 },
    ],
    homeworkCompletion: 96,
    attentionIndex: 90,
    weakPoints: ['二次函数综合题'],
  },
  {
    classId: 'c5',
    className: '五（2）班',
    scores: [
      { subject: '数学', avg: 86.2, passRate: 97, excellenceRate: 48, trend: 1.5 },
      { subject: '语文', avg: 83.9, passRate: 94, excellenceRate: 36, trend: -0.6 },
    ],
    homeworkCompletion: 94,
    attentionIndex: 88,
    weakPoints: ['分数应用题', '阅读概括能力'],
  },
]

export const REGION_METRICS: RegionMetric[] = [
  { name: '区域教学质量综合指数', value: '86.4', trend: 1.6, note: '全区 12 所中小学，环比上升', history: [82.1, 83.0, 83.8, 84.5, 85.0, 86.4] },
  { name: '课堂 AI 分析覆盖率', value: '65%', trend: 12.0, note: '本学期新增 4 所试点校', history: [38, 42, 47, 53, 58, 65] },
  { name: '教师专业发展达标率', value: '88.2%', trend: 2.3, note: '继续教育学时完成情况', history: [83.5, 84.2, 85.1, 86.0, 86.4, 88.2] },
  { name: '学生体质健康优良率', value: '62.7%', trend: -0.8, note: '需关注体育课开足开齐', history: [64.8, 64.5, 64.0, 63.8, 63.5, 62.7] },
  { name: '义务教育巩固率', value: '99.1%', trend: 0.1, note: '保持高位稳定', history: [98.8, 98.9, 99.0, 99.0, 99.0, 99.1] },
]

/** 校情周趋势：近 8 周（实验一中示例） */
export const SCHOOL_TREND: SchoolTrendPoint[] = [
  { week: 'W1', avgScore: 78.2, homework: 88, attention: 79 },
  { week: 'W2', avgScore: 78.9, homework: 89, attention: 80 },
  { week: 'W3', avgScore: 79.6, homework: 90, attention: 82 },
  { week: 'W4', avgScore: 80.1, homework: 91, attention: 83 },
  { week: 'W5', avgScore: 80.8, homework: 90, attention: 82 },
  { week: 'W6', avgScore: 81.0, homework: 89, attention: 81 },
  { week: 'W7', avgScore: 81.4, homework: 88, attention: 80 },
  { week: 'W8', avgScore: 81.9, homework: 87, attention: 79 },
]

export const SCHOOL_ALERTS: SchoolAlert[] = [
  {
    level: 'high',
    title: '高一（7）班物理持续下滑',
    detail: '物理均分环比下降 3.2 分，连续两周作业完成率低于 88%，建议启动骨干教师跟班诊断',
    className: '高一（7）班',
  },
  {
    level: 'mid',
    title: '初二（5）班课堂专注度波动',
    detail: '本周有 3 节课出现集体走神峰值，集中在下午第一节，建议调整课表或引入互动环节',
    className: '初二（5）班',
  },
  {
    level: 'low',
    title: '五（2）班语文阅读失分上升',
    detail: '语文均分微降 0.6 分，阅读概括题型失分率上升，建议布置专项阅读训练',
    className: '五（2）班',
  },
]

export const POLICIES: PolicyDoc[] = [
  {
    id: 'p1',
    title: '关于推进中小学人工智能教育的实施意见',
    issuer: '市教育局',
    date: '2026-06',
    summary: '要求 2027 年前实现 AI 通识课程全覆盖，每校至少配备 1 名专职 AI 教研员。',
  },
  {
    id: 'p2',
    title: '义务教育质量评价指南（修订版）',
    issuer: '省教育厅',
    date: '2026-03',
    summary: '建立以发展素质教育为导向的评价体系，突出过程性评价与增值评价。',
  },
  {
    id: 'p3',
    title: '中小学教师减负清单（2026）',
    issuer: '市教育局',
    date: '2026-01',
    summary: '精简各类检查评比事项 30%，非教学事务进校园实行白名单管理。',
  },
]

export const TEACHERS = [
  { name: '李建国', subject: '物理', school: '实验一中', title: '高级教师', score: 89, trend: 2 },
  { name: '王芳', subject: '数学', school: '实验一中', title: '一级教师', score: 84, trend: -1 },
  { name: '陈静', subject: '语文', school: '育才中学', title: '一级教师', score: 87, trend: 3 },
  { name: '刘强', subject: '化学', school: '育才中学', title: '二级教师', score: 79, trend: 1 },
  { name: '赵敏', subject: '数学', school: '朝阳小学', title: '高级教师', score: 91, trend: 2 },
]

export function findClassLearning(keyword: string): ClassLearning | undefined {
  return CLASS_LEARNING.find(
    (c) => c.className.includes(keyword) || c.classId === keyword,
  )
}
