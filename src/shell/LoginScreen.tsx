import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GraduationCap, School, Landmark, Sparkles, ArrowRight, Eye, EyeOff, User, LockKeyhole,
  LoaderCircle, Zap,
} from 'lucide-react'
import { listRoles } from '../harness/roles'
import type { RolePreset } from '../harness/types'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { frameScheduler } from '../lib/throttle'
import { cn } from '../lib/cn'

const ROLE_ICONS = { teacher: GraduationCap, schoolAdmin: School, bureau: Landmark } as const

const ACCENT: Record<RolePreset['accent'], { ring: string; text: string }> = {
  mint: { ring: 'border-mint/60 bg-mint-soft', text: 'text-mint' },
  primary: { ring: 'border-primary/60 bg-primary-soft', text: 'text-primary' },
  coral: { ring: 'border-coral/60 bg-coral-soft', text: 'text-coral' },
}

/* ── 背景动效（v0.6.1 评审修订）：漂浮「简报卡片/工作台」+ 鼠标视差跟随 + 点击迸裂 ──
   视差：外层按 --mx/--my（-1..1）乘以深度系数位移，内层跑漂浮动画，互不冲突；
   迸裂：点击处生成扩散光环 + 6 枚卡片色粒子沿随机角度飞散，750ms 后回收。 */

/** 漂浮简报卡：骨架线 + 类型徽标，模拟今日简报卡片 */
function FloatCard({ className, delay, duration, depth }: { className: string; delay: string; duration: string; depth: number }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute', className)}
      style={{ transform: `translate3d(calc(var(--mx, 0) * ${depth}px), calc(var(--my, 0) * ${depth * 0.7}px), 0)` }}
    >
      <div
        style={{ animationDelay: delay, animationDuration: duration }}
        className="animate-float rounded-2xl border border-line bg-surface/80 p-3 shadow-card-next backdrop-blur-sm"
      >
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="h-1.5 w-10 rounded-full bg-surface-2" />
        </div>
        <div className="mt-2 h-2 w-20 rounded-full bg-ink/10" />
        <div className="mt-1.5 h-2 w-14 rounded-full bg-surface-2" />
        <div className="mt-1.5 h-2 w-16 rounded-full bg-surface-2" />
      </div>
    </div>
  )
}

