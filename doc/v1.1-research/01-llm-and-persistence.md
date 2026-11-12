# v1.1 研究 01 · 真 LLM 拆解接入 + 状态持久化

> 范围：只做「拆解真、执行/产物仍 Mock」；只服务 `?v1=1`；不碰旧简报/工作台/Loom/chatStore。总方案见 [v1.1-roadmap.md](../v1.1-roadmap.md)。
>
> **结论**：① 零新依赖成立——唯一扩展是 `StreamChatRawOptions`（`src/harness/types.ts:28-31`）加 `temperature/maxTokens` 并合入请求体（现只发 model/messages/stream，`src/harness/llm/adapter.ts:106-107`）；② 先修 P0 数据（§2）；③ 拆解＝单次结构化生成＋本地校验＋模板兜底，复用 `src/harness/briefing/ApiBriefingProvider.ts:24-26,168-177`；④ 新键 `edustudio:director` v1，`running`→`paused`+「继续」（§4）；⑤ 7 处待拍板（§6）。

## 1. 边界与可复用存量

| 能力 | 现状 | 证据 |
| --- | --- | --- |
| 入口 | `?v1=1` 自动登录直达 `command`，独立 lazy chunk | `src/lib/directorEntry.ts:7-10`；`src/main.tsx:46-50`；`src/App.tsx:13,102-105` |
| 委托 | `dispatch` 只弹「拆成 5 个环节」并开作战室，输入草稿未参与拆解 | `src/apps/director/InboxSurface.tsx:435-440` |
| 计划 | 固定 5 环节 / 2 门 / 4 产物，全常量 | `src/harness/director/data.ts:157-163,190-202,205-262`；`src/harness/director/types.ts:73-92` |
| 执行 | `setTimeout` 时间线 + 模块级 timers；状态全内存 | `src/stores/directorStore.ts:49-62,164-169,241-296` |
| 持久化 | 仅引导已读，且 raw localStorage 独立键绕过 storage 抽象 | `src/stores/directorStore.ts:29-45`；`src/lib/storage.ts:5-22` |

## 2. P0 前置修复

### 2.1 百分比重复 ×100（必修）

| 位置 | 现输出 | 应为 | 依据 |
| --- | --- | --- | --- |
| `src/harness/sources/dataContext.ts:41` | 及格率 9100%、优秀率 3800% | 91% / 38% | seed `passRate:91/excellenceRate:38`（`src/data/seed.ts:110`） |
| `dataContext.ts:48` | 作业完成率 9300% | 93% | `homeworkCompletion:93`（`src/data/seed.ts:114`） |
| `dataContext.ts:61` | 作业 8800% | 88% | `SCHOOL_TREND` homework 88（`src/data/seed.ts:201`） |
| 测试夹具把 bug 写成契约 | `dataContext.test.ts:18-19,25` 用 0.91/0.86/0.82 断言 86% | 改 0–100，断言 91%/93%/88% | 同上 `:41,48` |
| CSV 入口不齐 | 及格/优秀率列原样保留（`src/lib/csvImport.ts:192-193`），作业率却归一（`:270`） | 两率同样 `v<=1?×100:v` | 远端演示也是 0–100（`proxy/server.mjs:200-207`） |

对账：`scripts/report.ts:134,137`、`agent/tools/index.ts:41`、`sources/dataCards.ts:44,66`、`csvImport.ts:119-120` 都按 0–100 直接加 `%` → **0–100 是唯一口径**，dataContext 三处是孤例。删三个 `*100`，归一放 Source/CSV 边界；补三处字符串断言 + CSV 0–1 用例；输出不得 >100%。

### 2.2 t8 文案

`src/harness/scripts/briefing.ts:102`「本次月考班级均分 82.4，较上次提升 1.8 分」。seed：82.4 是**物理均分**、环比 **+2.1**（`src/data/seed.ts:110`），无「班级均分」字段；口径已冻结（`doc/v1.0-roadmap.md:660,662`），director 侧早已改 +2.1（`src/harness/director/data.ts:7,149`），**只有 t8 未改**。改「本次月考物理均分 82.4，较上次 +2.1 分」；要「班级均分」须在 seed 增派生 80.4 并标派生。单测断言含「物理均分」「+2.1」、不含「班级均分」「1.8」。扫描：`scripts/agent.ts:36,69,84` 与 seed 一致；另 5 处无出处 Mock 数字（`briefing.ts:64,83,144,159,295`）不进 facts，列 P1。

