import { describe, expect, it } from 'vitest'
import { parseSSEChunk } from '../harness/llm/sse'

describe('parseSSEChunk', () => {
  it('解析完整 data 行（\\n 与 \\r\\n 兼容）', () => {
    const r = parseSSEChunk('data: {"a":1}\ndata: {"b":2}\r\ndata: {"c":3}\n')
    expect(r.events).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
    expect(r.rest).toBe('')
  })

  it('半包留存：无换行结尾的行进入 rest', () => {
    const r = parseSSEChunk('data: {"a":1}\ndata: {"b":')
    expect(r.events).toEqual(['{"a":1}'])
    expect(r.rest).toBe('data: {"b":')
  })

  it('忽略空行、注释行与 event/id 字段行', () => {
    const r = parseSSEChunk(': ping\n\nevent: message\ndata: x\nid: 1\nretry: 100\n')
    expect(r.events).toEqual(['x'])
  })

  it('data: [DONE] 原样透传由调用方判断', () => {
    const r = parseSSEChunk('data: [DONE]\n')
    expect(r.events).toEqual(['[DONE]'])
  })

  it('连续拼接：rest 与新 chunk 拼接后可完整解析', () => {
    const first = parseSSEChunk('data: {"n":')
    const second = parseSSEChunk(first.rest + '1}\ndata: ok\n')
    expect(second.events).toEqual(['{"n":1}', 'ok'])
  })
})
