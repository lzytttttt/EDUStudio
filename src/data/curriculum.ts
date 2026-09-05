/**
 * 课标知识点索引（v0.5 M3①）
 *
 * 轻量内置课标摘要（覆盖主要学科/学段的高频考点），供 searchCurriculum 工具检索。
 * 生产环境可替换为远端课标服务；此处保证离线可用。
 */
export interface CurriculumPoint {
  id: string
  subject: '语文' | '数学' | '英语' | '物理' | '化学'
  stage: '初中' | '高中'
  unit: string
  point: string
  requirement: string
  keywords: string[]
}

export const CURRICULUM: CurriculumPoint[] = [
  { id: 'c01', subject: '语文', stage: '初中', unit: '现代文阅读', point: '记叙文线索与主旨', requirement: '梳理行文线索，概括主旨并结合作者意图评价', keywords: ['记叙文', '线索', '主旨'] },
  { id: 'c02', subject: '语文', stage: '初中', unit: '古诗文', point: '文言实词虚词辨析', requirement: '积累常见实词虚词，准确翻译文言语句', keywords: ['文言文', '翻译', '实词'] },
  { id: 'c03', subject: '语文', stage: '高中', unit: '论述类文本', point: '论点论据与论证方法', requirement: '分析文本论证结构，评价论据与论点的逻辑关系', keywords: ['论述文', '论证', '论点'] },
  { id: 'c04', subject: '语文', stage: '高中', unit: '写作', point: '议论文分层论证', requirement: '围绕中心论点分层展开论证，做到观点明确、论据充分', keywords: ['议论文', '写作', '论证'] },
  { id: 'c05', subject: '数学', stage: '初中', unit: '方程与不等式', point: '一元二次方程解法', requirement: '掌握配方法、公式法与因式分解法，能根据判别式讨论根的情况', keywords: ['方程', '判别式', '求根'] },
  { id: 'c06', subject: '数学', stage: '初中', unit: '函数', point: '二次函数图象与性质', requirement: '理解开口方向、对称轴、顶点坐标与增减性的关系', keywords: ['二次函数', '抛物线', '顶点'] },
  { id: 'c07', subject: '数学', stage: '初中', unit: '几何', point: '全等与相似三角形判定', requirement: '掌握判定定理，能证明线段成比例与角相等', keywords: ['三角形', '全等', '相似'] },
  { id: 'c08', subject: '数学', stage: '高中', unit: '函数与导数', point: '函数单调性判定', requirement: '能用定义与导数判定单调性，并求单调区间', keywords: ['单调性', '导数', '单调区间'] },
  { id: 'c09', subject: '数学', stage: '高中', unit: '数列', point: '等差等比数列通项与求和', requirement: '掌握通项公式与前 n 项和公式，能建模递推问题', keywords: ['数列', '等差', '等比', '求和'] },
  { id: 'c10', subject: '数学', stage: '高中', unit: '解析几何', point: '直线与圆锥曲线位置关系', requirement: '会联立方程判别位置关系，能处理弦长与中点弦问题', keywords: ['椭圆', '抛物线', '弦长'] },
  { id: 'c11', subject: '数学', stage: '高中', unit: '概率统计', point: '古典概型与分布列', requirement: '会计算古典概型概率，能写出离散型随机变量分布列并求期望', keywords: ['概率', '分布列', '期望'] },
  { id: 'c12', subject: '英语', stage: '初中', unit: '阅读理解', point: '主旨大意与细节定位', requirement: '能概括语篇主旨，依据题干关键词定位细节信息', keywords: ['阅读', '主旨', '细节题'] },
  { id: 'c13', subject: '英语', stage: '初中', unit: '语法', point: '时态与从句基础', requirement: '正确使用常用时态，掌握宾语从句与状语从句的引导词', keywords: ['时态', '从句', '语法'] },
  { id: 'c14', subject: '英语', stage: '高中', unit: '完形与语法填空', point: '语境词汇与语法填空', requirement: '结合语境选择词汇，掌握词性转换与固定搭配', keywords: ['完形', '语法填空', '词性'] },
  { id: 'c15', subject: '英语', stage: '高中', unit: '写作', point: '应用文与读后续写', requirement: '能按格式完成书信/通知写作，读后续写情节合理、语言连贯', keywords: ['写作', '续写', '应用文'] },
  { id: 'c16', subject: '物理', stage: '初中', unit: '力学', point: '摩擦力', requirement: '区分静摩擦与滑动摩擦，会用二力平衡分析摩擦力大小', keywords: ['摩擦力', '二力平衡', '力学'] },
  { id: 'c17', subject: '物理', stage: '初中', unit: '电学', point: '欧姆定律与电路分析', requirement: '会用欧姆定律分析串并联电路，能进行电表读数与计算', keywords: ['欧姆定律', '电路', '串并联'] },
  { id: 'c18', subject: '物理', stage: '初中', unit: '光学', point: '凸透镜成像规律', requirement: '掌握物距与像距关系，能判断成像性质与应用', keywords: ['凸透镜', '成像', '光学'] },
  { id: 'c19', subject: '物理', stage: '高中', unit: '电磁学', point: '电磁感应与楞次定律', requirement: '会用法拉第定律求感应电动势，能用楞次定律判断感应电流方向', keywords: ['电磁感应', '楞次定律', '感应电动势'] },
  { id: 'c20', subject: '物理', stage: '高中', unit: '力学', point: '牛顿运动定律应用', requirement: '能结合受力分析列牛顿第二定律方程，处理连接体与斜面问题', keywords: ['牛顿定律', '受力分析', '连接体'] },
  { id: 'c21', subject: '物理', stage: '高中', unit: '能量', point: '功能关系与机械能守恒', requirement: '会分析做功与能量转化，能用机械能守恒定律解题', keywords: ['机械能', '守恒', '做功'] },
  { id: 'c22', subject: '化学', stage: '初中', unit: '物质构成', point: '分子原子与化学式', requirement: '理解分子原子区别，会根据化学式计算元素质量分数', keywords: ['分子', '原子', '化学式'] },
  { id: 'c23', subject: '化学', stage: '初中', unit: '化学反应', point: '质量守恒与化学方程式', requirement: '能配平化学方程式，依据质量守恒进行计算', keywords: ['质量守恒', '方程式', '配平'] },
  { id: 'c24', subject: '化学', stage: '高中', unit: '化学反应原理', point: '化学平衡移动', requirement: '理解勒夏特列原理，能判断平衡移动方向与转化率变化', keywords: ['化学平衡', '勒夏特列', '转化率'] },
]

/** 关键词检索：命中知识点/单元/要求/关键词标签 */
export function searchCurriculumPoints(kw: string): CurriculumPoint[] {
  const k = kw.trim()
  if (!k) return []
  return CURRICULUM.filter(
    (c) =>
      c.point.includes(k) ||
      c.unit.includes(k) ||
      c.requirement.includes(k) ||
      c.subject.includes(k) ||
      c.keywords.some((w) => w.includes(k) || k.includes(w)),
  )
}