### 2.3 facts + verifyCitations

- `src/harness/director/facts.ts`：planning 时冻结 `Fact{factId,key,value,unit,label,source,asOf,derived?}`；v1 收 9 条（82.4/78.6/80.2 分、+2.1/-1.4/+0.8 百分点、93%、86、61%），80.4 标 derived；来源取 `SourceProvider`（`sources/index.ts:45-53`），degraded 如实写。
- `src/harness/director/verifyCitations.ts`（纯函数）：抽数字 token 按单位配对；命中快照/派生→verified；同指标异值→conflicts（复用 d-conflict）；无据→unverified。**只校验统计型数字**，页数/题量/封数/时长入结构性白名单，否则「3 封/8 页/12 题/15 分钟」无法 100% 溯源。
- 落点：planner 产出先校验，unverified 只标「待核」不阻上屏；Mock 产物 4 篇约 30 处数字仅 2 处带 `{{值~来源}}`（`src/harness/director/data.ts:213,216`），补齐后才可断言 100%。
- 测试：82.4 过、80.4 需 derived、84 unverified、9100 与 1.8 冲突、「3 封」结构性过；`data.ts` 全量扫描。

### 2.4 其他污染项

| 问题 | 证据 | 处理 |
| --- | --- | --- |
| 单位混用：trend 是百分点却加 `%` | `src/data/seed.ts:30`；`sources/dataCards.ts:153`；`scripts/briefing.ts:230` | facts 带 unit，按 unit 渲染 |
| 导入文档原文+说明直入 prompt（注入面） | `src/stores/dataStore.ts:121-131`；`agent/Orchestrator.ts:133,149-151` | v1.1 planner 不消费附件 |
| 预算形同虚设：只统计输出且默认 60000 | `stores/settingsStore.ts:77-78`；`Orchestrator.ts:206,214-216` | planner 自带约 2K tokens 上限 |

## 3. 方案 A · 真 LLM 拆解

### 3.1 调用链

`InboxSurface.dispatch`（`src/apps/director/InboxSurface.tsx:436-440`）→ 新增 store action `plan(utterance)` → `planner.planMission` → `validatePlan` → 写 `missionPlan/planSource` → 计划页；「开战」仍走 Mock 引擎（`src/stores/directorStore.ts:241-262`）。提交中禁用输入、可取消、loading ≤15s。
- 前置：`mode!=='api'` 或无 key/proxy → 模板，reason=`mock_mode|no_key`。
- 请求：`new DeepSeekAdapter(config)`（同 `ApiBriefingProvider.ts:196`）+ `streamChatRaw`，1 system + 1 user，流式仅累积、结束后一次解析。
- 中止：`AbortController` 15s；卸载/取消/重提 abort；`requestSeq` 丢弃过期响应防连点。
- 重试：≤2 次，仅 TypeError/5xx/非 JSON/校验失败重试，第 2 次附失败原因；**401/403/404/429 不重试**直接模板（429 带 Retry-After，代理限流 10 次/分：`proxy/README.md:20`）。
- 结果 `{plan,source,reason?}`；模板取 `MISSION_TEMPLATES[kind]`；`MissionSurface.tsx:554` 空计划回落保留。

### 3.2 契约与兼容

