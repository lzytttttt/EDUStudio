/**
 * MockOrchestrator —— 三层执行链（v0.6 M2①）：
 *
 * 1. 技能命中（matchSkill：学习技能优先，内置剧本技能次之）→ emit skill_hit →
 *    按技能步骤执行 → recordUsage（学习技能补 done 收尾）；
 * 2. 未命中且目标为任务型 → 通用探索剧本（plan → 角色工具 → artifact）→
 *    distillSkill 自动沉淀（去重合并则版本+1）→ emit skill_learned；
 * 3. 非任务型（寒暄/咨询）→ 角色降级引导剧本，保证任何输入都有响应。
 *
 * v1.2 M3a（roadmap §4.3）：mission 内任务以 Agent 身份执行（input.agent 存在时）：
 * - 开场先 emit 岗位 reflect「<name> · 岗位执行（<id>）」；
 * - 三级执行链保持原样，但通用探索脚本中不在工具白名单的 tool 步骤降级为 text（不调用越权工具）；
 * - 交付物标题加岗位前缀「<name> · <title>」，kind 按岗位确定性映射（analyst→analysis 等）。
 * input.agent 缺省时行为与旧版逐字节一致（新增逻辑全部分支在 agent 存在时）。
 *
 * 步骤执行器复用 stepRunner（与 API Orchestrator 的 Plan-JSON 降级共用）。
 */
import type {
  AgentProvider,
  AgentTaskContext,
  AgentTaskInput,
  AgentTraceEvent,
  ArtifactKind,
  ArtifactProvider,
  RoleId,
} from '../types'
import { FALLBACK_SCRIPTS, GENERIC_DONE_TEXT, buildGenericScript, looksLikeTask } from '../scripts/agent'
import type { ScriptStep } from '../scripts/agent'
import { runScript, runScriptStep, type StepContext } from './stepRunner'
import { matchSkill } from '../skills/library'
import { distillSkill } from '../skills/distill'
import { useSkillStore } from '../../stores/skillStore'
import { getMemoryProvider } from '../memory'
import { upstreamReflectText } from '../loom/context'
import { agentDisplayName, agentRoleOf } from './agentPrompt'

/** 岗位 → 交付物 kind 的确定性映射（v1.2 M3a；未登记的 id 保留原剧本 kind） */
export const AGENT_ARTIFACT_KIND: Record<string, ArtifactKind> = {
  chief: 'generic',
  analyst: 'analysis',
  assessor: 'generic',
  curriculum: 'lessonPlan',
  communicator: 'notice',
  steward: 'generic',
}

export class MockOrchestrator implements AgentProvider {
  constructor(private artifacts: ArtifactProvider) {}

