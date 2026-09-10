import type { RoleId } from '../harness/types'

/** 右栏 tab（v0.9.3 P0-A：由 RightPanel 本地状态上移到 uiStore，便于跨组件联动） */
export type RightTab = 'doc' | 'board' | 'flow'

/** 角色主工作台默认右栏 tab（v0.9.2 P0-B：教师进工作台即见「出题工作台」） */
export const DEFAULT_RIGHT_TAB: Record<RoleId, RightTab> = {
  teacher: 'board',
  schoolAdmin: 'board',
  bureau: 'flow',
}

/** 角色主工作台名称（v0.9.3 P0-A ③：中栏 / 文档面板「返回主工作台」提示复用） */
export const BOARD_LABEL: Record<RoleId, string> = {
  teacher: '出题工作台',
  schoolAdmin: '校情驾驶舱',
  bureau: '区域看板',
}