- 新增 `MissionPlan`：kind / title(≤12 字) / tasks[{id,agentId,title,deps,gate?}]（4–8 个）/ gates（1–2 个）/ deliverables / estimateMinutes。**LLM 只产这些**；task id、seconds、feed 台词、gate 文案、产物 Markdown 本地补。
- **不动** `MissionPlanTask`（`src/harness/director/types.ts:73-78`）与 `MissionState.plan`（`:82-92`）：适配成 `MissionPlanTask[]` 后仍交现有脚本引擎，旧单测/E2E 断言零改动；仅给 `MissionStatus`（`:71`）加 `'paused'`。
- **必改** `MissionGate`（`:80`）扩为 `GateId`；`GATE_META`（`MissionSurface.tsx:60-79`）补 worksheet/lesson；`GATE_STEP_IDS`（`:47`）与 `gateCount`（`:175`）写死 t2/t3，LLM 计划会永远显示「2 次拍板」，须改为从 `plan.gates` 派生。
- kind 两套：harness 5 个英文 `ArtifactKind`（`src/harness/types.ts:213`）vs director 4 个中文 tile kind（`src/harness/director/types.ts:98`）。建议用中文（图标/渲染直接可用，`MissionSurface.tsx:53-58`），exam_loop 加「练习单/教案」——拍板项。

### 3.3 prompt 与参数

| 项 | 设计 |
| --- | --- |
| system ① | 只输出一个 JSON 对象，禁止代码块/解释/多余字段 |
| ② | 名册 6 个 agent 的 id/职责/boundary（`director/data.ts:18-79` 压成 6 行） |
| ③ | 4–8 任务、deps 无环 ≤3 层、可并行、对外发送与成绩类必须挂门、kind 二选一 |
| ④ | 数字只能引用事实快照，不得新造；无快照用定性描述 |
| ⑤ | 字段白名单与长度：title ≤20 字、estimateMinutes 3–60、不输出工具/URL |
| ⑥ | 无法拆解输出 `fallback:true`，不要反问 |
| user | 原话（≤120 字、`<utterance>` 包裹并声明视为数据）+ 6–10 行 facts（值/单位/来源）+ 2 个 kind 说明 + 合法示例（`doc/v1.1-roadmap.md:468-484`） |
| 参数 | temperature 0.2；max_tokens 800；timeout 15000ms；maxAttempts 2；stream 仅累积；约 <2K tokens；不重试到底；记录 planSource/latencyMs/model/字符数 |

### 3.4 validatePlan（8 条矩阵）

| # | 检查 | 失败 |
| --- | --- | --- |
| 1 | kind ∈ {parent_meeting, exam_loop} | reject |
| 2 | 4 ≤ tasks ≤ 8 | reject |
| 3 | agentId ∈ AGENTS 且 ≥2 个非 chief | reject |
| 4 | deps 引用存在、无环、最长链 ≤3 | reject |
| 5 | gates ⊆ GateId、1–2 个且都落在存在任务上（与 task.gate 冲突以 tasks 重算） | reject |
| 6 | deliverables ⊆ 允许集合、≥1、去重 | reject |
| 7 | title/estimate 合法范围（title 超长截断，不因此 reject） | 修正 |
| 8 | 可选 tool ∈ `toolRegistry` 且属该 agent 工具域 | reject（v1.1 不产 tool，留 v1.2 防线） |

通过后本地补正：id 重编号 t1..tn、seconds、gate 文案、产物按 kind 取模板。**不静默改结构**（id/截断除外）；非法计划永不上屏；失败→重试 1 次→模板并显示 reason。

### 3.5 Mock/API 切换与可见性

默认 Mock（`src/harness/defaults.ts:7`；`src/stores/settingsStore.ts:97-105`）；真 LLM 唯一开关 `settings.mode==='api'`（与 `src/harness/providerRegistry.ts:63-69` 同源），不做页内开关；`?v1=1&llm=0` 强制模板供 E2E/断网彩排，不提供 `?llm=1`。计划页 chips（`MissionSurface.tsx:187-191`）显示「真 LLM」/「模板兜底」+ 一行 reason（`data-testid="plan-source"`）；失败不弹 toast。

### 3.6 测试

