/**
 * 知识与跨文档工具实现（v0.5 M3①，实现部分 v0.9.5 拆出）
 *
 * 与 knowledge.ts 的 ToolDef 元信息分离：工具被调用时才加载，连带
 * data/curriculum 与 data/resources 两张内置数据表一起移出首屏主 chunk。
 *
 * - searchCurriculum / searchResources：内置课标与校本资源检索
 * - listDocuments / quoteDocument / mergeDocuments：跨文档「清单 → 摘录 → 合并成文」链路，
 *   让 Agent 能基于工作区已有材料做汇总（如把多份教案汇编成复习资料）。
 */
import type { RoleId, ToolResult } from '../../types'
import { searchCurriculumPoints } from '../../../data/curriculum'
import { searchResources as searchResourceItems } from '../../../data/resources'
import { useArtifactStore } from '../../../stores/artifactStore'
import { useAuthStore } from '../../../stores/authStore'

const KIND_LABEL: Record<string, string> = {
  lessonPlan: '教案',
  report: '报告',
  notice: '通知',
  analysis: '分析',
  generic: '文档',
}

/** 课标检索 */
export async function runSearchCurriculum(args: Record<string, unknown>): Promise<ToolResult> {
  const kw = String(args.keyword ?? '')
  const hits = searchCurriculumPoints(kw)
  return {
    summary: hits.length
      ? `命中 ${hits.length} 条课标要求：${hits
          .slice(0, 5)
          .map((c) => `${c.subject}·${c.stage}·${c.point}`)
          .join('；')}${hits.length > 5 ? ' 等' : ''}`
      : `未命中「${kw}」相关课标条目`,
    payload: hits,
  }
}

/** 校本资源检索 */
export async function runSearchResources(args: Record<string, unknown>): Promise<ToolResult> {
  const kw = String(args.keyword ?? '')
  const subject = typeof args.subject === 'string' && args.subject ? args.subject : undefined
  const hits = searchResourceItems(kw, subject)
  return {
    summary: hits.length
      ? `命中 ${hits.length} 份资源：${hits
          .slice(0, 5)
          .map((r) => `《${r.title}》(${r.type})`)
          .join('、')}${hits.length > 5 ? ' 等' : ''}`
      : `未命中「${kw}」相关资源`,
    payload: hits,
  }
}

/** 跨文档工具 1/3：文档清单 */
export async function runListDocuments(): Promise<ToolResult> {
  const docs = useArtifactStore.getState().docs
  if (docs.length === 0) return { summary: '工作区暂无文档', payload: [] }
  return {
    summary: `工作区共 ${docs.length} 份文档：${docs.map((d) => `《${d.title}》(${KIND_LABEL[d.kind] ?? d.kind})`).join('、')}`,
    payload: docs.map((d) => ({ id: d.id, title: d.title, kind: d.kind, role: d.role, chars: d.content.length })),
  }
}

/** 跨文档工具 2/3：引用摘录 */
export async function runQuoteDocument(args: Record<string, unknown>): Promise<ToolResult> {
  const kw = String(args.doc ?? '')
  const docs = useArtifactStore.getState().docs
  const doc = docs.find((d) => d.id === kw) ?? docs.find((d) => d.title.includes(kw))
  if (!doc) return { summary: `未找到标题含「${kw}」的文档，可先用 listDocuments 查看清单`, payload: null }
  const keyword = typeof args.keyword === 'string' ? args.keyword : ''
  const paras = doc.content.split(/\n{2,}/).filter((p) => p.trim())
  const matched = keyword ? paras.filter((p) => p.includes(keyword)) : paras
  const picked = (matched.length ? matched : paras)
    .slice(0, 3)
    .map((p) => (p.length > 200 ? `${p.slice(0, 200)}…` : p))
  return {
    summary: `《${doc.title}》摘录 ${picked.length} 段（全文共 ${paras.length} 段）`,
    payload: { id: doc.id, title: doc.title, excerpts: picked },
  }
}

/** 跨文档工具 3/3：合并成文 */
export async function runMergeDocuments(args: Record<string, unknown>): Promise<ToolResult> {
  const keys = Array.isArray(args.docs) ? args.docs.map(String) : []
  if (keys.length < 2) return { summary: '合并至少需要 2 份文档（docs 参数传标题关键词列表）', payload: null }
  const docs = useArtifactStore.getState().docs
  const picked = keys
    .map((k) => docs.find((d) => d.id === k) ?? docs.find((d) => d.title.includes(k)))
    .filter((d) => !!d)
  const uniq = [...new Map(picked.map((d) => [d.id, d])).values()]
  if (uniq.length < 2) {
    return { summary: `可匹配的文档不足 2 份（命中 ${uniq.length} 份），请检查标题关键词`, payload: null }
  }
  const role: RoleId = useAuthStore.getState().role ?? uniq[0].role
  const title = String(args.title ?? '').trim() || `汇编：${uniq.map((d) => d.title).join(' + ')}`
  const id = `art-merge-${Date.now().toString(36)}`
  const content =
    `# ${title}\n\n> 本文档由 ${uniq.length} 份文档合并生成（${uniq.map((d) => `《${d.title}》`).join('、')}）。\n\n` +
    uniq.map((d, i) => `## ${i + 1}. ${d.title}\n\n${d.content}`).join('\n\n---\n\n')
  const store = useArtifactStore.getState()
  store.createPlaceholder(id, title, uniq[0].kind, role, 'agent')
  store.updateContent(id, content)
  return {
    summary: `已合并 ${uniq.length} 份文档为《${title}》并写入文档工作区`,
    payload: { id, title, sources: uniq.map((d) => d.title) },
  }
}
