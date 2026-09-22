import { describe, expect, it } from 'vitest'
import { CARD_ART, MASCOT_ART, ROLE_ART, SCENE_ART } from '../theme/art'
import indexHtmlRaw from '../../index.html?raw'
import webmanifestRaw from '../../public/site.webmanifest?raw'

/** CardType 全集（src/harness/types.ts:55）。注册表漏配会在 tsc 阶段先报错，此处做运行时复核 */
const CARD_TYPES = ['insight', 'decision', 'creation', 'todo', 'data', 'question'] as const
/** RoleId 全集（src/harness/types.ts:4） */
const ROLE_IDS = ['bureau', 'schoolAdmin', 'teacher'] as const
/** RoleId → 出图文件名片段：口径差 schoolAdmin ↔ role-admin、bureau ↔ role-district */
const ROLE_FILE_FRAGMENT: Record<string, string> = {
  teacher: 'role-teacher',
  schoolAdmin: 'role-admin',
  bureau: 'role-district',
}
/** 必须占据稳定 URL 的 4 张图标（public/ 下的物理文件名） */
const STABLE_ICON_FILES = ['favicon-64.png', 'icon-180.png', 'icon-192.png', 'icon-512.png']

const ALL_ART: [string, string][] = [
  ...Object.entries(CARD_ART).map(([k, v]) => [`card:${k}`, v] as [string, string]),
  ...Object.entries(ROLE_ART).map(([k, v]) => [`role:${k}`, v] as [string, string]),
  ['mascot', MASCOT_ART],
  ...Object.entries(SCENE_ART).map(([k, v]) => [`scene:${k}`, v] as [string, string]),
]

describe('美术资源注册表（v0.9.4-04）', () => {
  it('键集合与 harness 契约一致：卡片 6 / 角色 3 / 空态 3', () => {
    expect(Object.keys(CARD_ART).sort()).toEqual([...CARD_TYPES].sort())
    expect(Object.keys(ROLE_ART).sort()).toEqual([...ROLE_IDS].sort())
    expect(Object.keys(SCENE_ART).sort()).toEqual(['emptyBrief', 'emptyCanvas', 'emptyDoc'])
  })

  it('每个键都指向各自的出图文件（防手写映射复制粘贴串号）', () => {
    for (const type of CARD_TYPES) expect(CARD_ART[type], type).toContain(type)
    for (const id of ROLE_IDS) expect(ROLE_ART[id], id).toContain(ROLE_FILE_FRAGMENT[id])
    expect(MASCOT_ART).toContain('mascot')
    expect(SCENE_ART.emptyBrief).toContain('scene-empty-brief')
    expect(SCENE_ART.emptyCanvas).toContain('scene-empty-canvas')
    expect(SCENE_ART.emptyDoc).toContain('scene-empty-doc')
  })

  it('取值均为非空 .png URL，且全部互不重复', () => {
    for (const [key, url] of ALL_ART) {
      expect(url, key).toBeTruthy()
      expect(url.endsWith('.png'), key).toBe(true)
    }
    const urls = ALL_ART.map(([, url]) => url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('进包图片与稳定 URL 图标分属两条通道，不混用', () => {
    for (const [key, url] of ALL_ART) {
      for (const file of STABLE_ICON_FILES) {
        expect(url.endsWith(`/${file}`), `${key} 不应引用 public/ 稳定 URL 图标`).toBe(false)
      }
    }
  })
})

/**
 * 稳定 URL 通道（public/）：这 4 张被 index.html 与 site.webmanifest 以绝对路径引用，
 * 不进 Vite 哈希管线，因此**没有任何构建期机制能发现路径写错**——只能靠这里的引用面核对。
 * （本仓库 TS 环境无 node 类型，测试内不可读文件系统；文件的真实可达性由 e2e 同源 GET 断言守。）
 */
describe('稳定 URL 资产引用面（v0.9.4-04）', () => {
  it('index.html 引用的 png 恰好是约定的 4 张稳定 URL 图标', () => {
    const hrefs = [...indexHtmlRaw.matchAll(/href="\/([\w.-]+\.png)"/g)].map((m) => m[1])
    expect(hrefs.length).toBeGreaterThan(0)
    for (const name of hrefs) expect(STABLE_ICON_FILES, name).toContain(name)
  })

  it('index.html 已挂上 PWA manifest 与 theme-color', () => {
    expect(indexHtmlRaw).toContain('rel="manifest"')
    expect(indexHtmlRaw).toContain('name="theme-color"')
    expect(indexHtmlRaw).toContain('rel="apple-touch-icon"')
  })

  it('site.webmanifest 的 icons[].src 均指向这 4 张稳定 URL 图标', () => {
    const manifest = JSON.parse(webmanifestRaw)
    expect(manifest.name).toBeTruthy()
    expect(manifest.start_url).toBe('/')
    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const icon of manifest.icons) {
      expect(STABLE_ICON_FILES, icon.src).toContain(icon.src.replace(/^\//, ''))
      expect(icon.type).toBe('image/png')
      expect(icon.sizes).toMatch(/^\d+x\d+$/)
    }
  })
})