- 单测：`planner.test.ts`（JSON 提取含噪声/非 JSON/超时/2 次重试/401 与 429 不重试/竞态/卸载中止/模板回退）、`validatePlan.test.ts`（8 条正反约 20 例）、facts/verifyCitations 矩阵。
- E2E +2：route 拦截 `**/chat/completions` 返固定 SSE（`data: {...}` + `[DONE]`，解析见 `llm/sse.ts:16-27`），initScript 注入 api 模式 settings，断言计划字段 +「真 LLM」角标；返 500/非法 JSON → 断言「模板兜底」且可开战；`?llm=0` 断言 0 命中。现无 route 先例（`playwright.config.ts:10-20`），首例需固定 SSE 格式。
- 回归：默认 Mock 计划仍为模板，`directorStore.test.ts:52-77` 与 `e2e/director.spec.ts:25-52` 全绿，`mission-*` testid 不变。

## 4. 方案 B · 状态持久化

### 4.1 schema（`edustudio:director` v1）

| 字段 | 说明 |
| --- | --- |
| schemaVersion / updatedAt | 1 / 写盘时间 |
| decisions / stats | 上限 12 / pending、running、hosted、savedHours |
| mission | status 含 `paused`；title/progress/feed/gate/doneTasks/plan/时间戳 |
| missionKind / planSource | 剧本与计划来源 |
| missionCursor | 续跑位置（`types.ts:129`；写盘点 `directorStore.ts:149,248`） |
| autonomy / guideSeen / facts | 6 agent 授权 / 合并旧键 / 6–10 条快照约 0.8KB |

**排除**：toasts（`directorStore.ts:107-114`）、artifactId、guideActive/guideStep、screen、请求态/seq、timers、滚动。恢复时 `status∈{paused,waiting}` 自动落 `screen='mission'`（派生，不加字段）。体积：feed 30×120B + decisions 3×450B + mission ≤2KB + facts 0.8KB ≈ **<10KB**，远低于 30KB。

### 4.2 写盘与 flush

新建 `src/stores/directorPersistence.ts`：module 级 writer（300ms，`src/lib/debouncedWrite.ts:19,21-46`）+ 待写快照，照抄 `loomStore.ts:51-83`；store 用 `subscribe` 比对「持久化切片」序列化结果再 schedule，瞬态不触发写盘。
强制 flush：confirmPlan（`:241`）、门命中（`:146-152`）、approveGate（`:264`）、rejectGate（`:275`）、finishMission（`:116`）、resetDemo（`:335`）、`hidden`/`pagehide`（`src/main.tsx:29-36` 追加；`DirectorApp` 不在 `AppShell` 内，`AppShell.tsx:40-52` 覆盖不到 command 阶段）。
resetDemo/clearAllData 先 `cancelDirectorPersist()`，否则 300ms 后写回旧状态（先例：`settingsStore.ts:250-253`、`loomStore.ts:80-83`）。

### 4.3 刷新恢复

| 刷新前 | 恢复后 |
| --- | --- |
| planning（计划待确认，`MissionSurface.tsx:559`） | 原样，无需续跑 |
| running | **paused** +「继续」；`resumeMission()` 重建 runId 后 `runFrom(missionCursor)`（`directorStore.ts:164-169`），不重放已发 feed |
| waiting | 原样恢复审批门（门不依赖定时器），批准后从 cursor 续跑 |
| done / paused | 原样 / 「继续」按钮 |
| 损坏或未知版本 | 初始态 + 非打断提示，不白屏 |

`?v1=1` 只负责登录/阶段（`directorEntry.ts:7-10`、`main.tsx:46-50`），不写导演状态。`MissionStatus` 现 5 值（`types.ts:71`），只加 `paused`，不引入早期研究里的 `awaiting_confirm/partial`（无对应分支）。

### 4.4 migration

`migrateDirector(raw)`：非对象或版本≠1 → 初始；字段类型校验补默认；`running→paused`；feed/decisions 截断；kind/planSource/plan 非法回落模板；guideSeen 合并旧键后 `removeKey`（旧键用 raw localStorage，内存后端单测读不到）。`loadJSON` 已 catch 坏 JSON（`src/lib/storage.ts:5-14`），迁移层保证不抛。

### 4.5 备份 / 清空

