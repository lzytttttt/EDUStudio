import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDocAttachments,
  IMPORTED_DOC_MAX_CHARS,
  useDataStore,
  type ImportedDoc,
} from '../stores/dataStore'
import { MockBriefingProvider } from '../harness/briefing/MockBriefingProvider'

/* 导入文档附件注入（v0.9 M6②/M8①）：prompt 拼装 / 截断标注 / Mock 边界 */

function doc(over: Partial<ImportedDoc> = {}): ImportedDoc {
  return {
    id: 'd1',
    fileName: '期中成绩.csv',
    content: '姓名,分数\n张三,90',
    prompt: '定位数学薄弱学生',
    importedAt: 0,
    truncated: false,
    ...over,
  }
}

afterEach(() => {
  useDataStore.setState({ docs: [] })
})

describe('buildDocAttachments 附件注入（v0.9 M6②/M8①）', () => {
  it('prompt 拼装：文件名 + 用途与指令 + 原文', () => {
    useDataStore.setState({ docs: [doc()] })
    const a = buildDocAttachments('teacher')
    expect(a).toContain('《期中成绩.csv》')
    expect(a).toContain('用途与指令：定位数学薄弱学生')
    expect(a).toContain('张三,90')
  })

  it('prompt 留空 → 回退角色默认说明（M6③）', () => {
    useDataStore.setState({ docs: [doc({ prompt: '  ' })] })
    expect(buildDocAttachments('teacher')).toContain('班级学情与教学材料')
    expect(buildDocAttachments('bureau')).toContain('区县汇总文档')
    expect(buildDocAttachments()).toContain('请按文档内容自行理解')
  })

  it('无文档 → 空串（调用方跳过附件段）', () => {
    expect(buildDocAttachments('teacher')).toBe('')
  })

  it('截断标注与长度上限常量（v0.9 风险对策：附件长度上限）', () => {
    expect(IMPORTED_DOC_MAX_CHARS).toBeGreaterThan(0)
    useDataStore.setState({ docs: [doc({ truncated: true })] })
    expect(buildDocAttachments('teacher')).toContain('（原文超长，已截断）')
  })

  it('多文档以空行分隔', () => {
    useDataStore.setState({ docs: [doc(), doc({ id: 'd2', fileName: 'b.md', content: 'B' })] })
    const a = buildDocAttachments('teacher')
    expect(a).toContain('《期中成绩.csv》')
    expect(a).toContain('《b.md》')
    expect(a).toContain('\n\n')
  })
})

describe('Mock 边界：剧本不消费附件（v0.9 M6②/M8①）', () => {
  it('注入 docs 前后 Mock getDeck 输出一致（Mock 沿用剧本，无隐性消耗）', () => {
    const provider = new MockBriefingProvider()
    const ctx = { decisions: {}, favorites: [], now: 0 }
    const before = provider.getDeck('teacher', ctx).map((c) => c.id)
    useDataStore.setState({ docs: [doc({ content: 'x'.repeat(5000) })] })
    const after = provider.getDeck('teacher', ctx).map((c) => c.id)
    expect(after).toEqual(before)
  })
})