  async runTask(input: AgentTaskInput, emit: (e: AgentTraceEvent) => void): Promise<void> {
    const { goal, signal } = input
    /**
     * v1.2 M3a：mission 内 Agent 身份。agent 缺省时 role 即 input.role，
     * 三级执行链、事件序列与旧版逐字节一致；存在时才走岗位化行为。
     */
    const agent = input.agent
    const role = agentRoleOf(agent, input.role)
    const positionName = agent ? agentDisplayName(agent) : ''
    const agentKind = agent ? AGENT_ARTIFACT_KIND[agent.id] : undefined

    // v1.2 M3a：agent 分支开场先亮明岗位（含 name/id），让教师看到「谁在执行」
    if (agent) {
      emit({ kind: 'reflect', text: `${positionName} · 岗位执行（${agent.id}）` })
    }
    // v0.9.4 M5：Loom 上游结果注入——Mock 用一条 reflect 展示「已接收上游结果」，串联真执行链路
    const upstream = input.context?.upstream
    if (upstream && upstream.length > 0) emit({ kind: 'reflect', text: upstreamReflectText(upstream) })
    /** 收集本次执行事件，供任务完成后提炼技能 */
    const collected: AgentTraceEvent[] = []
    const track = (e: AgentTraceEvent) => {
      collected.push(e)
      emit(e)
    }
    /**
     * v1.2 M3a：agent 分支的 artifact_meta 也带岗位前缀并映射 kind，
     * 与 artifact_done（由 ArtifactProvider 装饰器产出）保持同一口径，便于 runner 区分产物。
     */
    const agentTrack = (e: AgentTraceEvent): void => {
      if (e.kind === 'artifact_meta') {
        track({
          ...e,
          title: `${positionName} · ${e.title}`,
          ...(agentKind ? { docKind: agentKind } : {}),
        })
        return
      }
      track(e)
    }
    const ctx: StepContext = {
      role,
      goal,
      artifacts: agent ? this.artifactsForAgent(agent, positionName) : this.artifacts,
      emit: agent ? agentTrack : track,
      signal,
      /* v0.9.4-03：上游结果透传（Mock 文档模板不消费，保持与 API 路径同一契约） */
      ...(upstream?.length ? { upstream } : {}),
    }

    try {
      const store = useSkillStore.getState()

      // v0.9.1 注入 A（Mock 演示视图）：剧本驱动不消费 systemPrompt，
      // 以 reflect 事件展示「已注入记忆上下文」，让三连演示可见；无记忆/读取失败时静默。
      // v0.9.3 P1-A②：压成一行摘要，联排演示时开场不随记忆条数变长（详情不再铺开）
      try {
        const memory = getMemoryProvider()
        const [episodic, semantic] = await Promise.all([memory.recentEpisodic(role, 3), memory.semanticFor(role)])
        const parts: string[] = []
        if (episodic.length) parts.push(`场景记忆 ${episodic.length} 条`)
        if (semantic.length) parts.push(`用户偏好 ${semantic.length} 条`)
        if (parts.length) emit({ kind: 'reflect', text: `已注入记忆上下文：${parts.join(' · ')}` })
      } catch {
        /* 记忆读取失败不影响执行 */
      }

      // 第一/二层：技能命中（学习技能优先于内置剧本技能，matchSkill 内部排序）
      const skill = matchSkill(role, goal, store.learned)
      if (skill) {
        emit({ kind: 'skill_hit', skillId: skill.id, name: skill.name, version: skill.version, origin: skill.origin })
        /* v1.2 M3a 收口：agent 存在时技能步骤同样过工具白名单（越权 tool 步骤降级 text，顺序不变） */
        const skillSteps = agent ? filterAgentSteps(skill.steps, agent) : skill.steps
        await runScript(skillSteps, ctx)
        if (skill.origin === 'learned') {
          // 学习技能步骤不含 done（提炼时排除一次性话术），此处补收尾
          emit({ kind: 'done', text: `已按技能「${skill.name}」（v${skill.version}）的沉淀步骤完成执行，无需从零推理。` })
        }
        store.recordUsage(skill.id, skill.origin)
        await this.harvest(goal, role)
        return
      }

      // 第三层 A：任务型目标 → 通用探索执行 + 自动沉淀
      // v0.9.3 P1-A①：沉淀高光前置——artifact 之后先 emit skill_learned，再补收尾 done
      if (looksLikeTask(goal)) {
        const generic = buildGenericScript(role, goal)
        /* v1.2 M3a：agent 分支把白名单外 tool 步骤降级为 text，绝不调用越权工具 */
        const steps = agent ? filterAgentSteps(generic.steps, agent) : generic.steps
        await runScript(steps, ctx)
        this.distillAndEmit(goal, collected, role, emit)
        await runScriptStep({ type: 'done', text: GENERIC_DONE_TEXT }, ctx)
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

  /** v1.2 M3a：交付物装饰器——标题加岗位前缀、kind 按岗位映射（缺省 agent 不包装） */
  private artifactsForAgent(agent: AgentTaskContext, positionName: string): ArtifactProvider {
    const agentKind = AGENT_ARTIFACT_KIND[agent.id]
    return {
      generate: async (input, onChunk) => {
        const result = await this.artifacts.generate(input, onChunk)
        return {
          title: `${positionName} · ${result.title}`,
          kind: agentKind ?? result.kind,
        }
      },
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

/**
 * v1.2 M3a：把剧本中不在 agent 工具白名单的步骤降级为文字说明（不调用越权工具）。
 * 纯函数（导出便于单测）：tool/parallel 步骤按工具名过滤；其余步骤原样透传。
 */
export function filterAgentSteps(steps: ScriptStep[], agent: AgentTaskContext): ScriptStep[] {
  const allowed = new Set(agent.tools)
  const out: ScriptStep[] = []
  const downgrade = (tool: string): ScriptStep => ({
    type: 'text',
    text: `（岗位边界）已跳过白名单外工具 ${tool}，本轮改用文字说明，不调用该工具。`,
  })
  for (const step of steps) {
    if (step.type === 'tool') {
      out.push(allowed.has(step.tool) ? step : downgrade(step.tool))
      continue
    }
    if (step.type === 'parallel') {
      const kept = step.steps.filter((sub) => allowed.has(sub.tool))
      if (kept.length > 0) out.push({ ...step, steps: kept })
      for (const sub of step.steps) {
        if (!allowed.has(sub.tool)) out.push(downgrade(sub.tool))
      }
      continue
    }
    out.push(step)
  }
  return out
}
