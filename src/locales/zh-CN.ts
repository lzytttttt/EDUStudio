/**
 * 中文语言包（v0.5 M4③）：i18n 骨架的默认字典。
 * 新增界面文案统一走 t(key)，为多语言扩展预留结构。
 */
export const zhCN = {
  'app.name': 'EDUStudio',
  'nav.list': '列表',
  'nav.chat': '会话',
  'nav.docs': '文档',

  'notif.title': '通知中心',
  'notif.empty': '暂无通知',
  'notif.emptyHint': '评审批注回传、任务链回执会出现在这里',
  'notif.unread': '{count} 未读',
  'notif.markAll': '全部已读',
  'notif.clear': '清空通知',
  'notif.close': '关闭',
  'notif.kind.annotation': '批注',
  'notif.kind.receipt': '回执',
  'notif.kind.task': '任务',
  'notif.kind.system': '系统',

  'share.shortHint': '短链模式：内容已存到轻后端，链接短且不受长度限制；评审人在分享页添加的批注会回传到下方。',
  'share.inlineHint': '链接包含文档只读快照，接收方无需登录即可查看；校长/局角色可在分享页添加批注后回传。',
  'share.received': '收到的批注',
  'share.refresh': '刷新',
  'share.locate': '定位',
  'share.none': '暂无批注。评审人在分享页添加批注后会回传到这里，点击「刷新」即可查看。',
  'share.fetching': '正在拉取批注…',

  'flow.sync.local': '本地模式',
  'flow.sync.syncing': '同步中…',
  'flow.sync.remote': '已同步',
  'flow.sync.degraded': '离线兜底',

  'settings.keyCheck': '检测 Key 有效性',
  'settings.keyValid': 'Key 有效',
  'settings.keyInvalid': 'Key 无效或已过期（401）',
  'settings.keyCleared': '已自动清空失效 Key',
  'settings.tokenBudget': '单任务 token 预算',
  'settings.tokenBudgetHint': '超出后 Agent 提前收尾以保证成本可控；0 表示不限制',
  'settings.watermark': '导出水印',
  'settings.watermarkHint': '导出 Word/PDF 时在页脚附加「机构 · 人员 · 日期」水印',
  'settings.watermarkOrg': '机构名称',
  'settings.watermarkPerson': '人员姓名',
} as const

export type LocaleKey = keyof typeof zhCN
export type LocaleDict = Record<LocaleKey, string>