`BACKUP_KEY_WHITELIST` 加 `director`（`src/lib/backup.ts:20-34`）；**格式版本不升**（只校验 number `:116`，`importAll` 不按版本分支 `:126-149`）。旧备份无 director → 恢复清库后回初始（可接受，文档记录）；恢复仍 `reload`（`src/components/SettingsDialog.tsx:142-147`）；文案 `:514` 补「总指挥模式状态」。清空：`clearAll` 前缀已覆盖（`storage.ts:32-41`），先 cancel writer。

### 4.6 测试

单测 `directorPersistence.test.ts`：往返/损坏/缺字段/旧版本/未知 kind 矩阵、running→paused、cursor 续跑不重复、feed 截断、体积 <30KB；`directorStore.test.ts` 补 plan/paused/resume/reset；`backup.test.ts` 补 director 键往返（参照 `:32-50`）。E2E +1：跑到首门前 `reload()` →「已暂停」→ 继续 → done，决策/授权保留。

## 5. 风险、取舍与工作量

| 风险 | 对策 |
| --- | --- |
| 延迟/成本不稳 | 单次单 HTTP、15s 上限、max_tokens 800、失败即回；P95 ≤15s（roadmap 10.2） |
| 断网/CORS/代理 | 默认 Mock；CORS 由 proxy 白名单放行（`proxy/README.md:22`）；429 不重试直接模板 |
| 输出不稳定 | 8 条校验 + 1 次修复重试 + 非法计划永不上屏 |
| prompt 注入 | 原话/事实只作 user 数据段，system 固定规则，只收 JSON，不执行模型给的 URL/工具；v1.1 不消费导入文档附件 |
| 隐私/合规 | apiKey 混淆存本机且随备份导出（`src/lib/secretBox.ts:1-9`；`settingsStore.ts:121-123,165`；`backup.ts:7-9`）；演示数据已脱敏；`telemetry.ts:11-26` 仅配 proxy 时上报错误摘要 |
| 与旧流程隔离 | planner 只 `new DeepSeekAdapter` 读 settings，不改 `Orchestrator/providerRegistry/chatStore`；执行仍走 `directorStore` |

**零新依赖**：成立。校验手写（先例 `briefing/validate.ts`），JSON/SSE/AbortController 均既有；新增代码全在 director 懒加载 chunk（`src/App.tsx:13`），主 chunk 不动。
**文件与人日**：P0 1.5–2（改 `sources/dataContext.ts`、`lib/csvImport.ts`、`scripts/briefing.ts`，新增 `director/facts.ts`、`director/verifyCitations.ts` + 测试）；A 3.5–4.5（新增 `director/planner.ts`、`validatePlan.ts`、`planTypes.ts`，改 `harness/types.ts`、`llm/adapter.ts`、`director/types.ts`、`stores/directorStore.ts`、`InboxSurface.tsx`、`MissionSurface.tsx` + 单测/E2E）；B 3–4（新增 `stores/directorPersistence.ts`，改 `directorStore.ts`、`main.tsx`、`lib/backup.ts`、`SettingsDialog.tsx` + 测试）。与 roadmap §9 一致。

## 6. 需 Lead 拍板

1. **deliverables 用哪套 kind**：director 中文 tile kind（需为 exam_loop 加「练习单/教案」+ 图标）还是 harness 英文 `ArtifactKind`（需映射渲染）？建议前者。
2. **verifyCitations 覆盖**：只校验统计型数字，否则「3 封/8 页/12 题/15 分钟」无法 100% 溯源；roadmap 10.2 口径需同步收窄。
3. **resetDemo 是否清 guideSeen**：roadmap 5.4 说清；建议保留已读（仅 `?tour=1` 重看），否则每次 ↻ 弹引导。
4. **恢复落点**：刷新后停 inbox 还是 `paused/waiting` 自动进作战室？建议自动进。
5. **参数传递**：扩展 `StreamChatRawOptions`（2 文件，推荐）还是 planner 自带 fetch（重复鉴权/代理，不建议）。
6. **facts 是否持久化**：随 plan 存 0.8KB（校验一致）vs 每次重建（更省但可能不一致）；建议存。
7. **429/401 不重试**：与「失败 100% 回模板可见」一致，但现场偶发限流会直接看到「模板兜底」，是否接受。
