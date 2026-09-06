import { X, MousePointerClick, Keyboard, Layers, FileText, MessageSquare, SlidersHorizontal, Sparkles, Compass } from 'lucide-react'
import { cn } from '../lib/cn'
import { useDialogA11y } from '../lib/useDialogA11y'

export type GuideStage = 'briefing' | 'workbench'

const BRIEFING_STEPS = [
  { icon: Layers, title: '浏览今日简报', desc: '按角色推送的待办卡片，逐张处理：采纳生成文档、转为任务、或忽略' },
  { icon: Keyboard, title: '键盘快捷翻页', desc: '←/→ 或 A/D 切换卡片，数字键 1/2/3 快速选择处理方式' },
  { icon: MousePointerClick, title: '一键进入执行', desc: '选择「转任务」后自动进入工作台，Agent 开始规划与执行' },
  { icon: Compass, title: '随时切换角色', desc: '右上角头像菜单可切换教师 / 校长 / 教育局角色视角' },
]

const WORKBENCH_STEPS = [
  { icon: MessageSquare, title: '中栏 · 对话执行', desc: '描述目标（如「备一节摩擦力教案」），Agent 自动规划步骤、调用工具并产出文档' },
  { icon: SlidersHorizontal, title: '快捷指令可自定义', desc: '输入框上方 chips 一键发起常用任务；点「管理」可增删，按角色分别保存' },
  { icon: FileText, title: '右栏 · 文档工作区', desc: '生成结果实时流入；支持在线编辑、导出 Markdown/Word/PDF、版本历史恢复' },
  { icon: Sparkles, title: '角色增强面板', desc: '教师：出题工作台；校长：校情驾驶舱；教育局：区域指标看板，与对话联动' },
]

/** 操作说明引导（v0.3 UI 专项）：首次进入自动弹出，可从侧栏「使用指南」随时重看 */
export default function GuideDialog({ stage, onClose }: { stage: GuideStage; onClose: () => void }) {
  const steps = stage === 'briefing' ? BRIEFING_STEPS : WORKBENCH_STEPS
  const title = stage === 'briefing' ? '欢迎使用智教工坊（EDUStudio）' : '工作台使用指南'
  const dialogRef = useDialogA11y<HTMLDivElement>(true, onClose)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="animate-fade-up w-full max-w-md overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-gradient-to-br from-primary-soft to-surface px-6 pb-5 pt-6">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-xl text-ink-mute transition-colors hover:bg-surface hover:text-ink"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-soft">
            <Compass size={20} />
          </div>
          <h2 className="mt-3 text-lg font-bold text-ink">{title}</h2>
          <p className="mt-1 text-xs text-ink-soft">
            {stage === 'briefing' ? '三步上手，1 分钟了解核心操作' : '三栏协同：对话执行 × 文档产出 × 数据看板'}
          </p>
        </div>

        <ol className="space-y-1 px-4 py-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex items-start gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-surface-2">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <s.icon size={15} />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <span className="text-[0.625rem] font-bold text-ink-mute">{i + 1}</span>
                  {s.title}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-mute">{s.desc}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className={cn('border-t border-line px-6 py-4')}>
          <button
            onClick={onClose}
            className="w-full rounded-2xl bg-primary py-2.5 text-sm font-semibold text-white transition-all hover:bg-primary-deep active:scale-[0.98]"
            data-testid="guide-done"
          >
            知道了，开始使用
          </button>
        </div>
      </div>
    </div>
  )
}
