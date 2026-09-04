import type { RoleId, ToolDef, ToolResult } from '../../types'
import {
  CLASS_LEARNING,
  REGION_METRICS,
  SCHOOL_ALERTS,
  SCHOOLS,
  TEACHERS,
  POLICIES,
  findClassLearning,
} from '../../../data/seed'

const ALL: RoleId[] = ['bureau', 'schoolAdmin', 'teacher']

/** 学情查询：按班级关键词返回成绩/作业/专注度聚合 */
export const queryClassLearning: ToolDef = {
  name: 'queryClassLearning',
  label: '学情查询',
  description: '按班级查询成绩均分、作业完成率、课堂专注度与薄弱知识点',
  roles: ['teacher', 'schoolAdmin'],
  async run(args) {
    const kw = String(args.className ?? args.keyword ?? '高一（3）班')
    const c = findClassLearning(kw) ?? CLASS_LEARNING[0]
    const result: ToolResult = {
      summary: `${c.className}：均分 ${c.scores.map((s) => `${s.subject} ${s.avg}`).join(' / ')}，作业完成率 ${c.homeworkCompletion}%，专注度 ${c.attentionIndex}`,
      payload: c,
    }
    return result
  },
}

/** 校情统计：学校规模、预警、教师队伍 */
export const querySchoolStats: ToolDef = {
  name: 'querySchoolStats',
  label: '校情统计',
  description: '查询学校规模、教学质量预警与教师队伍概况',
  roles: ['schoolAdmin'],
  async run() {
    const s = SCHOOLS[0]
    return {
      summary: `${s.name}（${s.level}）：${s.classes} 个教学班，教师 ${s.teachers} 人，学生 ${s.students} 人；当前预警 ${SCHOOL_ALERTS.length} 项`,
      payload: { school: s, alerts: SCHOOL_ALERTS, teachers: TEACHERS },
    }
  },
}

/** 区域数据：教育局区域指标 */
export const queryRegionData: ToolDef = {
  name: 'queryRegionData',
  label: '区域数据',
  description: '查询区域教学质量指数、覆盖率、师资达标率等核心指标',
  roles: ['bureau'],
  async run() {
    return {
      summary: `区域综合指数 ${REGION_METRICS[0].value}（环比 +${REGION_METRICS[0].trend}%），AI 分析覆盖率 ${REGION_METRICS[1].value}`,
      payload: { metrics: REGION_METRICS, schools: SCHOOLS },
    }
  },
}

/** 政策检索 */
export const searchPolicy: ToolDef = {
  name: 'searchPolicy',
  label: '政策检索',
  description: '检索教育政策文件标题、发文单位与要点摘要',
  roles: ['bureau', 'schoolAdmin'],
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
  async run(args) {
    const topic = String(args.topic ?? '新授课')
    return {
      summary: `已生成《${topic}》教案骨架：教学目标 3 条、重难点 2 项、教学过程 5 环节`,
      payload: { topic, sections: ['教学目标', '教学重难点', '教学过程', '板书设计', '作业布置'] },
    }
  },
}

/** 命制试题 */
export const genQuiz: ToolDef = {
  name: 'genQuiz',
  label: '命制试题',
  description: '按知识点与难度生成试题组（选择/填空/解答）',
  roles: ['teacher'],
  async run(args) {
    const point = String(args.knowledgePoint ?? '综合')
    return {
      summary: `围绕「${point}」命制试题 5 道：单选 2、填空 2、解答 1，难度 0.65`,
      payload: { knowledgePoint: point, counts: { single: 2, blank: 2, solve: 1 } },
    }
  },
}

/** 起草通知 */
export const draftNotice: ToolDef = {
  name: 'draftNotice',
  label: '起草通知',
  description: '按事项起草行政通知/会议纪要文稿',
  roles: ['schoolAdmin', 'bureau'],
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
]

export const TEACHER_TOOLS = ['queryClassLearning', 'genLessonPlan', 'genQuiz', 'analyzeClass']
export const SCHOOL_ADMIN_TOOLS = ['queryClassLearning', 'querySchoolStats', 'analyzeClass', 'draftNotice', 'searchPolicy']
export const BUREAU_TOOLS = ['queryRegionData', 'searchPolicy', 'draftNotice']