/** 迷你工作台窗口：三栏骨架（任务列表 / 对话流 / 文档面板） */
function FloatWorkbench({ className, delay, depth }: { className: string; delay: string; depth: number }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute', className)}
      style={{ transform: `translate3d(calc(var(--mx, 0) * ${depth}px), calc(var(--my, 0) * ${depth * 0.7}px), 0)` }}
    >
      <div
        style={{ animationDelay: delay }}
        className="animate-float overflow-hidden rounded-2xl border border-line bg-surface/85 shadow-card-next backdrop-blur-sm"
      >
        <div className="flex items-center gap-1 border-b border-line px-2.5 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-coral/70" />
          <span className="h-1.5 w-1.5 rounded-full bg-amber/70" />
          <span className="h-1.5 w-1.5 rounded-full bg-mint/70" />
        </div>
        <div className="flex gap-1.5 p-1.5">
          <div className="w-1/4 space-y-1 rounded-lg bg-surface-2 p-1.5">
            <div className="h-1.5 w-full rounded-full bg-ink/10" />
            <div className="h-1.5 w-3/4 rounded-full bg-line" />
            <div className="h-1.5 w-2/3 rounded-full bg-line" />
          </div>
          <div className="flex-1 space-y-1.5 rounded-lg bg-surface-2 p-1.5">
            <div className="ml-auto h-2.5 w-3/5 rounded-full bg-primary/30" />
            <div className="h-2.5 w-4/5 rounded-full bg-line" />
            <div className="h-2.5 w-2/3 rounded-full bg-line" />
            <div className="ml-auto h-2.5 w-1/2 rounded-full bg-primary/30" />
          </div>
          <div className="w-1/4 space-y-1 rounded-lg bg-surface-2 p-1.5">
            <div className="h-1.5 w-full rounded-full bg-line" />
            <div className="h-1.5 w-1/2 rounded-full bg-ink/10" />
            <div className="h-1.5 w-3/4 rounded-full bg-line" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** 点击迸裂：光环 + 粒子（卡片四色），纯 CSS 动画 */
const BIT_COLORS = ['bg-primary', 'bg-mint', 'bg-coral', 'bg-amber', 'bg-primary', 'bg-mint']
function Burst({ x, y }: { x: number; y: number }) {
  const bits = useMemo(
    () =>
      BIT_COLORS.map((color, i) => {
        const angle = (i / BIT_COLORS.length) * Math.PI * 2 + Math.random() * 0.6
        const dist = 34 + Math.random() * 26
        return {
          color,
          bx: `${Math.cos(angle) * dist}px`,
          by: `${Math.sin(angle) * dist}px`,
          delay: `${i * 18}ms`,
        }
      }),
    [],
  )
  return (
    <div aria-hidden className="pointer-events-none fixed z-50" style={{ left: x, top: y }}>
      <div className="animate-burst-ring absolute h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary" />
      {bits.map((b, i) => (
        <span
          key={i}
          style={{ '--bx': b.bx, '--by': b.by, animationDelay: b.delay } as React.CSSProperties}
          className={cn('animate-burst-bit absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-[4px] shadow-soft', b.color)}
        />
      ))}
    </div>
  )
}

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login)
  const roles = listRoles()
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [role, setRole] = useState<RolePreset['id']>('teacher')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([])

  const rootRef = useRef<HTMLDivElement>(null)
  const burstId = useRef(0)
  /* 减弱动效偏好：跳过视差与迸裂 */
  const reduced = useMemo(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  /**
   * 鼠标视差（v0.9.3 P2-A③）：指针位置先入缓存，帧合并后统一写 CSS 变量——
   * 高刷屏 / 快速划动下每帧至多一次样式写入，避免逐事件 setProperty 触发多余样式计算。
   */
  const parallaxRef = useRef<{ x: number; y: number; handle: unknown }>({ x: 0, y: 0, handle: null })

  const handleMouseMove = (e: React.MouseEvent) => {
    if (reduced || !rootRef.current) return
    const p = parallaxRef.current
    p.x = (e.clientX / window.innerWidth - 0.5) * 2
    p.y = (e.clientY / window.innerHeight - 0.5) * 2
    if (p.handle !== null) return
    p.handle = frameScheduler.schedule(() => {
      p.handle = null
      const root = rootRef.current
      if (!root) return
      root.style.setProperty('--mx', p.x.toFixed(3))
      root.style.setProperty('--my', p.y.toFixed(3))
    })
  }

  /* 卸载时撤销未执行的尾帧，避免对已卸载节点写样式 */
  useEffect(() => {
    const p = parallaxRef.current
    return () => {
      if (p.handle !== null) frameScheduler.cancel(p.handle)
    }
  }, [])

  /** 点击响应：任意点击迸裂光环 + 粒子 */
  const handlePointerDown = (e: React.MouseEvent) => {
    if (reduced) return
    const id = ++burstId.current
    setBursts((b) => [...b.slice(-4), { id, x: e.clientX, y: e.clientY }])
    window.setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 800)
  }

  /** 当前所选身份的中文名（演示直达按钮文案随选中角色变化） */
  const roleName = roles.find((r) => r.id === role)?.name ?? '教师'

  /**
   * 演示直达（v0.9.3 P1-B②）：跳过手输与 420ms 假鉴权延迟，按当前所选身份一键进入简报，
   * 并预置「引导已看过」——展会 / 路演现场 ≤1 次点击开演；URL 版直达见 lib/demoEntry.ts（?demo=1）。
   */
  const fastLogin = () => {
    if (submitting) return
    useSettingsStore.getState().markGuideSeen()
    login(role)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (!account.trim()) {
      setError('请输入账号')
      return
    }
    if (!password.trim()) {
      setError('请输入密码')
      return
    }
    setError('')
    setSubmitting(true)
    /* Mock 演示模式：任意账号密码均可登录，短暂延迟模拟鉴权 */
    window.setTimeout(() => login(role), 420)
  }

  return (
    <div
      ref={rootRef}
      onMouseMove={handleMouseMove}
      onMouseDown={handlePointerDown}
      className="relative flex h-full items-center justify-center overflow-hidden bg-bg px-5 py-8"
    >
      {/* ── 背景动效层：点阵网格 + 漂移光斑 + 漂浮简报卡/工作台（鼠标视差跟随） ── */}
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {/* 点阵网格 */}
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{ backgroundImage: 'radial-gradient(rgb(var(--line)) 1px, transparent 1px)', backgroundSize: '26px 26px' }}
        />
        {/* 漂移光斑（深度最大，视差最明显） */}
        <div
          className="animate-drift absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-primary-soft blur-3xl"
          style={{ animationDelay: '0s', transform: 'translate3d(calc(var(--mx, 0) * 34px), calc(var(--my, 0) * 24px), 0)' }}
        />
        <div
          className="animate-drift absolute -bottom-32 left-1/3 h-[380px] w-[380px] rounded-full bg-mint-soft blur-3xl"
          style={{ animationDelay: '-7s', transform: 'translate3d(calc(var(--mx, 0) * -26px), calc(var(--my, 0) * -18px), 0)' }}
        />
        <div
          className="animate-drift absolute -right-24 top-1/4 h-[360px] w-[360px] rounded-full bg-coral-soft blur-3xl"
          style={{ animationDelay: '-13s', transform: 'translate3d(calc(var(--mx, 0) * 30px), calc(var(--my, 0) * -22px), 0)' }}
        />
        {/* 漂浮简报卡片（四角环绕，近大远小） */}
        <FloatCard className="left-[7%] top-[14%] w-36 -rotate-6 opacity-80" delay="0s" duration="7s" depth={16} />
        <FloatCard className="right-[9%] top-[20%] w-32 rotate-6 opacity-70" delay="-2.4s" duration="8.5s" depth={-12} />
        <FloatCard className="bottom-[16%] left-[12%] hidden w-32 rotate-3 opacity-60 md:block" delay="-4.8s" duration="9s" depth={-14} />
        <FloatCard className="bottom-[14%] right-[13%] w-36 rotate-2 opacity-75" delay="-3.6s" duration="7.8s" depth={13} />
        {/* 迷你工作台窗口 */}
        <FloatWorkbench className="left-[22%] top-[8%] hidden h-24 w-44 -rotate-2 opacity-55 lg:block" delay="-1.6s" depth={9} />
        <FloatWorkbench className="bottom-[7%] right-[24%] hidden h-28 w-52 rotate-1 opacity-65 lg:block" delay="-5.2s" depth={-9} />
      </div>

      {/* 点击迸裂层 */}
      {bursts.map((b) => (
        <Burst key={b.id} x={b.x} y={b.y} />
      ))}

      {/* ── 登录卡（紧凑居中，鼠标微倾斜） ── */}
      <section
        className="relative z-10 w-full max-w-[400px]"
        style={{
          transform: 'perspective(1100px) rotateX(calc(var(--my, 0) * -1.6deg)) rotateY(calc(var(--mx, 0) * 2deg))',
          transition: 'transform 0.12s ease-out',
        }}
      >
        <div className="rounded-[28px] border border-line bg-surface/90 p-7 shadow-card backdrop-blur-md sm:p-8">
          {/* 品牌头 */}
          <div className="mb-6 flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-white shadow-soft">
              <Sparkles size={20} />
            </div>
            <div>
              <p className="text-lg font-bold leading-tight tracking-tight">智教工坊 · EDUStudio</p>
              <p className="text-xs text-ink-mute">教育 Agent 工作台</p>
            </div>
          </div>

          <form className="space-y-4" onSubmit={submit} noValidate>
            {/* 账号 */}
            <div>
              <label htmlFor="login-account" className="mb-1.5 block text-xs font-medium text-ink-soft">账号</label>
              <div className="relative">
                <User size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute" />
                <input
                  id="login-account"
                  data-testid="login-account"
                  value={account}
                  onChange={(e) => { setAccount(e.target.value); setError('') }}
                  autoComplete="username"
                  placeholder="手机号 / 邮箱 / 工号"
                  className="h-11 w-full rounded-2xl border border-line bg-surface-2 pl-10 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary focus:bg-surface"
                />
              </div>
            </div>

            {/* 密码 */}
            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-xs font-medium text-ink-soft">密码</label>
              <div className="relative">
                <LockKeyhole size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute" />
                <input
                  id="login-password"
                  data-testid="login-password"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  className="h-11 w-full rounded-2xl border border-line bg-surface-2 pl-10 pr-10 text-sm text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-primary focus:bg-surface"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-mute transition-colors hover:text-ink-soft"
                  aria-label={showPwd ? '隐藏密码' : '显示密码'}
                >
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* 登录身份（沿用 role-card-* testid，供 E2E 与键盘操作） */}
            <div>
              <span className="mb-1.5 block text-xs font-medium text-ink-soft">登录身份</span>
              <div className="grid grid-cols-3 gap-2">
                {roles.map((r) => {
                  const Icon = ROLE_ICONS[r.id]
                  const active = role === r.id
                  const accent = ACCENT[r.accent]
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRole(r.id)}
                      data-testid={`role-card-${r.id}`}
                      aria-pressed={active}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 transition-all',
                        active
                          ? cn(accent.ring, 'shadow-soft')
                          : 'border-line bg-surface-2 hover:border-ink-mute/40',
                      )}
                    >
                      <Icon size={18} className={active ? accent.text : 'text-ink-mute'} />
                      <span className={cn('text-xs font-medium', active ? 'text-ink' : 'text-ink-soft')}>{r.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <p className="animate-fade-in rounded-xl bg-coral-soft px-3 py-2 text-xs text-coral" role="alert">
                {error}
              </p>
            )}

            {/* 登录按钮 */}
            <button
              type="submit"
              data-testid="login-submit"
              disabled={submitting}
              className="group flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-medium text-white shadow-soft transition-all hover:bg-primary-deep hover:shadow-pop active:scale-[0.98] disabled:opacity-70"
            >
              {submitting ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" />
                  正在进入…
                </>
              ) : (
                <>
                  登录
                  <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>

            {/* 演示直达（v0.9.3 P1-B②）：一键跳过手输与首次引导，按当前身份直接进入简报 */}
            <div className="flex items-center gap-2 pt-0.5">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[0.625rem] text-ink-mute">或</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <button
              type="button"
              onClick={fastLogin}
              disabled={submitting}
              data-testid="demo-login"
              className="group flex h-10 w-full items-center justify-center gap-1.5 rounded-2xl border border-primary/40 bg-primary-soft text-xs font-semibold text-primary transition-all hover:border-primary/70 hover:shadow-soft active:scale-[0.98] disabled:opacity-70"
            >
              <Zap size={14} className="transition-transform group-hover:-translate-y-0.5" />
              演示直达 · 以{roleName}身份进入简报
            </button>

            <p className="text-center text-[0.6875rem] leading-relaxed text-ink-mute">
              Mock 演示模式 · 任意账号密码可登录；演示直达跳过手输与首次引导，数据仅存本机
            </p>
          </form>
        </div>
      </section>
    </div>
  )
}
