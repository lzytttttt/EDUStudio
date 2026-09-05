/**
 * 知识与跨文档工具（v0.5 M3①）
 *
 * - searchCurriculum / searchResources：内置课标与校本资源检索
 * - listDocuments / quoteDocument / mergeDocuments：跨文档「清单 → 摘录 → 合并成文」链路，
 *   让 Agent 能基于工作区已有材料做汇总（如把多份教案汇编成复习资料）。
 */
import type { RoleId, ToolDef } from '../../types'
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
export const searchCurriculum: ToolDef = {
  name: 'searchCurriculum',
  label: '课标检索',
  description: '按关键词检索课程标准知识点（学科/学段/单元/行为要求）',
  roles: ['teacher', 'schoolAdmin', 'bureau'],
  parameters: {
    type: 'object',
    properties: { keyword: { type: 'string', description: '知识点关键词，如「函数」「电磁感应」' } },
    required: ['keyword'],
  },
  async run(args) {
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
  },
}

/** 校本资源检索 */
export const searchResources: ToolDef = {
  name: 'searchResources',
  label: '资源检索',
  description: '按关键词检索校本资源库（课件/教案/习题/视频/实验），可限定学科',
  roles: ['teacher', 'schoolAdmin', 'bureau'],
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '资源关键词，如「二次函数」「实验」' },
      subject: { type: 'string', description: '限定学科，可选' },
    },
    required: ['keyword'],
  },
  async run(args) {
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
  },
}

/** 跨文档工具 1/3：文档清单 */
export const listDocuments: ToolDef = {
  name: 'listDocuments',
  label: '文档清单',
  description: '列出当前工作区全部文档（标题/类型/角色/字数），跨文档汇总前先摸清家底',
  roles: ['teacher', 'schoolAdmin', 'bureau'],
  parameters: { type: 'object', properties: {} },
  async run() {
    const docs = useArtifactStore.getState().docs
    if (docs.length === 0) {
      return { summary: '工作区暂无文档', payload: [] }
    }
    return {
      summary: `工作区共 ${docs.length} 份文档：${docs.map((d) => `《${d.title}》(${KIND_LABEL[d.kind] ?? d.kind})`).join('、')}`,
      payload: docs.map((d) => ({ id: d.id, title: d.title, kind: d.kind, role: d.role, chars: d.content.length })),
    }
  },
}

/** 跨文档工具 2/3：引用摘录 */
export const quoteDocument: ToolDef = {
  name: 'quoteDocument',
  label: '文档摘录',
  description: '按标题/ID 定位文档并摘录关键段落（含关键词的段落优先），供跨文档引用',
  roles: ['teacher', 'schoolAdmin', 'bureau'],
  parameters: {
    type: 'object',
    properties: {
      doc: { type: 'string', description: '文档标题关键词或 ID' },
      keyword: { type: 'string', description: '段落筛选关键词，可选' },
    },
    required: ['doc'],
  },
  async run(args) {
    const kw = String(args.doc ?? '')
    const docs = useArtifactStore.getState().docs
    const doc = docs.find((d) => d.id === kw) ?? docs.find((d) => d.title.includes(kw))
    if (!doc) {
      return { summary: `未找到标题含「${kw}」的文档，可先用 listDocuments 查看清单`, payload: null }
    }
    const keyword = typeof args.keyword === 'string' ? args.keyword : ''
    const paras = doc.content.split(/\n{2,}/).filter((p) => p.trim())
    const matched = keyword ? paras.filter((p) => p.includes(keyword)) : paras
    const picked = (matched.length ? matched : paras).slice(0, 3).map((p) => (p.length > 200 ? `${p.slice(0, 200)}…` : p))
    return {
      summary: `《${doc.title}》摘录 ${picked.length} 段（全文共 ${paras.length} 段）`,
      payload: { id: doc.id, title: doc.title, excerpts: picked },
    }
  },
}

/** 跨文档工具 3/3：合并成文 */
export const mergeDocuments: ToolDef = {
  name: 'mergeDocuments',
  label: '合并成文',
  description: '把多份文档按章节合并为一份新文档并写入工作区（材料汇编/汇总报告）',
  roles: ['teacher', 'schoolAdmin', 'bureau'],
  parameters: {
    type: 'object',
    properties: {
      docs: { type: 'array', items: { type: 'string' }, description: '文档标题关键词或 ID 列表（至少 2 份）' },
      title: { type: 'string', description: '合并后文档标题，可选' },
    },
    required: ['docs'],
  },
  async run(args) {
    const keys = Array.isArray(args.docs) ? args.docs.map(String) : []
    if (keys.length < 2) {
      return { summary: '合并至少需要 2 份文档（docs 参数传标题关键词列表）', payload: null }
    }
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
  },
}
