/**
 * v0.5 收尾验收 · proxy 端到端实测（临时脚本，跑完即删）
 * 覆盖验收标准 ②③⑥ 的服务端链路 + M5① 审计 + M4⑤ telemetry + M5② Key 检测
 */
const BASE = 'http://localhost:8787'
let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name} ${detail}`)
  }
}
async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, data }
}

async function main() {
  console.log('== 验收② 分享短链 + 批注回流 ==')
  const snap = {
    title: '期中质量分析报告',
    content: '# 期中质量分析\n\n三年级数学均分下降 4.2 分，薄弱点为分数应用题。',
    kind: 'report',
    author: '王老师',
    createdAt: Date.now(),
  }
  const created = await j('POST', '/v1/share', snap)
  check('POST /v1/share 返回 id', created.status === 200 && typeof created.data?.id === 'string')
  const id = created.data?.id ?? ''
  check('短链 id ≤ 12 字符（base64url 短码）', id.length > 0 && id.length <= 12, `len=${id.length}`)
  const got = await j('GET', `/v1/share/${id}`)
  check('GET /v1/share/:id 快照回读', got.status === 200 && got.data?.snapshot?.title === snap.title)
  const anno = await j('POST', `/v1/share/${id}/annotations`, {
    annotations: [{ id: 'a1', author: '李主任', role: 'schoolAdmin', quote: '均分下降 4.2 分', text: '建议补充错因分析', createdAt: Date.now() }],
  })
  check('POST annotations 批注回传', anno.status === 200 && anno.data?.ok === true)
  const back = await j('GET', `/v1/share/${id}`)
  check('作者端拉到批注（回流）', back.data?.annotations?.length === 1 && back.data.annotations[0].text === '建议补充错因分析')

  console.log('== M5① 内容审计 ==')
  const blocked = await j('POST', '/v1/share', { title: 't', content: '这是含赌博内容的文本' })
  check('敏感词拦截 400', blocked.status === 400 && String(blocked.data?.error).startsWith('content_blocked'))
  const tooLong = await j('POST', '/v1/share', { title: 't', content: 'x'.repeat(200001) })
  check('超长拦截 400', tooLong.status === 400 && tooLong.data?.error === 'content_too_long')

  console.log('== 验收③ 任务链状态机（局→校→教师） ==')
  const flowRes = await j('POST', '/v1/flows', {
    title: '关于开展期中质量分析的通知',
    content: '请各校于本周五前完成质量分析并回执。',
    deadline: '本周五 17:00',
    from: '区教育局',
    fromRole: 'bureau',
    targets: [{ name: '实验小学', role: 'schoolAdmin' }, { name: '张老师', role: 'teacher' }],
  })
  const flow = flowRes.data?.flow
  check('POST /v1/flows 下发（receipts 全 pending）', flowRes.status === 200 && flow?.receipts?.every((r) => r.status === 'pending'))
  const list1 = await j('GET', '/v1/flows')
  check('GET /v1/flows 列表含新任务', list1.data?.flows?.some((f) => f.id === flow.id))
  const ack = await j('POST', `/v1/flows/${flow.id}/acknowledge`, { receiptId: flow.receipts[0].id })
  check('校长确认 → acknowledged', ack.data?.flow?.receipts[0]?.status === 'acknowledged')
  const sub = await j('POST', `/v1/flows/${flow.id}/submit`, { receiptId: flow.receipts[0].id, note: '已完成分析' })
  check('教师提交 → submitted + note', sub.data?.flow?.receipts[0]?.status === 'submitted' && sub.data.flow.receipts[0].note === '已完成分析')
  const list2 = await j('GET', '/v1/flows')
  const f2 = list2.data.flows.find((f) => f.id === flow.id)
  check('局端轮询看到回执', f2?.receipts[0]?.status === 'submitted' && f2.receipts[1]?.status === 'pending')

  console.log('== M4⑤ telemetry ==')
  const tel = await j('POST', '/v1/telemetry', { type: 'error', message: 'test: unhandled rejection', source: 'e2e-verify', url: 'http://localhost:5173/' })
  check('POST /v1/telemetry ok', tel.status === 200 && tel.data?.ok === true)

  console.log('== M5② Key 检测（无 key 时 /v1/models） ==')
  const models = await j('GET', '/v1/models')
  check('无 key → 401/错误提示（不崩溃）', models.status === 401 || models.status === 500 || models.data?.error, `status=${models.status}`)

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch((e) => {
  console.error('脚本异常:', e)
  process.exit(1)
})
