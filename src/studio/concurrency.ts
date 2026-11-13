/**
 * v1.2 M0 · studio 融合运行时：并发闸门（ConcurrencyGovernor）
 *
 * 依据 doc/v1.2-roadmap.md §4.2「调度语义」：
 * - 并发上限默认 2（可配），chat 与 MissionRunner 共享同一闸门；
 * - 前台优先出队（同优先级 FIFO），保证教师手动对话不被后台 mission 任务饿死；
 * - release 幂等：重复调用不重复释放；run 在任务抛错时仍释放许可。
 *
 * 边界：主 chunk 薄运行时，无业务依赖、不 import 任何 store（§3.1 四条硬规则）。
 */

/** 许可优先级：前台 = 教师直接发起的交互；后台 = mission 节点/后台任务（v1.2 M0） */
export type ConcurrencyPriority = 'foreground' | 'background'

/** 默认并发上限（roadmap §4.2：并发上限 2） */
export const DEFAULT_CONCURRENCY_LIMIT = 2

export interface ConcurrencyGovernor {
  /** 申请一个许可，resolve 得到幂等的释放函数（缺省前台） */
  acquire(priority?: ConcurrencyPriority): Promise<() => void>
  /** 申请 → 执行 → 释放（抛错也释放） */
  run<T>(priority: ConcurrencyPriority, task: () => Promise<T>): Promise<T>
  /** 当前排队与占用计数（排障/测试用，不参与调度） */
  pending(): { foreground: number; background: number; active: number }
}

/** 排队中的申请者：grant 时把释放函数交还 */
interface Waiter {
  priority: ConcurrencyPriority
  grant: (release: () => void) => void
}

/** 归一优先级：任何非 'background' 的值都按前台处理（缺省前台） */
function normalizePriority(priority?: ConcurrencyPriority): ConcurrencyPriority {
  return priority === 'background' ? 'background' : 'foreground'
}

/** 归一上限：非法值回默认 2，最少保留 1 个许可（0 会死锁） */
function normalizeLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_CONCURRENCY_LIMIT
  return Math.max(1, Math.floor(limit))
}

/**
 * 创建并发闸门（v1.2 M0）。
 * 调度语义固定：前台优先 → 同优先级 FIFO → 出队时立即 grant。
 */
export function createConcurrencyGovernor(opts: { limit?: number } = {}): ConcurrencyGovernor {
  const limit = normalizeLimit(opts.limit)
  let active = 0
  const queue: Waiter[] = []

  /** 新许可的释放函数：闭包自带「已释放」标记，保证幂等 */
  const makeRelease = (): (() => void) => {
    let released = false
    return () => {
      if (released) return
      released = true
      active = Math.max(0, active - 1)
      drain()
    }
  }

  /** 出队：每轮挑第一个前台申请者，否则取队首；容量够就一路 grant */
  const drain = (): void => {
    while (active < limit && queue.length > 0) {
      const index = queue.findIndex((waiter) => waiter.priority === 'foreground')
      const [waiter] = queue.splice(index === -1 ? 0 : index, 1)
      active += 1
      waiter.grant(makeRelease())
    }
  }

  const acquire = (priority?: ConcurrencyPriority): Promise<() => void> =>
    new Promise<() => void>((resolve) => {
      queue.push({ priority: normalizePriority(priority), grant: resolve })
      drain()
    })

  const run = async <T>(priority: ConcurrencyPriority, task: () => Promise<T>): Promise<T> => {
    const release = await acquire(priority)
    try {
      return await task()
    } finally {
      release()
    }
  }

  const pending = (): { foreground: number; background: number; active: number } => ({
    foreground: queue.filter((waiter) => waiter.priority === 'foreground').length,
    background: queue.filter((waiter) => waiter.priority === 'background').length,
    active,
  })

  return { acquire, run, pending }
}
