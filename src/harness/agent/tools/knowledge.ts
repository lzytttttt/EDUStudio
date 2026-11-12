/**
 * 知识与跨文档工具（v0.5 M3①）
 *
 * 只声明工具元信息（名称 / 参数 schema / display 文案），执行体与内置数据表
 * 懒加载自 knowledgeRun.ts：这些工具不是首屏就要跑的东西，v0.9.5 拆出以守住主 chunk 预算。
 */
import type { ToolDef } from '../../types'

const ALL = ['teacher', 'schoolAdmin', 'bureau'] as const

/** 课标检索 */
export const searchCurriculum: ToolDef = {
  name: 'searchCurriculum',
  label: '课标检索',
  description: '按关键词检索课程标准知识点（学科/学段/单元/行为要求）',
  roles: [...ALL],
  parameters: {
    type: 'object',
    properties: { keyword: { type: 'string', description: '知识点关键词，如「函数」「电磁感应」' } },
    required: ['keyword'],
  },
  /** 业务文案（v0.9.2 P0-A）：给教育者看的执行描述，隐藏工具名 */
  display: (args) => `正在检索课程标准「${String(args.keyword ?? '')}」`,
  run: (args) => import('./knowledgeRun').then((m) => m.runSearchCurriculum(args)),
}

/** 校本资源检索 */
export const searchResources: ToolDef = {
  name: 'searchResources',
  label: '资源检索',
  description: '按关键词检索校本资源库（课件/教案/习题/视频/实验），可限定学科',
  roles: [...ALL],
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '资源关键词，如「二次函数」「实验」' },
      subject: { type: 'string', description: '限定学科，可选' },
    },
    required: ['keyword'],
  },
  display: (args) => `正在检索校本资源「${String(args.keyword ?? '')}」`,
  run: (args) => import('./knowledgeRun').then((m) => m.runSearchResources(args)),
}

/** 跨文档工具 1/3：文档清单 */
export const listDocuments: ToolDef = {
  name: 'listDocuments',
  label: '文档清单',
  description: '列出当前工作区全部文档（标题/类型/角色/字数），跨文档汇总前先摸清家底',
  roles: [...ALL],
  parameters: { type: 'object', properties: {} },
  display: () => '正在清点工作区文档',
  run: () => import('./knowledgeRun').then((m) => m.runListDocuments()),
}

/** 跨文档工具 2/3：引用摘录 */
export const quoteDocument: ToolDef = {
  name: 'quoteDocument',
  label: '文档摘录',
  description: '按标题/ID 定位文档并摘录关键段落（含关键词的段落优先），供跨文档引用',
  roles: [...ALL],
  parameters: {
    type: 'object',
    properties: {
      doc: { type: 'string', description: '文档标题关键词或 ID' },
      keyword: { type: 'string', description: '段落筛选关键词，可选' },
    },
    required: ['doc'],
  },
  display: (args) => `正在摘录《${String(args.doc ?? '')}》关键内容`,
  run: (args) => import('./knowledgeRun').then((m) => m.runQuoteDocument(args)),
}

/** 跨文档工具 3/3：合并成文 */
export const mergeDocuments: ToolDef = {
  name: 'mergeDocuments',
  label: '合并成文',
  description: '把多份文档按章节合并为一份新文档并写入工作区（材料汇编/汇总报告）',
  roles: [...ALL],
  parameters: {
    type: 'object',
    properties: {
      docs: { type: 'array', items: { type: 'string' }, description: '文档标题关键词或 ID 列表（至少 2 份）' },
      title: { type: 'string', description: '合并后文档标题，可选' },
    },
    required: ['docs'],
  },
  display: (args) => `正在汇编${Array.isArray(args.docs) ? `${args.docs.length} 份` : '多份'}文档`,
  run: (args) => import('./knowledgeRun').then((m) => m.runMergeDocuments(args)),
}
