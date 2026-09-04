import type { ArtifactKind, RoleId } from '../types'

/** 文档模板：按 kind + 角色生成 Markdown 骨架，占位符用 goal/topic 填充 */

export interface ArtifactTemplate {
  /** 模板 ID（模板库选择器用） */
  id: string
  kind: ArtifactKind
  /** 模板库展示名 */
  name: string
  /** 一句话说明 */
  desc: string
  title: (goal: string) => string
  match: string[]
  roles: RoleId[]
  render: (goal: string) => string
}

const lessonPlan: ArtifactTemplate = {
  id: 'lessonPlan',
  kind: 'lessonPlan',
  name: '教学教案',
  desc: '五环节课堂流程 + 分层作业 + 板书设计',
  match: ['教案', '备课', '公开课', '习题课', '课程'],
  roles: ['teacher'],
  title: (g) => `教案 · ${g}`,
  render: (g) => `# ${g}

## 一、教学目标
1. **知识目标**：理解核心概念的定义与数学表达，能复述关键结论
2. **能力目标**：经历探究过程，掌握分析问题的基本方法
3. **素养目标**：体会数形结合与化归思想，发展逻辑推理素养

## 二、教学重难点
- **重点**：核心规律的得出过程与规范表达
- **难点**：变式情境中的迁移应用

## 三、教学过程（45 分钟）

### 环节一 · 情境导入（5 min）
以生活实例引入，激活已有经验，引出课题。

### 环节二 · 探究建构（12 min）
学生分组实验/探究，教师巡视指导；归纳规律并板书关键结论。

### 环节三 · 规范表达（10 min）
例题示范：先审题圈条件，再分步书写，强调易错点。

### 环节四 · 分层练习（13 min）
- **A 组（基础）**：直接套用结论的 2 道题
- **B 组（提升）**：含一个变式条件的 2 道题
- **C 组（挑战）**：综合应用 1 道，供学有余力学生选做

### 环节五 · 小结作业（5 min）
学生自主总结本课三个关键词；作业分层布置并预告下节内容。

## 四、板书设计
\`\`\`
左侧：课题与核心结论
中间：探究过程关键数据
右侧：例题示范与易错警示
\`\`\`

## 五、作业布置
1. 必做：课本对应习题 3 题
2. 选做：一题多解拓展题 1 道
3. 预习：下一节内容，标注疑问`,
}

const report: ArtifactTemplate = {
  id: 'report',
  kind: 'report',
  name: '分析报告',
  desc: '总体情况 + 成效问题 + 建议行动',
  match: ['报告', '简报', '分析', '汇总', '总结', '评审', '讲稿', '方案'],
  roles: ['bureau', 'schoolAdmin', 'teacher'],
  title: (g) => `报告 · ${g}`,
  render: (g) => `# ${g}

## 一、总体情况
本期各项指标总体稳中向好。区域教学质量综合指数 **86.4**（环比 +1.6%），课堂 AI 分析覆盖率升至 **65%**，教师专业发展达标率 **88.2%**。

## 二、主要成效
1. **教学质量稳步提升** —— 12 所监测校中 9 所综合评分上升，占比 75%
2. **数字化应用深化** —— 新增 4 所 AI 试点校，常态化分析课堂 1,240 节
3. **教师队伍优化** —— 骨干教师示范课 36 节，青年教师达标课通过率 92%

## 三、存在问题
| 维度 | 现状 | 环比 | 风险等级 |
| --- | --- | --- | --- |
| 学生体质优良率 | 62.7% | -0.8% | 中 |
| 薄弱班级学科 | 高一（7）班物理 | -3.2 分 | 高 |
| 互动性课堂占比 | 41% | +2% | 低 |

## 四、原因分析
1. 部分学校体育课被挤占，场地与师资存在缺口
2. 薄弱班级教研帮扶启动滞后，作业设计针对性不足
3. 课堂互动策略培训覆盖面有待扩大

## 五、下一步建议
1. **限期整改**：对体质健康下滑学校开展专项督导，一月内复查
2. **精准帮扶**：为高一（7）班配备骨干教师跟班诊断，两周内出诊断报告
3. **推广经验**：将示范课资源纳入区域教研平台，扩大互动性教学培训

---
*本报告由 EDUStudio Agent 基于区域数据平台生成，数据截至本期。*`,
}

const notice: ArtifactTemplate = {
  id: 'notice',
  kind: 'notice',
  name: '公文通知',
  desc: '目标 + 安排 + 要求 + 报送方式',
  match: ['通知', '通报', '纪要', '公文', '督导', '函'],
  roles: ['bureau', 'schoolAdmin'],
  title: (g) => `通知 · ${g}`,
  render: (g) => `# 关于${g}的通知

各中小学：

为贯彻落实相关工作要求，现将有关事项通知如下：

## 一、工作目标
坚持问题导向与结果导向，确保各项要求落实到位，按期完成整改与提升。

## 二、工作安排
1. **自查阶段**（第 1 周）：各校对照要求开展全面自查，形成自查报告
2. **整改阶段**（第 2-3 周）：针对自查发现问题制定整改台账，明确责任人与时限
3. **督导检查**（第 4 周）：教育局组织专项督导组实地核查，抽查比例不低于 30%

## 三、工作要求
1. **提高认识**：各校主要负责人亲自部署，分管领导具体抓落实
2. **如实报送**：自查报告与整改台账须经校长签字确认，于规定时间前报送
3. **强化问责**：对敷衍应付、整改不力的学校予以通报批评

## 四、报送方式
材料电子版发送至教育局基教科邮箱，纸质版一式两份加盖公章报送。

特此通知。

教育局基教科
2026 年 9 月`,
}

const generic: ArtifactTemplate = {
  id: 'generic',
  kind: 'generic',
  name: '通用文档',
  desc: '背景目标 + 关键举措 + 风险预案',
  match: [],
  roles: ['bureau', 'schoolAdmin', 'teacher'],
  title: (g) => `文档 · ${g}`,
  render: (g) => `# ${g}

## 背景与目标
围绕「${g}」，明确当前的基础条件、预期成果与关键约束。

## 主要内容
1. **现状梳理**：结合相关数据与政策要求，梳理已有基础与差距
2. **关键举措**：分阶段列出可执行动作，明确责任主体与时间节点
3. **风险预案**：识别主要风险点并给出应对策略

## 结论与建议
建议按「先试点、再推广、后评估」的节奏推进，每阶段设置检查点，确保目标可达。

---
*本文档由 EDUStudio Agent 生成，可在右侧直接编辑修改。*`,
}

export const ARTIFACT_TEMPLATES: ArtifactTemplate[] = [lessonPlan, report, notice, generic]

export function matchTemplate(goal: string, role: RoleId): ArtifactTemplate {
  const hit = ARTIFACT_TEMPLATES.find(
    (t) => t.roles.includes(role) && t.match.some((k) => goal.includes(k)),
  )
  return hit ?? generic
}

/** 模板库：按角色返回可选模板（v0.3 专项 ②） */
export function listTemplates(role: RoleId): ArtifactTemplate[] {
  return ARTIFACT_TEMPLATES.filter((t) => t.roles.includes(role))
}

/** 按 ID 取模板（找不到回退 generic） */
export function getTemplateById(id: string): ArtifactTemplate {
  return ARTIFACT_TEMPLATES.find((t) => t.id === id) ?? generic
}
