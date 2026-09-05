import { useRef, useState } from 'react'
import { X, Eye, EyeOff, RotateCcw, Trash2, User, Type, Database, ShieldCheck, Stamp, Focus } from 'lucide-react'
import {
  useSettingsStore, maskKey, clampPref, PREF_MAX_LEN,
  FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_DEFAULT,
} from '../stores/settingsStore'
import { checkApiKey, type KeyCheckResult } from '../lib/keyCheck'
import { cn } from '../lib/cn'
import { useDialogA11y } from '../lib/useDialogA11y'

/** 字号档位称呼（仅用于展示）：≤13 小 / 14–15 标准 / 16–17 大 / ≥18 超大 */
function sizeLabel(px: number): string {
  if (px <= 13) return '小'
  if (px <= 15) return '标准'
  if (px <= 17) return '大'
  return '超大'
}

/**
 * 字号拖拽滑杆（v0.6.1）：Pointer Events 零依赖，复刻 Resizer 交互范式。
 * 点击/拖拽轨道调值，方向键微调，双击重置默认；拖拽中禁选文本。
 */
function FontSizeSlider({ value, onChange, onReset }: { value: number; onChange: (px: number) => void; onReset: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const valueFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return value
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.round(FONT_SIZE_MIN + ratio * (FONT_SIZE_MAX - FONT_SIZE_MIN))
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.style.userSelect = 'none'
    onChange(valueFromClientX(e.clientX))
  }
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    onChange(valueFromClientX(e.clientX))
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.style.userSelect = ''
  }
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(value - 1)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(value + 1)
    else if (e.key === 'Home') onChange(FONT_SIZE_MIN)
    else if (e.key === 'End') onChange(FONT_SIZE_MAX)
    else return
    e.preventDefault()
  }

  const pct = ((value - FONT_SIZE_MIN) / (FONT_SIZE_MAX - FONT_SIZE_MIN)) * 100

  return (
    <div className="flex items-center gap-3">
      <span className="w-4 text-center text-[0.6875rem] font-semibold text-ink-mute" aria-hidden>A</span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="界面字号"
        aria-valuemin={FONT_SIZE_MIN}
        aria-valuemax={FONT_SIZE_MAX}
        aria-valuenow={value}
        aria-valuetext={`${value} 像素，${sizeLabel(value)}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onReset}
        onKeyDown={handleKeyDown}
        title={`拖拽调整字号（${FONT_SIZE_MIN}–${FONT_SIZE_MAX}px）· 双击重置`}
        className="relative flex h-8 flex-1 cursor-ew-resize touch-none items-center outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-full"
      >
        {/* 轨道 + 已填充段 */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-primary transition-[width] duration-75" style={{ width: `${pct}%` }} />
        </div>
        {/* 滑块 */}
        <div
          className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-white shadow-soft"
          style={{ left: `${pct}%` }}
        />
      </div>
      <span className="w-4 text-center text-[0.9375rem] font-bold text-ink" aria-hidden>A</span>
      <span className="w-[68px] shrink-0 text-right text-xs font-medium tabular-nums text-primary">
        {value}px · {sizeLabel(value)}
      </span>
    </div>
  )
}

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useSettingsStore()
  const [showKey, setShowKey] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [keyCheck, setKeyCheck] = useState<KeyCheckResult | null>(null)
  const [keyChecking, setKeyChecking] = useState(false)
  const dialogRef = useDialogA11y<HTMLDivElement>(true, onClose)

  /** Key 有效性检测（v0.5 M5②）：无效自动清空，避免反复失败 */
  const runKeyCheck = async () => {
    setKeyChecking(true)
    setKeyCheck(null)
    const base = s.proxyUrl || s.baseUrl
    const res = await checkApiKey(base, s.apiKey)
    setKeyChecking(false)
    setKeyCheck(res)
    if (!res.ok && s.apiKey && /401|无效/.test(res.message)) {
      s.update({ apiKey: '' })
    }
  }

  const pref = s.preferences

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="animate-fade-up max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-line bg-surface p-6 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">设置</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {/* ── 偏好画像（注入 system prompt，API 模式生效） ── */}
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <User size={14} className="text-primary" />
            <h3 className="text-sm font-semibold text-ink">偏好画像</h3>
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[0.625rem] text-primary">API 模式生效</span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-ink-mute">
            让 AI 记住你的称呼、背景与表达偏好，注入到每次对话的 system prompt（仅存本机，最长 {PREF_MAX_LEN} 字）。
          </p>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">称呼</label>
              <input
                value={pref.nickname}
                onChange={(e) => s.updatePreferences({ nickname: clampPref(e.target.value) })}
                maxLength={PREF_MAX_LEN}
                placeholder="如：张老师"
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">学段学科背景</label>
              <input
                value={pref.stage}
                onChange={(e) => s.updatePreferences({ stage: clampPref(e.target.value) })}
                maxLength={PREF_MAX_LEN}
                placeholder="如：初中物理，带初三毕业班"
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">表达风格偏好</label>
              <input
                value={pref.style}
                onChange={(e) => s.updatePreferences({ style: clampPref(e.target.value) })}
                maxLength={PREF_MAX_LEN}
                placeholder="如：简洁务实，少用套话"
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
              />
            </div>
          </div>
        </section>

        {/* ── 界面外观：字号拖拽（v0.6.1 评审修订：全局生效，字体设置已按评审移除） ── */}
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <Type size={14} className="text-primary" />
            <h3 className="text-sm font-semibold text-ink">界面字号</h3>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-ink-mute">
            拖拽调整界面字号（{FONT_SIZE_MIN}–{FONT_SIZE_MAX}px，双击重置），全局即时生效：
            侧边栏、顶栏、对话、文档、底部导航等所有文字同步缩放。
            拖到 18px 及以上进入超大档：自动隐藏时间戳、来源等次要信息，适合高龄用户。
          </p>
          <FontSizeSlider
            value={s.fontSize}
            onChange={(px) => s.setFontSize(px)}
            onReset={() => s.setFontSize(FONT_SIZE_DEFAULT)}
          />
          {/* 实时预览：与界面同字号 */}
          <p
            className="mt-3 rounded-2xl border border-line bg-surface-2 px-4 py-3 leading-relaxed text-ink"
            style={{ fontSize: 'var(--content-fs)' }}
          >
            预览：今日教学简报已生成，3 条待办等你处理。
          </p>
        </section>

        {/* ── 模型接入 ── */}
        <section className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-ink">模型接入</h3>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => s.update({ mode: 'mock' })}
              className={cn(
                'rounded-2xl border px-3 py-3 text-left transition-all',
                s.mode === 'mock' ? 'border-primary bg-primary-soft' : 'border-line bg-surface-2 hover:border-primary/40',
              )}
            >
              <p className={cn('text-sm font-medium', s.mode === 'mock' ? 'text-primary' : 'text-ink')}>演示模式</p>
              <p className="mt-0.5 text-[0.6875rem] text-ink-mute">内置剧本，无需联网</p>
            </button>
            <button
              onClick={() => s.update({ mode: 'api' })}
              className={cn(
                'rounded-2xl border px-3 py-3 text-left transition-all',
                s.mode === 'api' ? 'border-primary bg-primary-soft' : 'border-line bg-surface-2 hover:border-primary/40',
              )}
            >
              <p className={cn('text-sm font-medium', s.mode === 'api' ? 'text-primary' : 'text-ink')}>API 模式</p>
              <p className="mt-0.5 text-[0.6875rem] text-ink-mute">OpenAI 兼容接口</p>
            </button>
          </div>

          {s.mode === 'api' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">接入方式</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => s.update({ proxyUrl: '' })}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-xs transition-all',
                      !s.proxyUrl ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface-2 text-ink-soft',
                    )}
                  >
                    浏览器直连
                  </button>
                  <button
                    onClick={() => s.update({ proxyUrl: s.proxyUrl || 'http://localhost:8787/v1' })}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-xs transition-all',
                      s.proxyUrl ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface-2 text-ink-soft',
                    )}
                  >
                    轻后端代理
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">{s.proxyUrl ? '代理地址' : 'Base URL'}</label>
                <input
                  value={s.proxyUrl || s.baseUrl}
                  onChange={(e) => s.update(s.proxyUrl ? { proxyUrl: e.target.value } : { baseUrl: e.target.value })}
                  placeholder={s.proxyUrl ? 'http://localhost:8787/v1' : 'https://api.deepseek.com/v1'}
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">模型 ID</label>
                <input
                  value={s.model}
                  onChange={(e) => s.update({ model: e.target.value })}
                  placeholder="deepseek-chat"
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
                />
              </div>
              {!s.proxyUrl && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-soft">API Key</label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={s.apiKey}
                      onChange={(e) => s.update({ apiKey: e.target.value })}
                      placeholder="sk-..."
                      className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 pr-10 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
                    />
                    <button
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-mute transition-colors hover:text-ink-soft"
                      aria-label={showKey ? '隐藏' : '显示'}
                    >
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  {s.apiKey && <p className="mt-1 text-[0.6875rem] text-ink-mute">已保存：{maskKey(s.apiKey)}</p>}
                  {/* Key 有效性检测（v0.5 M5②） */}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => void runKeyCheck()}
                      disabled={keyChecking}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
                    >
                      <ShieldCheck size={12} className={cn(keyChecking && 'animate-pulse')} />
                      {keyChecking ? '检测中…' : '检测 Key 有效性'}
                    </button>
                    {keyCheck && (
                      <span className={cn('text-[0.6875rem]', keyCheck.ok ? 'text-mint' : 'text-coral')}>
                        {keyCheck.message}
                        {!keyCheck.ok && s.apiKey && /401|无效/.test(keyCheck.message) && '（已自动清空）'}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {/* 单任务 token 预算（v0.5 M3③） */}
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">单任务 token 预算</label>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={s.tokenBudget}
                  onChange={(e) => s.update({ tokenBudget: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-primary"
                />
                <p className="mt-1 text-[0.6875rem] text-ink-mute">超出后 Agent 提前收尾以保证成本可控；0 表示不限制。</p>
              </div>
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-[0.6875rem] leading-relaxed text-amber-700">
                ⚠️ Key 仅存本机浏览器。生产环境请使用轻后端代理（proxy/ 目录），避免 Key 暴露。
              </p>
            </div>
          )}
        </section>

        {/* ── 数据来源（v0.5 M1①） ── */}
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <Database size={14} className="text-primary" />
            <h3 className="text-sm font-semibold text-ink">数据来源</h3>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-ink-mute">
            简报、看板与 Agent 工具的取数入口。演示模式离线可用；远端模式请求失败会自动回落演示数据并标注。导入的班级成绩 CSV 始终最优先。
          </p>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => s.update({ dataSource: 'seed' })}
              className={cn(
                'rounded-2xl border px-3 py-3 text-left transition-all',
                s.dataSource === 'seed' ? 'border-primary bg-primary-soft' : 'border-line bg-surface-2 hover:border-primary/40',
              )}
            >
              <p className={cn('text-sm font-medium', s.dataSource === 'seed' ? 'text-primary' : 'text-ink')}>演示数据</p>
              <p className="mt-0.5 text-[0.6875rem] text-ink-mute">内置数据 + CSV 导入，离线可用</p>
            </button>
            <button
              onClick={() => s.update({ dataSource: 'remote' })}
              className={cn(
                'rounded-2xl border px-3 py-3 text-left transition-all',
                s.dataSource === 'remote' ? 'border-primary bg-primary-soft' : 'border-line bg-surface-2 hover:border-primary/40',
              )}
            >
              <p className={cn('text-sm font-medium', s.dataSource === 'remote' ? 'text-primary' : 'text-ink')}>远端数据平台</p>
              <p className="mt-0.5 text-[0.6875rem] text-ink-mute">经轻后端拉取，失败自动降级</p>
            </button>
          </div>
          {s.dataSource === 'remote' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">数据服务地址</label>
              <input
                value={s.sourceUrl}
                onChange={(e) => s.update({ sourceUrl: e.target.value })}
                placeholder="http://localhost:8787/api/sources"
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
              />
              <p className="mt-1 text-[0.6875rem] text-ink-mute">轻后端需提供 /classes、/region、/school 三个只读端点（见 proxy/）。</p>
            </div>
          )}
        </section>

        {/* ── 导出水印（v0.5 M5③） ── */}
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <Stamp size={14} className="text-primary" />
            <h3 className="text-sm font-semibold text-ink">导出水印</h3>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-ink-mute">
            开启后，导出 Word/PDF 时在页脚附加「机构 · 人员 · 日期」水印，便于材料溯源。
          </p>
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
            <input
              type="checkbox"
              checked={s.watermark.enabled}
              onChange={(e) => s.setWatermark({ enabled: e.target.checked })}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            启用水印
          </label>
          {s.watermark.enabled && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={s.watermark.org}
                onChange={(e) => s.setWatermark({ org: e.target.value })}
                placeholder="机构名称，如：实验一中"
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
              />
              <input
                value={s.watermark.person}
                onChange={(e) => s.setWatermark({ person: e.target.value })}
                placeholder="人员姓名，如：张老师"
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary"
              />
            </div>
          )}
        </section>

        {/* ── 专注模式（v0.7） ── */}
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <Focus size={14} className="text-primary" />
            <h3 className="text-sm font-semibold text-ink">专注模式</h3>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-ink-mute">
            开启后，采纳简报不跳转工作台，任务转入后台执行并有动效提示；全部卡片批示完成后统一处理。关闭则保持原行为（采纳即进入工作台）。
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
            <input
              type="checkbox"
              checked={s.focusMode}
              onChange={(e) => s.setFocusMode(e.target.checked)}
              data-testid="focus-mode-toggle"
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            启用专注模式（默认开启）
          </label>
        </section>

        {/* ── 数据 ── */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink">数据</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => s.resetLLMSettings()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink-soft transition-colors hover:border-primary/40 hover:text-primary"
            >
              <RotateCcw size={12} />
              重置模型设置
            </button>
            <button
              onClick={() => {
                if (confirmClear) {
                  s.clearAllData()
                } else {
                  setConfirmClear(true)
                  setTimeout(() => setConfirmClear(false), 3000)
                }
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition-colors',
                confirmClear
                  ? 'border-danger bg-danger text-white'
                  : 'border-line bg-surface-2 text-ink-soft hover:border-danger/40 hover:text-danger',
              )}
            >
              <Trash2 size={12} />
              {confirmClear ? '确认清空？' : '清空全部数据'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
