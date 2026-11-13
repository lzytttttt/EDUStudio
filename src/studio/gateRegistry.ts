/**
 * v1.2 M3b · 审批门注册表（主 chunk，roadmap §4.4）
 *
 * 唯一出口 `resolveGate(gateId, action)`：mission gate 与 Loom checkpoint 都投影为
 * `ApprovalGate` 并进同一个收件箱 / 同一张决策卡；**同一 gateId 只允许解决一次**（幂等），
 * 保证「同一件事不会两处各点一次」。
 *
 * 边界：主 chunk 极薄运行时（无 React / 无旧 store 依赖）；resolver 由各自的 bridge 注册：
 * - mission：执行控制器在 runner 等待门时 registerGateResolver；
 * - loom：主 chunk 的 loom checkpoint bridge（integrations/studio/loomGates.ts）注册。
 */
export type GateAction = 'continue' | 'cancel'
export type GateResolver = (action: GateAction) => void

const resolvers = new Map<string, GateResolver>()

/**
 * 注册 resolver（同一 gateId 已存在时返回 false，不覆盖——先注册者拥有该门）。
 * 返回的 `dispose` 用于取消注册（runner 被 abort / 门已被外部解决时清理）。
 */
export function registerGateResolver(gateId: string, resolver: GateResolver): { ok: boolean; dispose: () => void } {
  if (resolvers.has(gateId)) return { ok: false, dispose: () => {} }
  resolvers.set(gateId, resolver)
  return {
    ok: true,
    dispose: () => {
      if (resolvers.get(gateId) === resolver) resolvers.delete(gateId)
    },
  }
}

/** 解决审批门（唯一出口）：第一次成功返回 true，重复/未知返回 false（幂等） */
export function resolveGate(gateId: string, action: GateAction): boolean {
  const resolver = resolvers.get(gateId)
  if (!resolver) return false
  resolvers.delete(gateId)
  try {
    resolver(action)
  } catch (error) {
    console.error('[gateRegistry] resolver 异常已隔离:', error)
  }
  return true
}

/** 是否有等待中的 resolver（诊断/单测） */
export function hasGateResolver(gateId: string): boolean {
  return resolvers.has(gateId)
}

/** 清空（单测 / 重置演示用；生产只在卸载 bridge 时按 dispose 清理） */
export function resetGateRegistry(): void {
  resolvers.clear()
}
