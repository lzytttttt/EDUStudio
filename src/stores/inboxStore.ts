/**
 * inboxStore —— 决策覆盖态（v1.2 M0，roadmap §2.4「决策」行）
 *
 * 边界：只存 done / snoozed / 时间窗，不存任务本体，不持久化（M2 起并入 director 键）。
 * 派生列表仍由 `src/studio/inbox.ts` 的 deriveInbox 纯函数计算，本 store 不重复派生。
 */
import { create } from 'zustand'
import type { InboxOverrides } from '../studio/inbox'

/** 覆盖态状态（与 InboxOverrides 收敛，避免两套枚举） */
export type InboxOverrideStatus = 'done' | 'snoozed'

export interface InboxStoreState {
  overrides: InboxOverrides
  /** 标记已处理（done） */
  resolve: (id: string) => void
  /** 稍后提醒：时间窗内不出现，到期自动回归 */
  snooze: (id: string, until: number) => void
  /** 直接设置覆盖态（done 记处理时间；snoozed 保留已有时间窗） */
  setStatus: (id: string, status: InboxOverrideStatus) => void
  /** 清空全部覆盖态（不碰来源数据） */
  reset: () => void
}

export const useInboxStore = create<InboxStoreState>((set, get) => ({
  overrides: {},

  resolve: (id) => {
    set({
      overrides: {
        ...get().overrides,
        [id]: { status: 'done', resolvedAt: Date.now() },
      },
    })
  },

  snooze: (id, until) => {
    set({
      overrides: {
        ...get().overrides,
        [id]: { status: 'snoozed', snoozeUntil: until },
      },
    })
  },

  setStatus: (id, status) => {
    const existing = get().overrides[id]
    set({
      overrides: {
        ...get().overrides,
        [id]:
          status === 'done'
            ? { status, resolvedAt: Date.now() }
            : {
                status,
                // snoozed 且已有时间窗时保留（避免 setStatus 抹掉 snooze）
                ...(typeof existing?.snoozeUntil === 'number'
                  ? { snoozeUntil: existing.snoozeUntil }
                  : {}),
              },
      },
    })
  },

  reset: () => set({ overrides: {} }),
}))
