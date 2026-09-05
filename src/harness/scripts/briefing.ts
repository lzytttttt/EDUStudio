import type { BriefingCard, RoleId } from '../types'

/** 按角色的今日简报卡片剧本（Mock 数据源，采纳卡片 → openTask 注入工作台） */

const teacherDeck: BriefingCard[] = [
  {
    id: 't1', role: 'teacher', type: 'insight', tag: '洞察',
    title: '高一（3）班「函数单调性」掌握率仅 61%，建议本周加一节习题课',
    body: '基于近两次测验与作业批改数据，该知识点失分集中在「判定定理的证明书写」与「复合函数单调区间」。',
    extra: 'chart',
    payload: {
      kind: 'chart', title: '近期知识点掌握率',
      bars: [
        { label: '单调性', value: 61, display: '61%', peak: true },
        { label: '奇偶性', value: 78, display: '78%' },
        { label: '指数运算', value: 84, display: '84%' },
        { label: '集合', value: 90, display: '90%' },
      ],
    },
    confidence: 3, source: '学情分析 · 近14天',
    action: { kind: 'openTask', goal: '针对高一（3）班函数单调性薄弱点，设计一节习题课的分层练习' },
  },
  {
    id: 't2', role: 'teacher', type: 'creation', tag: '创作',
    title: '《牛顿第二定律》教案草稿已备好，含 5 个教学环节',
    body: '按你的授课习惯生成：情境导入 5min → 实验探究 12min → 规律建构 10min → 分层练习 12min → 小结 3min，附板书设计。',
    extra: 'editable',
    payload: { kind: 'editable', text: '教学目标：\n1. 理解牛顿第二定律的内容与数学表达\n2. 会用 F=ma 分析两类基本问题\n3. 经历实验探究，体会控制变量法\n\n教学重点：F=ma 的矢量性与瞬时性\n教学难点：斜面模型中的受力分解' },
    confidence: 2, source: 'AI 生成 · 基于授课偏好',
    action: { kind: 'openTask', goal: '完善《牛顿第二定律》教案，补充例题与作业分层设计' },
  },
  {
    id: 't3', role: 'teacher', type: 'todo', tag: '待办',
    title: '今天有 3 件教学事务需要处理',
    body: '已按优先级排序，点击勾选完成：',
    extra: 'todos',
    payload: {
      kind: 'todos',
      todos: [
        { text: '批改高一（3）班周末作业（46 份）', meta: '截止 18:00', done: false },
        { text: '提交月度教研组听课记录', meta: '教务处 · 今天截止', done: false },
        { text: '回复 3 位家长关于月考成绩的咨询', meta: '家校沟通', done: false },
      ],
    },
    confidence: 3, source: '日程同步 · 实时',
  },
  {
    id: 't4', role: 'teacher', type: 'decision', tag: '决策',
    title: '下周公开课选哪个课题？',
    body: '教研组要求本周五前上报。结合教学进度与你的优势维度，两个候选：',
    extra: 'options',
    payload: {
      kind: 'options',
      options: [
        { text: '《摩擦力》实验探究课', sub: '互动性维度是你的强项，易出彩' },
        { text: '《超重与失重》情境课', sub: '可结合航天热点，创新性加分' },
      ],
    },
    confidence: 2, source: '教研安排 · 刚刚',
    action: { kind: 'openTask', goal: '为公开课《摩擦力》设计完整教案与课件大纲' },
  },
  {
    id: 't5', role: 'teacher', type: 'data', tag: '数据',
    title: '你班本周课堂专注度 86，高于年级均值 7 分',
    body: '下午第一节课专注度偏低（72），主要走神时段集中在 14:10-14:25，建议该时段安排互动性环节。',
    extra: 'expandable',
    payload: {
      kind: 'expandable', title: '查看分时段专注度',
      content: '• 上午 2 节：均值 91（优）<br>• 下午第一节：72（需关注）<br>• 下午第二节：84（良）<br>• 建议：下午第一节前 15 分钟安排提问或小组任务，唤醒注意力',
    },
    confidence: 3, source: '课堂分析 · 本周',
  },
  {
    id: 't6', role: 'teacher', type: 'question', tag: '提问',
    title: '需要我帮你把月考成绩生成家长会讲稿吗？',
    body: '我可以按「整体情况 → 进步亮点 → 分层建议 → 家校配合」四段生成，数据自动引用班级真实成绩。',
    confidence: 1, source: '主动建议 · 现在',
    action: { kind: 'openTask', goal: '基于高一（3）班月考成绩生成家长会讲稿' },
  },
  {
    id: 't7', role: 'teacher', type: 'decision', tag: '决策',
    title: '本周分层作业按什么比例布置？',
    body: '上周基础题正确率 74%，提高题仅 52%。教研组建议动态调整两层比例，选定后自动生成作业单：',
    extra: 'options',
    payload: {
      kind: 'options',
      options: [
        { text: '基础 70% + 提高 30%', sub: '巩固为主，适合正确率下滑周' },
        { text: '基础 50% + 提高 50%', sub: '均衡推进，适合状态平稳期' },
        { text: '基础 40% + 提高 60%', sub: '拔高优先，需配合课后答疑' },
      ],
    },
    confidence: 2, source: '作业分析 · 本周',
    action: { kind: 'openTask', goal: '按选定比例生成分层作业单' },
    link: { kind: 'task', label: '查看上周作业任务', goal: '回顾上周分层作业完成情况并生成对比小结' },
  },
  {
    id: 't8', role: 'teacher', type: 'creation', tag: '创作',
    title: '家长会发言提纲草稿已备好，可直接修改',
    body: '按「成绩概览 → 进步亮点 → 分层建议 → 家校配合」四段生成，引用班级真实成绩数据，点击正文即可编辑。',
    extra: 'editable',
    payload: { kind: 'editable', text: '各位家长：\n\n本次月考班级均分 82.4，较上次提升 1.8 分…\n\n一、整体情况\n二、进步亮点\n三、分层建议\n四、家校配合' },
    confidence: 2, source: 'AI 生成 · 基于月考数据',
    action: { kind: 'openTask', goal: '完善家长会发言稿并生成配套 PPT 大纲' },
    link: { kind: 'source', label: '查看成绩数据来源' },
  },
]

