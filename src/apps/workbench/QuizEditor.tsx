import { useState } from 'react'
import { Plus, Trash2, FilePlus2, ChevronDown, ChevronUp, ClipboardList } from 'lucide-react'
import { useQuizStore, QUIZ_TYPE_LABEL, type QuizItem } from '../../stores/quizStore'
import { useArtifactStore } from '../../stores/artifactStore'
import { useAuthStore } from '../../stores/authStore'
import { cn } from '../../lib/cn'

const TYPES: QuizItem['type'][] = ['single', 'blank', 'solve']

/** 试题组 → Markdown（插入文档用） */
export function quizToMarkdown(point: string, items: QuizItem[]): string {
  const lines = [`## 出题工作台 · ${point || '综合练习'}`, '']
  items.forEach((it, i) => {
    const n = i + 1
    lines.push(`**${n}. ${QUIZ_TYPE_LABEL[it.type]}题**（难度 ${it.difficulty.toFixed(2)}）`)
    lines.push('')
    lines.push(it.stem || '（题干待补充）')
    if (it.options?.length) {
      lines.push('')
      it.options.forEach((o) => lines.push(o))
    }
    lines.push('')
    lines.push(`> **参考答案**：${it.answer || '待定'}`)
    if (it.analysis) {
      lines.push('>')
      lines.push(`> **解析**：${it.analysis}`)
    }
    lines.push('')
  })
  return lines.join('\n')
}

