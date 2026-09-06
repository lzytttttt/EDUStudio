import { useRef, useState } from 'react'
import { X, Upload, FileText, Check, Trash2, ChevronDown, Info, Loader2 } from 'lucide-react'
import { useDataStore, IMPORTED_DOC_MAX_CHARS } from '../stores/dataStore'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useDialogA11y } from '../lib/useDialogA11y'
import { cn } from '../lib/cn'
import type { RoleId } from '../harness/types'

/** prompt 输入框 placeholder（v0.9 M6③）：按角色微调，引导写明文档用途与指令 */
const PROMPT_PLACEHOLDER: Record<RoleId, string> = {
  teacher: '如：期中成绩表，定位数学薄弱学生并给出帮扶建议',
  schoolAdmin: '如：各班成绩汇总，对比班级差异并找出需干预的班级',
  bureau: '区县汇总文档，定位连续两学期下滑的学校',
}

const ACCEPT = '.csv,.txt,.md,.json,.log,text/csv,text/plain,text/markdown'

function fmtChars(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万字符` : `${n} 字符`
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 导入文档对话框（v0.9 M6②③，原 CsvImportDialog 改造更名）：
 * 全角色统一「导入文档」——.csv/.txt/.md 等文本类文档原文作为 LLM 附件材料直通上下文，
 * 不再强制列结构匹配（原成绩 CSV 解析器保留于 lib/csvImport.ts，兼容既有已导入数据）。
 * - prompt 输入框：本次文档的用途与指令，随文档一并提交；留空回退角色默认说明
 * - 已导入文档可回看（展开用途与内容摘要）与删除
 * - Mock 模式不消费附件（沿用内置剧本），UI 明示；文档与说明仅存本机（纳入备份白名单）
 */
export default function ImportDocumentDialog({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const dialogRef = useDialogA11y<HTMLDivElement>(true, onClose)
  const fileRef = useRef<HTMLInputElement>(null)
  const role = useAuthStore((s) => s.role)
  const mode = useSettingsStore((s) => s.mode)
  const docs = useDataStore((s) => s.docs)
  const addDoc = useDataStore((s) => s.addDoc)
  const removeDoc = useDataStore((s) => s.removeDoc)

  const [pending, setPending] = useState<{ fileName: string; content: string; truncated: boolean } | null>(null)
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [done, setDone] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setParsing(true)
    setError('')
    try {
      const raw = await file.text()
      const truncated = raw.length > IMPORTED_DOC_MAX_CHARS
      setPending({
        fileName: file.name,
        content: truncated ? raw.slice(0, IMPORTED_DOC_MAX_CHARS) : raw,
        truncated,
      })
      setPrompt('')
    } catch (err) {
      setError(`文件读取失败：${(err as Error)?.message ?? '未知错误'}`)
    } finally {
      setParsing(false)
    }
  }

  const confirmImport = () => {
    if (!pending) return
    addDoc({
      id: `doc-${Date.now().toString(36)}`,
      fileName: pending.fileName,
      content: pending.content,
      prompt: prompt.trim(),
      importedAt: Date.now(),
      truncated: pending.truncated,
    })
    setPending(null)
    setPrompt('')
    setDone(true)
    window.setTimeout(() => {
      setDone(false)
      onImported?.()
    }, 900)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="animate-fade-up flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            <h2 className="text-sm font-semibold text-ink">导入文档</h2>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {done ? (
            <div className="flex flex-col items-center py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-mint-soft text-mint">
                <Check size={26} />
              </div>
              <p className="mt-4 text-sm font-semibold text-ink">导入成功</p>
              <p className="mt-1 text-xs text-ink-mute">文档已作为附件材料，AI 生成时可引用其内容</p>
            </div>
          ) : (
            <>
              {/* 待导入预览：文件名 + 字符数 + 截断明示（v0.9 风险对策：附件长度上限） */}
              {pending ? (
                <div className="rounded-2xl border border-line bg-surface-2 px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <FileText size={15} className="shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{pending.fileName}</span>
                    <button onClick={() => setPending(null)} className="shrink-0 text-[0.6875rem] text-ink-mute transition-colors hover:text-ink">
                      重选
                    </button>
                  </div>
                  <p className="mt-1.5 text-[0.6875rem] text-ink-mute">
                    已读取 {fmtChars(pending.content.length)}
                    {pending.truncated && <span className="text-amber">（超出 {fmtChars(IMPORTED_DOC_MAX_CHARS)} 上限，已截断）</span>}
                  </p>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-4 py-8 transition-colors hover:border-primary/50 hover:bg-primary-soft/40"
                  >
                    {parsing ? <Loader2 size={22} className="animate-spin text-primary" /> : <Upload size={22} className="text-ink-mute" />}
                    <span className="text-sm font-medium text-ink-soft">{parsing ? '读取中…' : '选择文档文件'}</span>
                    <span className="text-[0.6875rem] leading-relaxed text-ink-mute">
                      支持 .csv / .txt / .md 等文本类文档；原文作为附件材料供 AI 引用，无需固定列结构
                    </span>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void handleFile(f)
                      e.target.value = ''
                    }}
                  />
                </>
              )}

              {/* prompt 输入框（v0.9 M6③）：用途与指令随文档一并提交，留空回退角色默认说明 */}
              {pending && (
                <div className="mt-3">
                  <label htmlFor="import-doc-prompt" className="mb-1 block text-xs font-medium text-ink-soft">
                    用途与指令（可选）
                  </label>
                  <textarea
                    id="import-doc-prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    maxLength={200}
                    placeholder={role ? PROMPT_PLACEHOLDER[role] : '描述本次文档的用途与指令'}
                    className="w-full resize-none rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
                  />
                  <p className="mt-1 text-[0.625rem] leading-relaxed text-ink-mute">
                    留空将按角色默认说明提交；文档原文与指令会一并作为附件材料提供给 AI。
                  </p>
                </div>
              )}

              {error && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-xs leading-relaxed text-danger">
                  <Info size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Mock 边界明示（v0.9 M6②）：演示模式不消费附件，避免预期错位 */}
              {mode === 'mock' && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-primary-soft px-3 py-2.5 text-[0.6875rem] leading-relaxed text-primary">
                  <Info size={14} className="mt-0.5 shrink-0" />
                  <span>当前为演示模式：文档不会参与内容生成（沿用内置剧本）；连接真实模型后，文档将作为附件材料供 AI 引用。</span>
                </div>
              )}

              {/* 已导入文档（v0.9 M6③）：可回看用途与内容摘要，可删除 */}
              {docs.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-medium text-ink-soft">已导入文档（{docs.length}）</p>
                  <div className="space-y-1.5">
                    {docs.map((d) => (
                      <div key={d.id} className="rounded-xl border border-line">
                        <button
                          onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                          aria-expanded={expandedId === d.id}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <FileText size={13} className="shrink-0 text-primary" />
                            <span className="truncate text-xs font-medium text-ink">{d.fileName}</span>
                            {d.truncated && (
                              <span className="shrink-0 rounded-full bg-amber-soft px-1.5 py-0.5 text-[0.5625rem] font-medium text-amber">已截断</span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 text-[0.625rem] text-ink-mute">
                            {fmtTime(d.importedAt)}
                            <ChevronDown size={12} className={cn('transition-transform', expandedId === d.id && 'rotate-180')} />
                          </span>
                        </button>
                        {expandedId === d.id && (
                          <div className="border-t border-line px-3 py-2.5">
                            <p className="text-[0.6875rem] leading-relaxed text-ink-soft">
                              <span className="font-medium">用途与指令：</span>
                              {d.prompt.trim() || '（留空，将按角色默认说明提交）'}
                            </p>
                            <p className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-2 px-2.5 py-2 text-[0.625rem] leading-relaxed text-ink-mute">
                              {d.content.slice(0, 400)}
                              {d.content.length > 400 ? '…' : ''}
                            </p>
                            <button
                              onClick={() => removeDoc(d.id)}
                              className="mt-2 inline-flex items-center gap-1 text-[0.625rem] text-danger transition-opacity hover:opacity-80"
                            >
                              <Trash2 size={11} />
                              删除该文档
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 学生数据提示（v0.9 M3④随迁）：本机存储明示 + 敏感信息提醒 */}
              <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-mute">
                导入的文档与说明仅保存在本机浏览器，不会上传；请勿在公用设备导入敏感信息。
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <button onClick={onClose} className="rounded-xl border border-line bg-surface-2 px-4 py-2 text-xs text-ink-soft transition-colors hover:text-ink">
            关闭
          </button>
          <button
            onClick={confirmImport}
            disabled={!pending}
            className={cn(
              'rounded-xl px-4 py-2 text-xs font-medium transition-all',
              pending ? 'bg-primary text-white hover:bg-primary-deep active:scale-[0.98]' : 'cursor-not-allowed bg-surface-2 text-ink-mute',
            )}
          >
            确认导入
          </button>
        </div>
      </div>
    </div>
  )
}
