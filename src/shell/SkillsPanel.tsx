import { useState } from 'react'
import { Sparkles, ChevronDown, Trash2, Power, Pencil, Check, X } from 'lucide-react'
import { useSkillStore, allSkills, statsOf } from '../stores/skillStore'
import type { Skill } from '../harness/skills/types'
import { cn } from '../lib/cn'

function relTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

const EVOLUTION_LABEL = { created: '创建', refined: '触发词扩充', feedback: '反馈修正' } as const

/** 技能卡片：名称 + vN 徽标 + 触发词 chips + 使用统计 + 来源徽标；展开含详情与管理 */
function SkillCard({ skill }: { skill: Skill }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const updateLearned = useSkillStore((s) => s.updateLearned)
  const removeLearned = useSkillStore((s) => s.removeLearned)
  const stats = statsOf(skill)
  const successRate = stats.usageCount > 0 ? Math.round((stats.successCount / stats.usageCount) * 100) : null
  const isLearned = skill.origin === 'learned'

  const startEdit = () => {
    setDraft(skill.triggers.join('、'))
    setEditing(true)
  }
  const saveEdit = () => {
    const triggers = draft.split(/[、,，;；\s]+/).map((t) => t.trim()).filter(Boolean)
    if (triggers.length > 0) updateLearned(skill.id, { triggers })
    setEditing(false)
  }

  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5 transition-colors hover:border-primary/40">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 text-left">
        <Sparkles size={13} className={cn('mt-0.5 shrink-0', isLearned ? 'text-mint' : 'text-ink-mute')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className={cn('truncate text-[13px] font-medium leading-tight', !skill.enabled && 'text-ink-mute line-through')}>
              {skill.name}
            </p>
            <span className="shrink-0 rounded-md bg-primary-soft px-1 text-[9px] font-bold text-primary">v{skill.version}</span>
            <span
              className={cn(
                'shrink-0 rounded-md px-1 text-[9px] font-medium',
                isLearned ? 'bg-mint-soft text-mint' : 'border border-line text-ink-mute',
              )}
            >
              {isLearned ? '学习' : '内置'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {skill.triggers.slice(0, 4).map((t) => (
              <span key={t} className="rounded-md bg-primary-soft px-1.5 py-0.5 text-[10px] text-primary">
                {t}
              </span>
            ))}
            {skill.triggers.length > 4 && <span className="text-[10px] text-ink-mute">+{skill.triggers.length - 4}</span>}
          </div>
          <p className="minor-info mt-1 text-[10px] text-ink-mute">
            使用 {stats.usageCount} 次{successRate !== null && ` · 成功率 ${successRate}%`}
            {stats.lastUsedAt > 0 && ` · ${relTime(stats.lastUsedAt)}`}
          </p>
        </div>
        <ChevronDown size={13} className={cn('mt-1 shrink-0 text-ink-mute transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-2 space-y-2.5 border-t border-line pt-2">
          <p className="text-[11px] leading-relaxed text-ink-soft">{skill.description}</p>

          {/* 触发词编辑（仅学习技能） */}
          {isLearned &&
            (editing ? (
              <div className="flex items-center gap-1">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoFocus
                  className="min-w-0 flex-1 rounded-lg border border-primary/40 bg-surface-2 px-2 py-1 text-[11px] outline-none focus:border-primary"
                  placeholder="触发词用顿号分隔"
                />
                <button
                  onClick={saveEdit}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-white"
                  aria-label="保存触发词"
                >
                  <Check size={12} />
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-mute hover:bg-surface-2"
                  aria-label="取消编辑"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={startEdit}
                className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <Pencil size={11} /> 编辑触发词
              </button>
            ))}

          {/* 进化时间线 */}
          <div>
            <p className="text-[10px] font-semibold text-ink-mute">进化记录</p>
            <div className="mt-1.5 space-y-1.5 border-l border-mint/40 pl-2.5">
              {[...skill.evolution].reverse().map((e, i) => (
                <div key={`${e.at}-${i}`} className="relative">
                  <span className="absolute -left-[13px] top-1 h-1.5 w-1.5 rounded-full bg-mint" />
                  <p className="text-[10px] leading-snug text-ink-soft">
                    v{e.version} · {EVOLUTION_LABEL[e.kind]} · {relTime(e.at)}
                  </p>
                  <p className="text-[10px] leading-snug text-ink-mute">{e.note}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 管理操作 */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => isLearned && updateLearned(skill.id, { enabled: !skill.enabled })}
              disabled={!isLearned}
              title={isLearned ? undefined : '内置技能不可停用'}
              className={cn(
                'flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] transition-colors',
                isLearned ? 'text-ink-soft hover:bg-surface-2' : 'cursor-not-allowed text-ink-mute/50',
              )}
            >
              <Power size={11} /> {skill.enabled ? '停用' : '启用'}
            </button>
            {isLearned && (
              <button
                onClick={() => removeLearned(skill.id)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-danger transition-colors hover:bg-danger/10"
              >
                <Trash2 size={11} /> 删除
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** 技能库面板（Sidebar 第 4 个 tab，v0.6 M3①） */
export default function SkillsPanel() {
  const learned = useSkillStore((s) => s.learned)
  const clearLearned = useSkillStore((s) => s.clearLearned)
  const [confirmClear, setConfirmClear] = useState(false)
  const skills = allSkills(learned)

  return (
    <div className="space-y-1.5">
      <p className="rounded-xl bg-mint-soft px-3 py-2 text-[10px] leading-relaxed text-mint">
        完成任务后，Agent 会自动复盘沉淀技能；同类任务将直接命中复用。
      </p>
      {skills.map((s) => (
        <SkillCard key={s.id} skill={s} />
      ))}
      {learned.length > 0 &&
        (confirmClear ? (
          <div className="flex items-center justify-between rounded-xl border border-danger/30 bg-danger/5 px-3 py-2">
            <p className="text-[10px] text-danger">清空 {learned.length} 条学习技能？</p>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  clearLearned()
                  setConfirmClear(false)
                }}
                className="rounded-lg bg-danger px-2 py-1 text-[10px] font-medium text-white"
              >
                确认
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="rounded-lg px-2 py-1 text-[10px] text-ink-mute hover:bg-surface-2"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmClear(true)}
            className="flex w-full items-center justify-center gap-1 rounded-xl border border-line px-3 py-2 text-[10px] text-ink-mute transition-colors hover:border-danger/40 hover:text-danger"
          >
            <Trash2 size={11} /> 清空学习技能（{learned.length}）
          </button>
        ))}
    </div>
  )
}
