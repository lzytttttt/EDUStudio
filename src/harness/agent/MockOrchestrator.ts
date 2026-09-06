import type { AgentProvider, AgentTaskInput, AgentTraceEvent, ArtifactProvider, RoleId } from '../types'
import { FALLBACK_SCRIPTS, buildGenericScript, looksLikeTask } from '../scripts/agent'
import { runScript, type StepContext } from './stepRunner'
import { matchSkill } from '../skills/library'
import { distillSkill } from '../skills/distill'
import { useSkillStore } from '../../stores/skillStore'
import { getMemoryProvider } from '../memory'
import { formatMemoryBlock } from '../memory/format'

/**
 * MockOrchestrator —— 三层执行链（v0.6 M2①）：
 *
 * 1. 技能命中（matchSkill：学习技能优先，内置剧本技能次之）→ emit skill_hit →
 *    按技能步骤执行 → recordUsage（学习技能补 done 收尾）；
 * 2. 未命中且目标为任务型 → 通用探索剧本（plan → 角色工具 → artifact）→
 *    distillSkill 自动沉淀（去重合并则版本+1）→ emit skill_learned；
 * 3. 非任务型（寒暄/咨询）→ 角色降级引导剧本，保证任何输入都有响应。
 *
 * 步骤执行器复用 stepRunner（与 API Orchestrator 的 Plan-JSON 降级共用）。
 */
export class MockOrchestrator implements AgentProvider {
  constructor(private artifacts: ArtifactProvider) {}

  async runTask(input: AgentTaskInput, emit: (e: AgentTraceEvent) => void): Promise<void> {
    const { role, goal, signal } = input
    /** 收集本次执行事件，供任务完成后提炼技能 */
    const collected: AgentTraceEvent[] = []
    const track = (e: AgentTraceEvent) => {
      collected.push(e)
      emit(e)
    }
    const ctx: StepContext = { role, goal, artifacts: this.artifacts, emit: track, signal }

    try {
      const store = useSkillStore.getState()

      // v0.9.1 注入 A（Mock 演示视图）：剧本驱动不消费 systemPrompt，
      // 以 reflect 事件展示「已注入记忆上下文」，让三连演示可见；无记忆/读取失败时静默
      try {
        const memory = getMemoryProvider()
        const [episodic, semantic] = await Promise.all([memory.recentEpisodic(role, 3), memory.semanticFor(role)])
        const block = formatMemoryBlock(episodic, semantic)
        if (block) emit({ kind: 'reflect', text: `已注入记忆上下文：\n${block}` })
      } catch {
        /* 记忆读取失败不影响执行 */
      }

      // 第一/二层：技能命中（学习技能优先于内置剧本技能，matchSkill 内部排序）
      const skill = matchSkill(role, goal, store.learned)
      if (skill) {
        emit({ kind: 'skill_hit', skillId: skill.id, name: skill.name, version: skill.version, origin: skill.origin })
        await runScript(skill.steps, ctx)
        if (skill.origin === 'learned') {
          // 学习技能步骤不含 done（提炼时排除一次性话术），此处补收尾
          emit({ kind: 'done', text: `已按技能「${skill.name}」（v${skill.version}）的沉淀步骤完成执行，无需从零推理。` })
        }
        store.recordUsage(skill.id, skill.origin)
        await this.harvest(goal, role)
        return
      }

      // 第三层 A：任务型目标 → 通用探索执行 + 自动沉淀
      if (looksLikeTask(goal)) {
        const generic = buildGenericScript(role, goal)
        await runScript(generic.steps, ctx)
        this.distillAndEmit(goal, collected, role, emit)
        await this.harvest(goal, role)
        return
      }

      // 第三层 B：非任务型 → 角色降级引导（不沉淀）
      await runScript(FALLBACK_SCRIPTS[role].steps, ctx)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        emit({ kind: 'done', text: '任务已取消。' })
        return
      }
      console.error('[MockOrchestrator] step failed:', err)
      emit({ kind: 'done', text: '执行中遇到问题，已停止。请重试或换个说法描述你的目标。' })
    }
  }

  /** v0.9.1 记忆收割：任务完成（emit done 后）→ L2 情景（outcome='executed'），静默不阻断 */
  private async harvest(goal: string, role: RoleId): Promise<void> {
    try {
      await getMemoryProvider().record({ t: Date.now(), role, kind: 'episodic', goal, outcome: 'executed' })
    } catch {
      /* 记忆写入失败不影响任务 */
    }
  }

  /** 任务完成后自动沉淀（v0.6：无需人工确认）；失败静默跳过，不阻断任务完成 */
  private distillAndEmit(
    goal: string,
    events: AgentTraceEvent[],
    role: RoleId,
    emit: (e: AgentTraceEvent) => void,
  ): void {
    try {
      const store = useSkillStore.getState()
      const result = distillSkill(goal, events, store.learned, role)
      if (!result) return
      if (result.evolved) store.replaceLearned(result.skill)
      else store.addLearned(result.skill)
      emit({
        kind: 'skill_learned',
        skillId: result.skill.id,
        name: result.skill.name,
        version: result.skill.version,
        evolved: result.evolved,
      })
    } catch (err) {
      console.error('[MockOrchestrator] distill failed:', err)
    }
  }
}
