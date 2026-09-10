/**
 * 稳定行投影（v0.9.3 P0-D③）
 *
 * zustand v5 的 `useShallow` 按元素 `Object.is` 比较：若选择器直接 `map` 出对象数组，
 * 每次求值都是新引用 ⇒ 快照永远"不相等"，既拿不到浅比较的收益，还会让
 * `useSyncExternalStore` 认为快照不稳定（React 会告警甚至反复重渲染）。
 * 因此把每行压成「原始值拼接的字符串」，浅比较即稳定；再用 `useMemo` 还原成对象供渲染。
 */

/** 字段分隔符：控制字符，业务文案 / 标题不会出现 */
const CELL_SEP = '\u0000'

/** 打包一行字段为稳定字符串（字段请按渲染所需顺序传入） */
export function packRow(cells: (string | number)[]): string {
  return cells.join(CELL_SEP)
}

/** 还原 `packRow` 的行字段（与打包顺序一一对应） */
export function unpackRow(row: string): string[] {
  return row.split(CELL_SEP)
}
