import { useRef, useState } from 'react'
import { X, Upload, FileSpreadsheet, AlertTriangle, Check, Loader2, Trash2 } from 'lucide-react'
import { parseScoreCsv, weakPointsFrom, type CsvImportPreview } from '../lib/csvImport'
import { useDataStore } from '../stores/dataStore'
import { invalidateSourceProvider } from '../harness/sources'
import { useDialogA11y } from '../lib/useDialogA11y'
import { cn } from '../lib/cn'

/**
 * 成绩 CSV 导入对话框（v0.5 M1②）：选择文件 → 解析预览（列映射/均分表/警告）
 * → 确认导入。导入后 SourceProvider 立即切换为「本地导入」数据。
 */
export default function CsvImportDialog({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const dialogRef = useDialogA11y<HTMLDivElement>(true, onClose)
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<CsvImportPreview | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [className, setClassName] = useState('')
  const [done, setDone] = useState(false)

  const handleFile = async (file: File) => {
    setParsing(true)
    setError('')
    setPreview(null)
    setFileName(file.name)
    try {
      const text = await file.text()
      const result = parseScoreCsv(text, { fileName: file.name })
      if (result.ok) {
        setPreview(result.preview)
        setClassName(result.preview.className)
      } else {
        setError(result.error)
      }
    } catch (err) {
      setError(`文件读取失败：${(err as Error)?.message ?? '未知错误'}`)
    } finally {
      setParsing(false)
    }
  }

  const confirmImport = () => {
    if (!preview) return
    useDataStore.getState().upsert({
      classId: `csv-${Date.now().toString(36)}`,
      className: className.trim() || preview.className,
      scores: preview.scores,
      homeworkCompletion: preview.homeworkCompletion ?? 90,
      attentionIndex: 80,
      weakPoints: weakPointsFrom(preview),
      importedAt: Date.now(),
      fileName: fileName || '成绩.csv',
      studentCount: preview.rowCount,
    })
    invalidateSourceProvider()
    setDone(true)
    window.setTimeout(() => {
      onImported?.()
      onClose()
    }, 900)
  }

  const reset = () => {
    setPreview(null)
    setError('')
    setFileName('')
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
            <FileSpreadsheet size={16} className="text-primary" />
            <h2 className="text-sm font-semibold text-ink">导入班级成绩</h2>
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
              <p className="mt-1 text-xs text-ink-mute">简报与工具已切换为导入数据</p>
            </div>
          ) : !preview ? (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-4 py-8 transition-colors hover:border-primary/50 hover:bg-primary-soft/40"
              >
                {parsing ? <Loader2 size={22} className="animate-spin text-primary" /> : <Upload size={22} className="text-ink-mute" />}
                <span className="text-sm font-medium text-ink-soft">{parsing ? '解析中…' : '选择成绩 CSV 文件'}</span>
                <span className="text-[0.6875rem] leading-relaxed text-ink-mute">
                  支持宽表（姓名,语文,数学…）与长表（班级,科目,分数）两种格式
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleFile(f)
                  e.target.value = ''
                }}
              />
              {error && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-xs leading-relaxed text-danger">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <div className="mt-4 rounded-xl bg-surface-2 px-3 py-2.5 text-[0.6875rem] leading-relaxed text-ink-mute">
                <p className="font-medium text-ink-soft">列名自动识别</p>
                <p className="mt-1">姓名/学生、班级、科目/学科、分数/成绩/平均分、及格率、优秀率、作业完成率均可模糊匹配；无法识别的列会在预览中提示。</p>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-soft">班级名称</label>
                  <input
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-primary"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-surface-2 px-2 py-2">
                    <p className="text-base font-semibold text-ink">{preview.rowCount}</p>
                    <p className="text-[0.625rem] text-ink-mute">数据行</p>
                  </div>
                  <div className="rounded-xl bg-surface-2 px-2 py-2">
                    <p className="text-base font-semibold text-ink">{preview.scores.length}</p>
                    <p className="text-[0.625rem] text-ink-mute">科目数</p>
                  </div>
                  <div className="rounded-xl bg-surface-2 px-2 py-2">
                    <p className="text-base font-semibold text-ink">{preview.homeworkCompletion ?? '-'}</p>
                    <p className="text-[0.625rem] text-ink-mute">作业完成率</p>
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-ink-soft">科目均分预览</p>
                  <div className="overflow-hidden rounded-xl border border-line">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-surface-2 text-ink-mute">
                          <th className="px-3 py-1.5 text-left font-medium">科目</th>
                          <th className="px-3 py-1.5 text-right font-medium">均分</th>
                          <th className="px-3 py-1.5 text-right font-medium">及格率</th>
                          <th className="px-3 py-1.5 text-right font-medium">优秀率</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.scores.map((s) => (
                          <tr key={s.subject} className="border-t border-line">
                            <td className="px-3 py-1.5 text-ink">{s.subject}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink">{s.avg}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink-soft">{s.passRate}%</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink-soft">{s.excellenceRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {preview.warnings.length > 0 && (
                  <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-[0.6875rem] leading-relaxed text-amber-700">
                    {preview.warnings.slice(0, 5).map((w, i) => (
                      <p key={i}>· {w}</p>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3.5">
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink-soft transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Trash2 size={12} />
            重新选择
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl border border-line bg-surface-2 px-4 py-2 text-xs text-ink-soft transition-colors hover:text-ink">
              取消
            </button>
            <button
              onClick={confirmImport}
              disabled={!preview}
              className={cn(
                'rounded-xl px-4 py-2 text-xs font-medium transition-all',
                preview ? 'bg-primary text-white hover:bg-primary-deep active:scale-[0.98]' : 'cursor-not-allowed bg-surface-2 text-ink-mute',
              )}
            >
              确认导入
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
