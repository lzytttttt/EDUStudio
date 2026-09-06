/**
 * 相对时间格式化（v0.9.2 P1-A）
 *
 * 侧栏任务卡的时间按「工作记忆」组织：老师按内容找任务，时间只用于锚定回忆——
 * 今天给时刻、昨天给「昨天」、本周给星期几、上周给「上周X」、更早给具体日期。
 * 纯函数：now 可注入，方便单测与未来按需重放。
 */
const DAY = 86_400_000
/** 星期简称（不含「周」字）：本周拼「周四」、上周拼「上周四」 */
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'] as const

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 相对时间：ts 晚于 now（时钟回拨/异常数据）按今天处理，非法时间戳返回空串 */
export function relativeTime(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const n = new Date(now)
  if (ts > now) return `${pad(d.getHours())}:${pad(d.getMinutes())}`

  const dayStart = startOfDay(ts)
  const todayStart = startOfDay(now)
  const dayDiff = Math.round((todayStart - dayStart) / DAY)
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`

  if (dayDiff <= 0) return hhmm
  if (dayDiff === 1) return `昨天 ${hhmm}`

  /* 本周内（自周一起，中国习惯）：直接说星期几 */
  const mondayStart = startOfDay(todayStart - ((n.getDay() + 6) % 7) * DAY)
  if (dayStart >= mondayStart) return `周${WEEK_CN[d.getDay()]}`
  /* 上周：上周X */
  if (dayStart >= startOfDay(mondayStart - 7 * DAY)) return `上周${WEEK_CN[d.getDay()]}`
  /* 更早：M月D日；跨年补年份 */
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === n.getFullYear() ? md : `${d.getFullYear()}年${md}`
}