const schoolAdminDeck: BriefingCard[] = [
  {
    id: 'a1', role: 'schoolAdmin', type: 'insight', tag: '洞察',
    title: '高一（7）班物理连续两周下滑，需启动教研帮扶',
    body: '均分环比 -3.2，作业完成率 85%（低于校线 90%），课堂专注度 74 为全年级最低。建议安排骨干教师跟班诊断。',
    extra: 'chart',
    payload: {
      kind: 'chart', title: '高一各班物理均分趋势',
      bars: [
        { label: '3班', value: 82, display: '82.4' },
        { label: '7班', value: 74, display: '74.1', peak: true },
        { label: '年级', value: 79, display: '79.2' },
      ],
    },
    confidence: 3, source: '教学质量监测 · 本周',
    action: { kind: 'openTask', goal: '起草高一（7）班物理教学质量帮扶方案' },
  },
  {
    id: 'a2', role: 'schoolAdmin', type: 'todo', tag: '待办',
    title: '本周管理侧 3 项关键事务',
    body: '从教务系统与日程提取，按紧急度排序：',
    extra: 'todos',
    payload: {
      kind: 'todos',
      todos: [
        { text: '审核期中考试命题双向细目表', meta: '教务 · 周三前', done: false },
        { text: '确认市局 AI 教育试点校申报材料', meta: '市局通知 · 周五截止', done: false },
        { text: '旁听初二年级 2 节常态课并评课', meta: '教研安排', done: false },
      ],
    },
    confidence: 3, source: '教务系统 · 实时',
  },
  {
    id: 'a3', role: 'schoolAdmin', type: 'decision', tag: '决策',
    title: '教师例会是否改为双周制？',
    body: '数据显示本学期单周例会中 42% 议题可用文档异步传达。改为双周制预计每周为教师释放 1.5 小时。',
    extra: 'options',
    payload: {
      kind: 'options',
      options: [
        { text: '改为双周例会 + 周报文档', sub: '教师满意度预计提升，需 1 个月试运行' },
        { text: '维持单周例会', sub: '保持现状，风险最低' },
      ],
    },
    confidence: 2, source: '治理分析 · 本学期',
    action: { kind: 'openTask', goal: '起草教师例会改革试运行方案（双周制）' },
  },
  {
    id: 'a4', role: 'schoolAdmin', type: 'data', tag: '数据',
    title: '本月评课覆盖 23 节课，优良率 78%',
    body: '互动性维度均分 79 为最弱项；李建国老师规范性 93 可作为示范课资源。',
    extra: 'expandable',
    payload: {
      kind: 'expandable', title: '查看五维评分明细',
      content: '• 规范性 88 ｜ 目标达成 85 ｜ 互动性 79 ｜ 创新性 81 ｜ 课堂管理 86<br>• 建议：互动性弱的课堂多采用「提问链 + 小组互评」结构',
    },
    confidence: 3, source: '评课系统 · 本月',
  },
  {
    id: 'a5', role: 'schoolAdmin', type: 'creation', tag: '创作',
    title: '市局 AI 试点校申报书初稿已生成',
    body: '按申报模板完成：建设基础、目标路径、保障机制三大部分，引用了本校课堂分析覆盖率与教师发展数据。',
    extra: 'editable',
    payload: { kind: 'editable', text: '一、建设基础\n本校已实现 65% 课堂的 AI 常态化分析，教师专业发展达标率 88.2%…\n\n二、目标与路径\n2027 年前实现 AI 通识课程全覆盖…' },
    confidence: 2, source: 'AI 生成 · 基于申报模板',
    action: { kind: 'openTask', goal: '完善市局 AI 试点校申报书并核对数据引用' },
  },
  {
    id: 'a6', role: 'schoolAdmin', type: 'question', tag: '提问',
    title: '要我生成本月的治理简报吗？',
    body: '将汇总教学质量、教师发展、异常预警三部分，预警项附证据链与建议动作，可直接用于行政会。',
    confidence: 1, source: '主动建议 · 现在',
    action: { kind: 'openTask', goal: '生成本月学校治理简报（含预警与建议）' },
  },
  {
    id: 'a7', role: 'schoolAdmin', type: 'todo', tag: '待办',
    title: '教研帮扶跟进清单（3 项）',
    body: '上周例会布置的跟进事项，勾选后状态自动保存：',
    extra: 'todos',
    payload: {
      kind: 'todos',
      todos: [
        { text: '确认高一（7）班物理帮扶教师人选', meta: '教研处 · 本周', done: false },
        { text: '收集帮扶方案初稿意见', meta: '截止周四', done: false },
        { text: '安排帮扶效果首次周测', meta: '教务系统', done: false },
      ],
    },
    confidence: 3, source: '例会纪要 · 上周',
    link: { kind: 'task', label: '打开帮扶方案任务', goal: '跟进高一（7）班物理教学质量帮扶方案执行情况' },
  },
  {
    id: 'a8', role: 'schoolAdmin', type: 'insight', tag: '洞察',
    title: '作业完成率低于校线的班级增至 4 个',
    body: '较上周新增 1 个。作业平台数据显示主因是布置量与难度梯度失衡，建议结合分层作业模板整改。',
    confidence: 3, source: '作业平台 · 本周',
    action: { kind: 'openTask', goal: '起草作业完成率整改通知与分层作业模板' },
    link: { kind: 'source', label: '查看校情数据来源' },
  },
]

