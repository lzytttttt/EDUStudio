import type { ChatMessage, LLMProvider, RoleId } from '../types'
import { typewriter } from '../../lib/typewriter'

/** 意图 → 角色化回复（Mock 直答剧本，用于无编排的轻量对话） */
const INTENTS: { match: string[]; reply: (role: RoleId) => string }[] = [
  {
    match: ['你好', '您好', 'hi', 'hello', '在吗'],
    reply: (role) =>
      `你好！我是你的教育 AI 助手。当前身份：${
        role === 'teacher' ? '教师端' : role === 'schoolAdmin' ? '学校管理端' : '教育局端'
      }。可以直接告诉我你想完成的事，比如「帮我备一节物理课」「出一份月度治理简报」「起草一份督导通知」，我会规划步骤并调用工具完成。`,
  },
  {
    match: ['你能做什么', '功能', '帮助', '怎么用'],
    reply: () =>
      '我可以：\n1. **规划并执行任务** —— 输入目标后自动拆解步骤、调用工具（学情查询/区域数据/政策检索/生成教案/命制试题/起草通知等）；\n2. **产出文档** —— 教案、报告、通知等会流式生成到右侧工作区，可编辑导出；\n3. **主动简报** —— 每日为你推送洞察/决策/待办卡片，采纳后自动进入工作流。',
  },
  {
    match: ['谢谢', '感谢', '辛苦'],
    reply: () => '不客气！有新任务随时告诉我。也可以把常用需求告诉我，我会记住你的偏好。',
  },
]

const FALLBACK: Record<RoleId, string> = {
  teacher:
    '收到。作为你的教学助手，我建议把这个需求拆成两步：先明确学情与课标要求，再产出具体材料。' +
    '你可以更具体地描述，例如「针对高一（3）班函数单调性薄弱点，出一组分层练习题」，我会调用学情查询与试题命制工具完成。',
  schoolAdmin:
    '收到。作为治理助手，我会先核对相关数据再给结论。例如「对比高一两个班本月物理成绩并给出预警建议」，' +
    '我会调用校情统计与学情查询工具，输出带数据依据的分析。请补充你想聚焦的班级或事项。',
  bureau:
    '收到。作为区域公文助手，我会确保行文规范、数据可溯源。例如「汇总本学期区域教学质量情况并起草季度报告」，' +
    '我会调用区域数据与政策检索工具，按公文结构产出文稿。请补充具体事项或文种要求。',
}

export class MockLLMProvider implements LLMProvider {
  private role: RoleId

  constructor(role: RoleId = 'teacher') {
    this.role = role
  }

  setRole(role: RoleId): void {
    this.role = role
  }

  async *streamChat(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const text = lastUser?.content ?? ''
    const hit = INTENTS.find((i) => i.match.some((k) => text.toLowerCase().includes(k)))
    const reply = hit ? hit.reply(this.role) : FALLBACK[this.role]
    yield* typewriter(reply, { signal })
  }
}
