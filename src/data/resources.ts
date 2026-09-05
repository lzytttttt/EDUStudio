/**
 * 校本资源库索引（v0.5 M3①）
 *
 * 内置演示资源清单，供 searchResources 工具检索；生产环境可接远端资源平台。
 */
export interface ResourceItem {
  id: string
  title: string
  type: '课件' | '教案' | '习题' | '视频' | '实验'
  subject: string
  stage: '初中' | '高中'
  tags: string[]
  desc: string
}

export const RESOURCES: ResourceItem[] = [
  { id: 'r01', title: '二次函数图象与性质（第1课时）', type: '课件', subject: '数学', stage: '初中', tags: ['二次函数', '图象'], desc: '含几何画板动态演示，覆盖开口/对称轴/顶点探究活动' },
  { id: 'r02', title: '二次函数最值问题专题', type: '习题', subject: '数学', stage: '初中', tags: ['二次函数', '最值'], desc: '12 道分层练习，含应用题与含参讨论' },
  { id: 'r03', title: '函数单调性判定（导数法）', type: '教案', subject: '数学', stage: '高中', tags: ['单调性', '导数'], desc: '含定义法与导数法对比、易错点辨析与课堂检测' },
  { id: 'r04', title: '数列求和技巧归纳', type: '课件', subject: '数学', stage: '高中', tags: ['数列', '求和'], desc: '裂项/错位相减/分组求和三类方法与典型例题' },
  { id: 'r05', title: '摩擦力复习课', type: '课件', subject: '物理', stage: '初中', tags: ['摩擦力', '复习'], desc: '静摩擦与滑动摩擦对比实验视频 + 二力平衡例题' },
  { id: 'r06', title: '探究滑动摩擦力影响因素', type: '实验', subject: '物理', stage: '初中', tags: ['摩擦力', '实验'], desc: '控制变量法分组实验方案与数据记录表' },
  { id: 'r07', title: '电磁感应现象与楞次定律', type: '课件', subject: '物理', stage: '高中', tags: ['电磁感应', '楞次定律'], desc: '含 PhET 仿真演示与「来拒去留」口诀归纳' },
  { id: 'r08', title: '牛顿第二定律连接体问题', type: '习题', subject: '物理', stage: '高中', tags: ['牛顿定律', '连接体'], desc: '整体法/隔离法双解对照，8 道梯度题' },
  { id: 'r09', title: '凸透镜成像规律实验', type: '实验', subject: '物理', stage: '初中', tags: ['凸透镜', '成像', '实验'], desc: '光具座操作要点与成像规律记录表' },
  { id: 'r10', title: '记叙文线索梳理微课', type: '视频', subject: '语文', stage: '初中', tags: ['记叙文', '线索'], desc: '8 分钟微课，以课文为例演示线索分析法' },
  { id: 'r11', title: '文言实词 120 词卡片', type: '课件', subject: '语文', stage: '初中', tags: ['文言文', '实词'], desc: '按频次排序的实词卡片，附例句与检测' },
  { id: 'r12', title: '议论文分层论证写作指导', type: '教案', subject: '语文', stage: '高中', tags: ['议论文', '写作'], desc: '「是什么—为什么—怎么办」三层框架与升格示例' },
  { id: 'r13', title: '时态专项：一般过去时 vs 现在完成时', type: '习题', subject: '英语', stage: '初中', tags: ['时态', '语法'], desc: '40 题对比训练，含易错时间标志词归纳' },
  { id: 'r14', title: '读后续写情节设计策略', type: '课件', subject: '英语', stage: '高中', tags: ['续写', '写作'], desc: '五感描写与情绪线工具箱，含评分标准解读' },
  { id: 'r15', title: '质量守恒定律探究', type: '实验', subject: '化学', stage: '初中', tags: ['质量守恒', '实验'], desc: '白磷燃烧/铁钉硫酸铜两组对照实验设计' },
  { id: 'r16', title: '化学平衡图像题突破', type: '视频', subject: '化学', stage: '高中', tags: ['化学平衡', '图像'], desc: '20 分钟专题：速率-时间图与转化率-温度图精讲' },
]

/** 关键词检索（可限定学科）：命中标题/描述/标签 */
export function searchResources(kw: string, subject?: string): ResourceItem[] {
  let hits = RESOURCES
  if (subject) hits = hits.filter((r) => r.subject === subject)
  const k = kw.trim()
  if (!k) return hits
  return hits.filter(
    (r) => r.title.includes(k) || r.desc.includes(k) || r.type.includes(k) || r.tags.some((t) => t.includes(k) || k.includes(t)),
  )
}