const bureauDeck: BriefingCard[] = [
  {
    id: 'b1', role: 'bureau', type: 'data', tag: '数据',
    title: '区域教学质量综合指数 86.4，环比 +1.6',
    body: '12 所中小学中 9 所上升；课堂 AI 分析覆盖率升至 65%，本学期新增 4 所试点校。',
    extra: 'chart',
    payload: {
      kind: 'chart', title: '区域核心指标环比',
      bars: [
        { label: '综合指数', value: 86, display: '86.4' },
        { label: '覆盖率', value: 65, display: '65%', peak: true },
        { label: '师资达标', value: 88, display: '88.2%' },
        { label: '体质优良', value: 63, display: '62.7%' },
      ],
    },
    confidence: 3, source: '区域数据平台 · 本月',
    action: { kind: 'openTask', goal: '起草本季度区域教学质量分析报告' },
  },
  {
    id: 'b2', role: 'bureau', type: 'insight', tag: '洞察',
    title: '学生体质健康优良率连续两季微降，建议专项督导',
    body: '62.7%（环比 -0.8%），抽样显示体育课被挤占是主因，涉及 3 所学校。',
    extra: 'expandable',
    payload: {
      kind: 'expandable', title: '查看涉及学校',
      content: '• 育才中学：初三体育课周均被挤占 1.2 节<br>• 朝阳小学：场地受限，雨天课程无法开展<br>• 城北实验学校：师资缺口 2 人<br>• 建议：纳入下月督导清单，实行限期整改',
    },
    confidence: 3, source: '体质监测 · 本季度',
    action: { kind: 'openTask', goal: '起草学生体质健康专项督导通知' },
  },
  {
    id: 'b3', role: 'bureau', type: 'todo', tag: '待办',
    title: '本周科室 3 项重点任务',
    body: '来自任务台账与公文系统：',
    extra: 'todos',
    payload: {
      kind: 'todos',
      todos: [
        { text: '汇总各校 AI 教育试点申报材料', meta: '周五前报局领导', done: false },
        { text: '起草《教师减负清单》落实情况通报', meta: '依据 2026 减负清单', done: false },
        { text: '准备下月督导检查评估指标', meta: '督导室协作', done: false },
      ],
    },
    confidence: 3, source: '任务台账 · 实时',
  },
  {
    id: 'b4', role: 'bureau', type: 'decision', tag: '决策',
    title: 'AI 通识课程师资培训走哪条路径？',
    body: '依据《推进中小学人工智能教育的实施意见》，2027 年前需全覆盖。两条路径供权衡：',
    extra: 'options',
    payload: {
      kind: 'options',
      options: [
        { text: '集中轮训骨干 + 校内二级培训', sub: '成本低，覆盖快，质量依赖二级培训' },
        { text: '分批脱产深度培训', sub: '质量高，但需协调教学安排与经费' },
      ],
    },
    confidence: 2, source: '政策分析 · 刚刚',
    action: { kind: 'openTask', goal: '起草 AI 通识课程师资培训实施方案' },
  },
  {
    id: 'b5', role: 'bureau', type: 'creation', tag: '创作',
    title: '《教师减负清单》落实情况通报初稿已备好',
    body: '按公文格式完成：总体情况、典型做法、存在问题、下一步要求四部分，数据引自各校填报台账。',
    extra: 'editable',
    payload: { kind: 'editable', text: '各中小学：\n\n为贯彻落实《中小学教师减负清单（2026）》，现将上半年落实情况通报如下…\n\n一、总体情况\n全区精简检查评比事项 30%…' },
    confidence: 2, source: 'AI 生成 · 基于公文模板',
    action: { kind: 'openTask', goal: '完善《教师减负清单》落实情况通报' },
  },
  {
    id: 'b6', role: 'bureau', type: 'question', tag: '提问',
    title: '需要我汇总各校试点申报并生成评审意见吗？',
    body: '我会按申报材料完整性、建设基础、方案可行性三个维度打分并排序，输出评审意见表。',
    confidence: 1, source: '主动建议 · 现在',
    action: { kind: 'openTask', goal: '汇总各校 AI 试点申报材料并生成评审意见' },
  },
  {
    id: 'b7', role: 'bureau', type: 'decision', tag: '决策',
    title: '下月督导检查优先排哪个专项？',
    body: '体质健康下滑与作业超量两条线索均已具备证据链，督导室只能承接一个专项，选定后自动生成督导方案：',
    extra: 'options',
    payload: {
      kind: 'options',
      options: [
        { text: '体质健康专项督导', sub: '连续两季下滑，涉及 3 所学校' },
        { text: '作业管理专项督导', sub: '超量投诉环比 +40%，家长关注度高' },
      ],
    },
    confidence: 2, source: '督导台账 · 刚刚',
    action: { kind: 'openTask', goal: '按选定专项起草督导检查实施方案' },
    link: { kind: 'favorite', label: '回看收藏的相关卡片' },
  },
  {
    id: 'b8', role: 'bureau', type: 'data', tag: '数据',
    title: '区域师资达标率 88.2%，距 2027 目标还差 6.8 个百分点',
    body: '缺口集中在音体美与信息科技学科，12 所学校中 5 所存在结构性缺编，建议纳入编制动态调整测算。',
    extra: 'expandable',
    payload: {
      kind: 'expandable', title: '查看缺编学校明细',
      content: '• 城北实验学校：信息科技缺 2 人<br>• 朝阳小学：音乐缺 1 人<br>• 育才中学：体育缺 1 人<br>• 建议：优先通过区域走教与银龄讲学补缺口',
    },
    confidence: 3, source: '师资台账 · 本月',
    action: { kind: 'openTask', goal: '起草区域师资缺口补充方案' },
    link: { kind: 'source', label: '查看区域数据来源' },
  },
]

export const BRIEFING_DECKS: Record<RoleId, BriefingCard[]> = {
  teacher: teacherDeck,
  schoolAdmin: schoolAdminDeck,
  bureau: bureauDeck,
}
