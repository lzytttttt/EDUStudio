import type { CardType, RoleId } from '../harness/types'

import cardInsight from '../../png/card/card-insight-512.png'
import cardDecision from '../../png/card/card-decision-512.png'
import cardCreation from '../../png/card/card-creation-512.png'
import cardTodo from '../../png/card/card-todo-512.png'
import cardData from '../../png/card/card-data-512.png'
import cardQuestion from '../../png/card/card-question-512.png'
import roleTeacher from '../../png/role/role-teacher-512.png'
import roleAdmin from '../../png/role/role-admin-512.png'
import roleDistrict from '../../png/role/role-district-512.png'
import mascot from '../../png/role/mascot-512.png'
import sceneEmptyBrief from '../../png/scene/scene-empty-brief-1024.png'
import sceneEmptyCanvas from '../../png/scene/scene-empty-canvas-1024.png'
import sceneEmptyDoc from '../../png/scene/scene-empty-doc-1024.png'
import markColor from '../../png/logo/mark-color-512.png'

/**
 * 美术资源注册表（v0.9.4-04）：scripts/png-art 生成产物的唯一消费入口。
 *
 * 静态 import 不影响首屏字节——Vite 只为被引用的 PNG 各产出一个带哈希的独立文件，
 * 字节只在 <img src> 真正挂载时才被请求（图片不会有 modulepreload），
 * 因此渲染层按需挂载即可，无需按图拆 chunk。
 *
 * `../../png/**` 跨出 src/：png/ 位于项目根内，dev 与 build 均支持；
 * TS 侧由 src/vite-env.d.ts 引入的 vite/client 提供全局 *.png 模块声明。
 * 这些相对路径只出现在本文件，资源若要迁移只需改这一处。
 */

/** 简报卡类型插画：与 harness 契约同源——新增 CardType 而漏配图即编译报错 */
export const CARD_ART: Record<CardType, string> = {
  insight: cardInsight,
  decision: cardDecision,
  creation: cardCreation,
  todo: cardTodo,
  data: cardData,
  question: cardQuestion,
}

/** 角色形象：RoleId 与出图文件名存在口径差（schoolAdmin ↔ role-admin、bureau ↔ role-district） */
export const ROLE_ART: Record<RoleId, string> = {
  teacher: roleTeacher,
  schoolAdmin: roleAdmin,
  bureau: roleDistrict,
}

/** 助手形象：mascot 在领域模型里没有对应角色（RoleId 仅 3 个），独立导出以免破坏 ROLE_ART 的穷尽性 */
export const MASCOT_ART = mascot

/** 空态插画：简报卡组读完 / 空白画布 / 空白文档 */
export const SCENE_ART = {
  emptyBrief: sceneEmptyBrief,
  emptyCanvas: sceneEmptyCanvas,
  emptyDoc: sceneEmptyDoc,
} as const

/** 品牌标：与 favicon 同一母题（圆角方块 + 四角星），用于侧栏与登录页品牌位 */
export const BRAND_ART = { markColor } as const