export default function QuizEditor() {
  const { items, knowledgePoint, updateItem, removeItem, addItem, clear } = useQuizStore()
  const artifactStore = useArtifactStore()
  const role = useAuthStore((s) => s.role) ?? 'teacher'
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [inserted, setInserted] = useState(false)

  const insertToDoc = () => {
    if (!items.length) return
    const md = quizToMarkdown(knowledgePoint, items)
    const active = artifactStore.docs.find((d) => d.id === artifactStore.activeId)
    if (active) {
      artifactStore.updateContent(active.id, `${active.content}\n\n${md}`)
    } else {
      const id = `art-quiz-${Date.now().toString(36)}`
      artifactStore.createPlaceholder(id, `试题组 · ${knowledgePoint || '综合练习'}`, 'analysis', role, 'manual')
      artifactStore.appendChunk(id, `# 试题组 · ${knowledgePoint || '综合练习'}\n\n${md}`)
      artifactStore.finalize(id, `试题组 · ${knowledgePoint || '综合练习'}`, 'analysis')
    }
    setInserted(true)
    window.setTimeout(() => setInserted(false), 2000)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardList size={15} className="shrink-0 text-ink-mute" />
          <h2 className="truncate text-sm font-semibold">出题工作台</h2>
          {knowledgePoint && (
            <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[0.625rem] font-medium text-primary">
              {knowledgePoint}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => addItem('single')}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[0.6875rem] text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
            title="手动添加试题"
          >
            <Plus size={12} />
            添加
          </button>
          <button
            onClick={insertToDoc}
            disabled={!items.length}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[0.6875rem] font-medium transition-colors disabled:opacity-40',
              inserted ? 'bg-mint/15 text-mint' : 'bg-primary-soft text-primary hover:bg-primary/15',
            )}
            title="将试题组追加到当前文档"
          >
            <FilePlus2 size={12} />
            {inserted ? '已插入' : '插入到文档'}
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-ink-mute">
              <ClipboardList size={22} />
            </div>
            <p className="mt-3 text-xs font-medium text-ink-soft">试题工作台为空</p>
            <p className="mt-1.5 max-w-[220px] text-[0.6875rem] leading-relaxed text-ink-mute">
              在左侧对话中发送「围绕××知识点出题」，Agent 命制的试题会自动出现在这里，可直接编辑后插入文档
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((it, idx) => {
              const expanded = expandedId === it.id
              return (
                <li key={it.id} className="overflow-hidden rounded-2xl border border-line bg-surface-2">
                  <button
                    onClick={() => setExpandedId(expanded ? null : it.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 rounded-md bg-primary-soft px-1.5 py-0.5 text-[0.625rem] font-medium text-primary">
                        {idx + 1} · {QUIZ_TYPE_LABEL[it.type]}
                      </span>
                      <span className="truncate text-xs text-ink-soft">{it.stem || '（点击展开编辑）'}</span>
                    </span>
                    {expanded ? <ChevronUp size={13} className="shrink-0 text-ink-mute" /> : <ChevronDown size={13} className="shrink-0 text-ink-mute" />}
                  </button>

                  {expanded && (
                    <div className="space-y-2.5 border-t border-line px-3 py-3">
                      <div className="flex gap-2">
                        <select
                          value={it.type}
                          onChange={(e) => updateItem(it.id, { type: e.target.value as QuizItem['type'] })}
                          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[0.6875rem] text-ink outline-none focus:border-primary"
                        >
                          {TYPES.map((t) => (
                            <option key={t} value={t}>{QUIZ_TYPE_LABEL[t]}题</option>
                          ))}
                        </select>
                        <label className="flex flex-1 items-center gap-2 text-[0.6875rem] text-ink-mute">
                          难度
                          <input
                            type="range"
                            min={0.3}
                            max={0.9}
                            step={0.05}
                            value={it.difficulty}
                            onChange={(e) => updateItem(it.id, { difficulty: Number(e.target.value) })}
                            className="flex-1 accent-[var(--color-primary)]"
                          />
                          <span className="w-8 text-right font-medium text-ink-soft">{it.difficulty.toFixed(2)}</span>
                        </label>
                      </div>

                      <textarea
                        value={it.stem}
                        onChange={(e) => updateItem(it.id, { stem: e.target.value })}
                        rows={2}
                        placeholder="题干"
                        className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink outline-none placeholder:text-ink-mute focus:border-primary"
                      />

                      {it.type === 'single' && (
                        <div className="space-y-1.5">
                          {(it.options ?? []).map((opt, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <button
                                onClick={() => updateItem(it.id, { answer: String.fromCharCode(65 + oi) })}
                                className={cn(
                                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[0.6875rem] font-medium transition-colors',
                                  it.answer === String.fromCharCode(65 + oi)
                                    ? 'bg-primary text-white'
                                    : 'bg-surface text-ink-mute hover:bg-primary-soft hover:text-primary',
                                )}
                                title="设为正确答案"
                              >
                                {String.fromCharCode(65 + oi)}
                              </button>
                              <input
                                value={opt}
                                onChange={(e) => {
                                  const options = [...(it.options ?? [])]
                                  options[oi] = e.target.value
                                  updateItem(it.id, { options })
                                }}
                                className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[0.6875rem] text-ink outline-none focus:border-primary"
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      <input
                        value={it.answer}
                        onChange={(e) => updateItem(it.id, { answer: e.target.value })}
                        placeholder="参考答案"
                        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-mute focus:border-primary"
                      />
                      <textarea
                        value={it.analysis}
                        onChange={(e) => updateItem(it.id, { analysis: e.target.value })}
                        rows={2}
                        placeholder="解析"
                        className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink outline-none placeholder:text-ink-mute focus:border-primary"
                      />

                      <div className="flex justify-end">
                        <button
                          onClick={() => removeItem(it.id)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[0.6875rem] text-ink-mute transition-colors hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 size={11} />
                          删除本题
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {items.length > 0 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[0.625rem] text-ink-mute">
          <span>共 {items.length} 题 · 单选 {items.filter((i) => i.type === 'single').length} / 填空 {items.filter((i) => i.type === 'blank').length} / 解答 {items.filter((i) => i.type === 'solve').length}</span>
          <button onClick={clear} className="transition-colors hover:text-danger">清空</button>
        </div>
      )}
    </div>
  )
}
