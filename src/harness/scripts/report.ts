/**
 * 报告正文渲染（v0.9.5 P0-A）
 *
 * 独立成模块并由 MockArtifactProvider 动态 import：这是「生成报告时」才需要的代码，
 * 不该占首屏主 chunk 的 120KB 预算（v0.9.4 拆分 LoomPanel 同一取舍）。
 *
 * 判定原则：模板只保留句式骨架，任何数字都不得出现在本文件源码的字面量里——
 * 每个数字都从 ctx 取值并打上溯源标记，见 dataContext.cite。
 */
import type { RegionMetric, SchoolAlert } from '../../data/seed'
import { SCHOOLS } from '../../data/seed'
import { cite, type RenderContext, type RenderFocus } from '../sources/dataContext'

/* 有序列表序号由下标算出而非写死：源码里因此没有数字字面量，
   输出仍是 `1. 2. 3.`，能被 Markdown 渲染器识别成真正的 <ol>。 */
const li = (i: number): string => `${i + 1}. `

const ALERT_LEVEL_CN = { high: '高', mid: '中', low: '低' } as const
const ALERT_ACTION: Record<SchoolAlert['level'], { head: string; action: string }> = {
  high: { head: '限期整改', action: '开展专项督导，两周内提交整改台账并复查' },
  mid: { head: '精准帮扶', action: '安排骨干教师跟班诊断，一周内出诊断报告' },
  low: { head: '巩固提升', action: '纳入区域教研共享，固化常态改进机制' },
}

const sign = (v: number): string => `${v >= 0 ? '+' : ''}${v}`

/** 环比降幅越大风险越高；阈值取百分点一档 */
function metricRisk(m: RegionMetric): string {
  return Math.abs(m.trend) >= 1 ? '高' : '中'
}

/** 按数据渲染完整报告；ctx 为空时返回「数据不可用」说明而非编数字 */
export function renderReport(goal: string, ctx: RenderContext | null): string {
  const metrics = ctx?.metrics ?? []
  const alerts = ctx?.alerts ?? []
  if (!ctx || (metrics.length === 0 && alerts.length === 0)) {
    return `# ${goal}

> 本次生成未取到可用数据，正文指标暂缺。请在设置中检查数据源后重新生成。

*本报告由智教工坊（EDUStudio）Agent 生成。*`
  }

  const rs = ctx.regionCite
  const ss = ctx.schoolCite
  const up = metrics.filter((m) => m.trend > 0)
  const down = metrics.filter((m) => m.trend < 0)
  const best = up.reduce<RegionMetric | null>((a, m) => (!a || m.trend > a.trend ? m : a), null)

  const overall = metrics
    .map((m) => `- **${m.name} ${cite(m.value, rs)}**（环比 ${cite(sign(m.trend), rs)}）—— ${m.note}`)
    .join('\n')

  const wins = [
    `**指标面整体向好** —— 监测的 ${cite(metrics.length, rs)} 项核心指标中 ${cite(up.length, rs)} 项环比上升` +
      (best ? `，其中「${best.name}」提升最明显（环比 ${cite(sign(best.trend), rs)}）` : ''),
    `**监测网络完整** —— 全区 ${cite(ctx.schools.length, rs)} 所中小学纳入监测，${cite(ctx.classCount, ss)} 个班级学情在线更新`,
    alerts.length === 0
      ? '**风险可控** —— 本期未触发结构化预警'
      : `**预警可追溯** —— 本期共 ${cite(alerts.length, ss)} 条校情预警，每条均可下钻到具体班级`,
  ].map((t, i) => `${li(i)}${t}`)

  const rows = [
    ...down.map((m) => `| ${m.name} | ${cite(m.value, rs)} | ${cite(sign(m.trend), rs)} | ${metricRisk(m)} |`),
    ...alerts.map((a) => `| ${a.className} | ${a.title} | — | ${ALERT_LEVEL_CN[a.level]} |`),
  ]
  const problems =
    rows.length > 0
      ? `| 维度 | 现状 | 环比 | 风险等级 |\n| --- | --- | --- | --- |\n${rows.join('\n')}`
      : '本期各项指标与校情预警均在阈值内，暂无突出风险项。'

  const causes = alerts.length
    ? alerts.map((a, i) => `${li(i)}**${a.className}**：${a.detail}`).join('\n')
    : `${li(0)}本期无结构化预警，指标波动处于常态区间。`

  const actions = [
    ...down.map((t) => `**关注指标**：对「${t.name}」（环比 ${sign(t.trend)}）开展专项监测，一月内复查`),
    ...alerts.map((a) => {
      const act = ALERT_ACTION[a.level]
      return `**${act.head}**：针对「${a.className}」${act.action}`
    }),
  ]
  const advice = (actions.length ? actions : ['**常态运行**：按现有节奏推进下阶段监测'])
    .map((t, i) => `${li(i)}${t}`)
    .join('\n')

  const focus = ctx.focus
  const focusCite = focus?.className ? `\n- 聚焦班级：${focus.schoolName} ${focus.className}（${focus.cite}）` : ''

  return `# ${goal}

## 一、总体情况
本期监测的核心指标共 ${cite(metrics.length, rs)} 项，其中 ${cite(up.length, rs)} 项环比上升、${cite(down.length, rs)} 项环比下降。
${overall}
${focus ? renderFocus(focus) : ''}
## 二、主要成效
${wins.join('\n')}

## 三、存在问题
${problems}

## 四、原因分析
${causes}

## 五、下一步建议
${advice}

## 六、数据来源
- 区域指标：${rs}
- 校情预警：${ss}
- 监测范围：全区 ${cite(ctx.schools.length, rs)} 所中小学，与区域看板同一数据源${focusCite}

*文中带虚线下划线的数字均可悬停查看出处。本报告由智教工坊（EDUStudio）Agent 基于区域数据平台生成。*`
}

/** 聚焦范围小节：学校规模 + 班级学情明细（数字同样带溯源标记） */
function renderFocus(focus: RenderFocus): string {
  const school = SCHOOLS.find((s) => s.name === focus.schoolName)
  const head = focus.className ? `${focus.schoolName} ${focus.className}` : focus.schoolName
  const lines: string[] = [`### 聚焦范围：${head}`, '']
  if (school) {
    lines.push(
      `${school.level} · ${school.district} · 教学班 ${cite(school.classes, focus.cite)} 个 · 教师 ${cite(school.teachers, focus.cite)} 人 · 在校生 ${cite(school.students, focus.cite)} 人`,
    )
  }
  const p = focus.profile
  if (p) {
    lines.push(
      '',
      `| 学科 | 均分 | 及格率 | 优秀率 | 环比 |`,
      `| --- | --- | --- | --- | --- |`,
      ...p.scores.map(
        (s) =>
          `| ${s.subject} | ${cite(s.avg, focus.cite)} | ${cite(`${s.passRate}%`, focus.cite)} | ${cite(`${s.excellenceRate}%`, focus.cite)} | ${cite(sign(s.trend), focus.cite)} |`,
      ),
      '',
      `作业完成率 ${cite(`${p.homeworkCompletion}%`, focus.cite)}，课堂专注度 ${cite(p.attentionIndex, focus.cite)}；薄弱点：${
        p.weakPoints.length ? p.weakPoints.join('、') : '无明显薄弱点'
      }`,
    )
  }
  return `${lines.join('\n')}\n`
}
