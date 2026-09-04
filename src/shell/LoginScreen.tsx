import { GraduationCap, School, Landmark, Sparkles, ArrowRight } from 'lucide-react'
import { listRoles } from '../harness/roles'
import { toolRegistry } from '../harness/agent'
import type { RolePreset } from '../harness/types'
import { useAuthStore } from '../stores/authStore'
import { cn } from '../lib/cn'

const ACCENT: Record<RolePreset['accent'], { chip: string; ring: string; icon: string; glow: string }> = {
  mint: {
    chip: 'bg-mint-soft text-mint',
    ring: 'hover:border-mint/60',
    icon: 'bg-mint-soft text-mint',
    glow: 'group-hover:shadow-[0_24px_60px_-16px_rgba(42,157,143,0.35)]',
  },
  primary: {
    chip: 'bg-primary-soft text-primary',
    ring: 'hover:border-primary/60',
    icon: 'bg-primary-soft text-primary',
    glow: 'group-hover:shadow-[0_24px_60px_-16px_rgba(79,70,229,0.35)]',
  },
  coral: {
    chip: 'bg-coral-soft text-coral',
    ring: 'hover:border-coral/60',
    icon: 'bg-coral-soft text-coral',
    glow: 'group-hover:shadow-[0_24px_60px_-16px_rgba(255,107,107,0.35)]',
  },
}

const ROLE_ICONS = { teacher: GraduationCap, schoolAdmin: School, bureau: Landmark } as const

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login)

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg">
      {/* 品牌条 */}
      <header className="flex items-center justify-between px-8 pt-7">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-soft">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="text-[17px] font-bold leading-tight tracking-tight">EDUStudio</p>
            <p className="text-xs text-ink-mute">教育 Agent 工作台</p>
          </div>
        </div>
        <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-soft">
          Mock 演示模式 · 离线可用
        </span>
      </header>

      {/* 主体 */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="animate-fade-up text-center">
          <h1 className="text-[28px] font-bold leading-snug tracking-tight">
            选择你的身份，开始今天的工作
          </h1>
          <p className="mt-2 text-[15px] text-ink-soft">
            AI 助手将按角色配置工具与知识，先为你送上一份「今日简报」
          </p>
        </div>

        <div className="mt-10 grid w-full gap-5 md:grid-cols-3">
          {listRoles().map((role, i) => {
            const accent = ACCENT[role.accent]
            const Icon = ROLE_ICONS[role.id]
            return (
              <button
                key={role.id}
                onClick={() => login(role.id)}
                style={{ animationDelay: `${120 + i * 90}ms` }}
                className={cn(
                  'group animate-fade-up rounded-3xl border border-line bg-surface p-6 text-left shadow-card-next transition-all duration-300',
                  'hover:-translate-y-1.5 hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                  accent.ring,
                  accent.glow,
                )}
              >
                <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl', accent.icon)}>
                  <Icon size={22} />
                </div>
                <h2 className="mt-4 text-[17px] font-semibold">{role.name}</h2>
                <p className="mt-0.5 text-xs text-ink-mute">{role.subtitle}</p>
                <p className="mt-3 min-h-[60px] text-sm leading-relaxed text-ink-soft">{role.description}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {role.tools.slice(0, 4).map((t) => (
                    <span key={t} className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', accent.chip)}>
                      {toolRegistry.get(t)?.label ?? t}
                    </span>
                  ))}
                </div>
                <div className="mt-5 flex items-center gap-1.5 text-sm font-medium text-ink-soft transition-colors group-hover:text-ink">
                  进入工作台
                  <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" />
                </div>
              </button>
            )
          })}
        </div>
      </main>

      <footer className="px-8 pb-6 text-center text-xs text-ink-mute">
        EDUStudio v0.1 · 轻量教育 Agent Harness · Mock 剧本驱动，可无缝切换 DeepSeek API
      </footer>
    </div>
  )
}
