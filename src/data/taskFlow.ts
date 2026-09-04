/**
 * 下发任务链种子数据（v0.4 M2③）：局→校、校→教师的通知下发与回执跟踪。
 * 状态流转：pending（待接收）→ acknowledged（已回执）→ submitted（已提交成果）。
 */
import type { RoleId } from '../harness/types'

export type TaskFlowStatus = 'pending' | 'acknowledged' | 'submitted'

export interface TaskFlowReceipt {
  id: string
  /** 接收方显示名（学校名 / 教师名） */
  target: string
  targetRole: 'schoolAdmin' | 'teacher'
  status: TaskFlowStatus
  /** 最近一次状态变更时间 */
  updatedAt?: number
  /** 提交成果时的说明 */
  note?: string
}

export interface TaskFlow {
  id: string
  title: string
  content: string
  /** 下发方显示名 */
  from: string
  fromRole: RoleId
  issuedAt: number
  /** 截止时间（展示文本） */
  deadline: string
  receipts: TaskFlowReceipt[]
}

export const TASK_FLOW_STATUS_LABEL: Record<TaskFlowStatus, string> = {
  pending: '待接收',
  acknowledged: '已回执',
  submitted: '已提交',
}

const DAY = 24 * 60 * 60 * 1000

export const SEED_TASK_FLOWS: TaskFlow[] = [
  {
    id: 'tf-1',
    title: '关于开展期中教学质量分析的通知',
    content:
      '各校请于本周内完成期中考试质量分析，重点梳理各年级薄弱知识点与改进措施，分析报告通过工作台提交至区教研室。',
    from: '区教育局',
    fromRole: 'bureau',
    issuedAt: Date.now() - 2 * DAY,
    deadline: '本周五 17:00',
    receipts: [
      { id: 'r1', target: '实验一中', targetRole: 'schoolAdmin', status: 'submitted', updatedAt: Date.now() - DAY, note: '已完成三个年级质量分析，改进措施 12 条' },
      { id: 'r2', target: '育才中学', targetRole: 'schoolAdmin', status: 'acknowledged', updatedAt: Date.now() - DAY / 2 },
      { id: 'r3', target: '朝阳小学', targetRole: 'schoolAdmin', status: 'pending' },
    ],
  },
  {
    id: 'tf-2',
    title: '区域教研活动报名',
    content: '下周一上午 9:00 在区教研中心举行「基于学情数据的精准教学」专题教研，请各校选派 2 名骨干教师参加。',
    from: '区教育局',
    fromRole: 'bureau',
    issuedAt: Date.now() - DAY,
    deadline: '本周四 12:00',
    receipts: [
      { id: 'r4', target: '实验一中', targetRole: 'schoolAdmin', status: 'acknowledged', updatedAt: Date.now() - DAY / 4 },
      { id: 'r5', target: '育才中学', targetRole: 'schoolAdmin', status: 'pending' },
    ],
  },
  {
    id: 'tf-3',
    title: '高一（3）班学情跟踪表填报',
    content: '请各位班主任于本周内完成本班学情跟踪表填报，重点关注课堂专注度下降的学生，并给出个别辅导计划。',
    from: '实验一中',
    fromRole: 'schoolAdmin',
    issuedAt: Date.now() - DAY / 2,
    deadline: '本周日 20:00',
    receipts: [
      { id: 'r6', target: '李建国', targetRole: 'teacher', status: 'submitted', updatedAt: Date.now() - DAY / 6, note: '已填报，3 名学生需个别辅导' },
      { id: 'r7', target: '王芳', targetRole: 'teacher', status: 'acknowledged', updatedAt: Date.now() - DAY / 8 },
    ],
  },
]
