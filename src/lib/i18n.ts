/**
 * 轻量 i18n（v0.5 M4③）：t(key, vars) 取词 + {var} 插值。
 * v0.5 仅落地 zh-CN 字典与调用骨架，为多语言扩展预留结构（新增语言包 + setLocale 即可）。
 */
import { zhCN, type LocaleKey } from '../locales/zh-CN'

export type Locale = 'zh-CN'

const dicts: Record<Locale, Record<LocaleKey, string>> = { 'zh-CN': zhCN }

let locale: Locale = 'zh-CN'

export function setLocale(l: Locale): void {
  locale = l
}

export function getLocale(): Locale {
  return locale
}

/** 取词：未命中返回 key 本身；支持 {var} 插值 */
export function t(key: LocaleKey, vars?: Record<string, string | number>): string {
  let s: string = dicts[locale][key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return s
}
