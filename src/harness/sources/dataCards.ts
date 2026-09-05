/**
 * 数据驱动简报卡（v0.5 M1②④）
 *
 * 从 SourceProvider 取真实数据（CSV 导入 / 远端平台）生成「洞察/数据」卡片，
 * 插入简报卡组最前。仅当数据源非 seed（即有导入数据或远端数据）时生成，
 * 纯演示模式下保持原剧本卡组不变。
 */
import type { BriefingCard, RoleId } from '../types'
import { getSourceProvider, type SourceMeta } from './index'
import { useDataStore } from '../../stores/dataStore'

/** 卡片 id 前缀：稳定 id 保证「跳过/收藏」决策在重载后仍生效 */
const ID_PREFIX = 'dc-'

function makeCard(partial: Omit<BriefingCard, 'confidence' | 'source'> & { source: string }): BriefingCard {
  return { confidence: 3, ...partial }
}

function metaSource(meta: SourceMeta): string {
  const time = new Date(meta.fetchedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  return `${meta.label} · ${time}`
}

/** 教师卡：最新导入班级的学情洞察（薄弱学科 + 均分图） */
function teacherCard(): BriefingCard | null {
  const profiles = useDataStore.getState().profiles
  const p = profiles[0]
  if (!p) return null
  const sorted = [...p.scores].sort((a, b) => a.avg - b.avg)
  const weakest = sorted[0]
  const bars = p.scores.map((s) => ({
    label: s.subject,
    value: Math.round(s.avg),
    display: String(s.avg),
    peak: s.subject === weakest?.subject,
  }))
  const weakText = sorted.slice(0, 2).map((s) => `「${s.subject}」均分 ${s.avg}`).join('、')
  return makeCard({
    id: `${ID_PREFIX}class-${p.classId}`,
    role: 'teacher',
    type: 'insight',
    tag: '洞察',
    title: `${p.className}「${weakest?.subject ?? '综合'}」均分 ${weakest?.avg ?? '-'}，建议优先补强`,
    body: `基于你导入的成绩数据（${p.studentCount} 人）：${weakText} 相对薄弱；作业完成率 ${p.homeworkCompletion}%。建议本周安排针对性练习。`,
    extra: 'chart',
    payload: { kind: 'chart', title: '各科均分（导入数据）', bars },
    source: metaSource({ fetchedAt: p.importedAt, kind: 'csv', label: `本地导入 · ${p.fileName}` }),
    action: { kind: 'openTask', goal: `针对${p.className}${weakest ? `「${weakest.subject}」` : ''}薄弱点，设计一节分层练习课` },
  })
}

/** 校长卡：导入班级聚合（多班对比，最弱班高亮） */
function schoolAdminCard(): BriefingCard | null {
  const profiles = useDataStore.getState().profiles
  if (profiles.length === 0) return null
  if (profiles.length === 1) {
    const p = profiles[0]
    const sorted = [...p.scores].sort((a, b) => a.avg - b.avg)
    return makeCard({
      id: `${ID_PREFIX}class-${p.classId}`,
      role: 'schoolAdmin',
      type: 'insight',
      tag: '洞察',
      title: `${p.className}「${sorted[0]?.subject ?? '综合'}」均分偏低，建议教研跟进`,
      body: `导入数据显示：${sorted.slice(0, 2).map((s) => `「${s.subject}」均分 ${s.avg}`).join('、')}，作业完成率 ${p.homeworkCompletion}%。建议安排学科组诊断。`,
      extra: 'chart',
      payload: {
        kind: 'chart',
        title: '各科均分（导入数据）',
        bars: p.scores.map((s) => ({ label: s.subject, value: Math.round(s.avg), display: String(s.avg), peak: s.subject === sorted[0]?.subject })),
      },
      source: metaSource({ fetchedAt: p.importedAt, kind: 'csv', label: `本地导入 · ${p.fileName}` }),
      action: { kind: 'openTask', goal: `起草${p.className}教学质量诊断与帮扶方案` },
    })
  }
  // 多班：按各班总均分排名
  const ranked = profiles
    .map((p) => ({
      p,
      avg: p.scores.reduce((a, b) => a + b.avg, 0) / Math.max(p.scores.length, 1),
    }))
    .sort((a, b) => a.avg - b.avg)
  const lowest = ranked[0]
  return makeCard({
    id: `${ID_PREFIX}classes-agg`,
    role: 'schoolAdmin',
    type: 'insight',
    tag: '洞察',
    title: `${lowest.p.className}总均分 ${lowest.avg.toFixed(1)} 为导入班级中最低，建议重点关注`,
    body: `已导入 ${profiles.length} 个班级的成绩数据：${ranked.map((r) => r.p.className).join('、')}。最低班与最高班差距 ${(ranked[ranked.length - 1].avg - lowest.avg).toFixed(1)} 分，建议均衡化教研。`,
    extra: 'chart',
    payload: {
      kind: 'chart',
      title: '各班总均分（导入数据）',
      bars: ranked.map((r) => ({ label: r.p.className.replace(/（.*?）/, ''), value: Math.round(r.avg), display: r.avg.toFixed(1), peak: r.p.classId === lowest.p.classId })),
    },
    source: metaSource({ fetchedAt: lowest.p.importedAt, kind: 'csv', label: '本地导入' }),
    action: { kind: 'openTask', goal: `基于导入数据起草${lowest.p.className}教学质量分析报告` },
  })
}

/** 数据卡生成入口：按角色取数（异步，供 briefingStore.loadDeck 调用） */
export async function buildDataCards(role: RoleId): Promise<BriefingCard[]> {
  const provider = getSourceProvider()
  const cards: BriefingCard[] = []

  if (role === 'teacher') {
    const card = teacherCard()
    if (card) cards.push(card)
    return cards
  }

  if (role === 'schoolAdmin') {
    const card = schoolAdminCard()
    if (card) cards.push(card)
    // 无导入数据且远端可用时，用远端预警生成卡片
    if (cards.length === 0 && provider.kind === 'remote') {
      const { alerts, meta } = await provider.getSchoolOverview()
      if (!meta.degraded && alerts.length > 0) {
        const top = alerts[0]
        cards.push(
          makeCard({
            id: `${ID_PREFIX}alert-${top.title}`,
            role,
            type: 'insight',
            tag: '洞察',
            title: top.title,
            body: top.detail,
            source: metaSource(meta),
            action: { kind: 'openTask', goal: `针对「${top.title}」起草帮扶方案` },
          }),
        )
      }
    }
    return cards
  }

  // bureau：远端区域指标生成数据卡（seed 模式下静态卡组已覆盖，不重复）
  if (provider.kind === 'remote') {
    const { metrics, meta } = await provider.getRegionMetrics()
    if (!meta.degraded && metrics.length > 0) {
      const m = metrics[0]
      cards.push(
        makeCard({
          id: `${ID_PREFIX}region-${m.name}`,
          role,
          type: 'data',
          tag: '数据',
          title: `${m.name} ${m.value}，环比 ${m.trend >= 0 ? '+' : ''}${m.trend}%`,
          body: `${m.note}。数据来自区域数据平台实时拉取，可直接用于报告引用。`,
          extra: 'chart',
          payload: {
            kind: 'chart',
            title: '区域核心指标',
            bars: metrics.slice(0, 4).map((x) => ({ label: x.name.slice(0, 4), value: Number(x.value.replace(/[^\d.]/g, '')) || 0, display: x.value })),
          },
          source: metaSource(meta),
          action: { kind: 'openTask', goal: '基于区域平台最新指标起草本季度教学质量分析报告' },
        }),
      )
    }
  }
  return cards
}
