# v1.0 多 Agent 战队编排架构技术方案

> 结论先行：**不重写 Harness 主契约**。新增 `AgentSpec / Mission / TeamTask / Handoff(ArtifactContract)` 四层可选契约，用「MissionRunner 调度外壳 + 既有 AgentProvider 执行单任务」实现 ready-set 并行；Loom 图算法升格为作战室 DAG 内核；主 chunk 120KB 不动，新增代码全部按「首屏不需要」拆懒加载后重校总包阈值。
>
> 口径提示：本文为研究稿，保留调研时的原始表述与证据；AgentId、L0–L3、打扰预算、包体阈值以 [v1.0-roadmap.md](../v1.0-roadmap.md) 附录 C 与 [v1.0-01-team-protocol.md](../v1.0-01-team-protocol.md) 为唯一实现口径。

## 一、现状核验（file:line）与直接塞入的坑

| # | 现状 | 证据 | 对 Swarm 的含义 |
| --- | --- | --- | --- |
| 1 | 执行契约只有 `AgentProvider.runTask(input,emit)`；`AgentTaskInput` = role/goal/history/context，无 Agent 身份 | `types.ts:198-209` | 多 Agent 只能靠 goal 前缀伪装，prompt/工具/记忆无法差异化 |
| 2 | 用户 role 是全局登录态与唯一编排维度；RolePreset 仅三角色，systemPrompt 单体、tools 数组 | `roles/index.ts:6-49`、`types.ts:238-246` | Agent 身份与用户身份强绑，一个教师无法并行驱动 6 个参谋 |
| 3 | 单 Agent 主循环：5 轮上限、单任务 token 预算、上下文裁剪/压缩、Plan-JSON 降级、工具按 role 过滤 | `Orchestrator.ts:24-33,205-224,439-448,452` | 复用它跑「单个 TeamTask」成立；但它不是调度器 |
| 4 | 工具可见性只由 `ToolDef.roles` 决定，registry 按 RoleId 过滤 | `ToolRegistry.ts:16-18`、`tools/index.ts:319-333` | 无法下发 per-agent 白名单（命题官不应看到家校工具） |
| 5 | Loom 真执行走 `chatStore.sendMessage`，按拓扑序取**第一个** ready 串行跑；单飞被占节点回 queued；checkpoint 只置 waiting | `runner.ts:31-34,171-215,185-189,197-208` | 串行是产品决策；审批无数据、输出是自由文本 |
| 6 | chatStore 全局单飞 `streaming` + 模块级单例 `activeController`；history 只取当前会话末 8 条 | `chatStore.ts:171,261-263,323-326` | 并行 mission 会被吞成串行；跨 Agent 共会话必然污染 |
| 7 | 记忆按 role 隔离（episodic 过滤 role / semantic 前缀 `${role}.`），技能匹配按 `roles` | `memoryStore.ts:74-87`、`library.ts:72-84` | 6 个 Agent 共用一份「教师记忆/技能池」，经验互串 |
| 8 | ArtifactDoc 只有 content/kind/role；无 citations/provenance | `types.ts:215-234`、`artifactStore.ts:168-189` | Handoff 只能传全文，无法只传「结论+引用」 |
| 9 | Trace 11 种事件扁平挂在 `ChatEntry.trace`，无 agent/mission 归属 | `types.ts:151-176`、`chatStore.ts:272-321` | 多 Agent 轨迹混在一条 entry，不可分 |
| 10 | 简报卡只有 `action.openTask/link`；采纳 = sendMessage + Loom 建节点（一卡一任务），后台队列串行泵 | `types.ts:74-89`、`BriefingPage.tsx:230-263`、`focusStore.ts:52-84` | 「事找人」缺决策类型（批准/选择/风险），审批门无载体 |
| 11 | Mock 路径不消费 systemPrompt（剧本驱动），只有 API 读 RolePreset | `MockOrchestrator.ts:45-96`、`Orchestrator.ts:132-145` | 只加 AgentSpec 不绑剧本 → Mock 演示里六个 Agent 一个味 |
| 12 | 包体门禁 120KB/310KB；v0.9.5 实测 119.1/304.7（主余量 0.9KB、总余量 5.3KB）；LoomPanel/右栏看板/report 已懒加载 | `budget.mjs:12,31`、`doc/v0.9.5-roadmap.md:221-222,242`、`ChatPanel.tsx:20`、`RightPanel.tsx:14-18` | 任何静态新增都破主 chunk 门禁，须先问「首屏要跑吗」 |
| 13 | 持久化 `edustudio:` 前缀 + 13 键备份白名单；Loom 有 schemaVersion/migrate | `storage.ts:3,32-40`、`backup.ts:20-34`、`loomStore.ts:85-99` | Mission 需独立键 + 迁移 + 白名单登记 |

**直接塞进现有 Loom/chatStore 的 5 个坑**

1. **单飞吞并行且抢视图**：`sendMessage` 持全局 streaming，还会 ensureCardSession/切 activeId（`chatStore.ts:169-206`）；Loom 用「回 queued+退出」规避（`runner.ts:204-208`），但那是串行语义。
2. **会话=上下文边界**：一 Task 一会话才能隔离，6 Agent×N 任务会把会话列表写爆；且 history 固定末 8 条（`chatStore.ts:323-326`），Agent 间会读到彼此闲聊。
3. **输出不可校验**：节点输出是 `runOutput` 自由文本（`loom/types.ts:53`、`runner.ts:27,61-70`，1200 字+6 条摘要），无引用，幻觉沿 DAG 放大。
4. **身份不生效**：Mock 不读 systemPrompt（`MockOrchestrator.ts:45-96`），Agent 人设只在 API 模式存在。
5. **无审批/预算/重试语义**：checkpoint 无决策内容（`runner.ts:185-189,231-239`）；预算只有全局单任务一份（`settingsStore.ts:78`、`Orchestrator.ts:206-224`）。

## 二、新契约草案（全部增量可选，缺省时旧路径字节级不变）

**正交原则**：`AgentSpec` 决定「怎么做」，登录 `role` 决定「能看什么数据」；二者在工具白名单上求交。

| 契约 | 关键字段 | 不变量 / 校验 | 与现状关系 |
| --- | --- | --- | --- |
| **AgentSpec** | id、name、title、persona(≤200字)、baseRole(缺省 inherit=用户 role)、tools:string[]、memoryNs/skillNs=`${role}/${agentId}`、model{temperature,maxTokens}、autonomy、artifactKinds、mockScriptIds、guard{maxToolRounds≤5,timeoutMs} | tools ⊆ `toolRegistry.listForRole(baseRole)`；baseRole 只借 RolePreset 语气与工具域，**不改变数据可见域** | 新增；`buildSystemPrompt`（`roles/index.ts:66-82`）段序复用 |
| **Mission** | id、title、goal、role、kind、deliverable[{artifactKind,acceptance[]}]、approvalGates[]、budget{maxAgentRuns≤8,maxTokens,maxWallMs}、deadline、autonomy、status、taskIds[] | 交付物必须可被 Evaluator 验收；预算任一维耗尽即暂停 | 新增独立 store/key，不并入 Loom |
| **TeamTask** | id、missionId、title、assignee(agentId)、deps[]、input:Handoff[]、outputContract{artifactKind,minCitations}、status、attempts≤2、cost | assignee 必须在册；DAG 无环（复用 `findCycle` `loomGraph.ts:89-129`）；输入只接受 Handoff | 节点语义参考 LoomNode（`loom/types.ts:34-57`），不写 LoomBoard |
| **Handoff / ArtifactContract** | refId、kind、title、artifactId?、summary≤400字、citations≤8{sourceType,ref,locator,quote≤120}、factsSnapshotId、provenance{agentId,missionId,taskId,model,promptHash,toolCallIds} | **类型层不提供 messages/history/rawTranscript**；citation 必须指向快照 factId 或 artifactId | ArtifactDoc 不动，contract 侧车存 missionStore |
| **DecisionItem** | id、kind(approve/choose/confirm/risk/budget/deadline)、question、options[{id,label,effect}]、defaultOptionId、evidence≤5、target{missionId,taskId}、expiresAt、status | 每个审批门/风险/超预算必须产出；可持久化跨刷新 | 简报卡适配器生成，不是 BriefingCard 替代 |
| **Trace 归属** | 新增 `TraceEnvelope{agentId,missionId,taskId,attempt,seq}` + MissionTraceStore | **不改** `AgentTraceEvent` 联合类型（保 464 例回归） | Runner sink 包一层；UI 按 agentId 分栏 |

**AutonomyLevel**：L0 建议（草稿+逐项确认，演示档）｜L1 低风险自动（只读/草稿自动，对外发布前批）｜L2 托管（整 DAG 自动，仅 approvalGates 暂停；产品默认）｜L3 全自动（后台交付，仅异常/超预算出决策卡）。

**Agent 名册**（同名册按用户 role 求交白名单）：总指挥 director（拆解/汇总）、学情分析师 assessmentAnalyst（`queryClassLearning`）、命题官 quizOfficer（`genQuiz`）、备课研究员 prepResearcher（`searchCurriculum/genLessonPlan`）、家校沟通官 homeSchoolLiaison（管理侧 `draftNotice`，教师侧新增 `draftParentNotice`）、班务管家 classSteward（管理侧 `dispatchTaskFlow`）。`ArtifactKind` 五值不足（`types.ts:213`），P0 作战包用 `report` 聚合视图，P2 再评是否扩。

**兼容性四红线**：Mock 兜底（planner 模板 + `mockScriptIds` + `FallbackAgent` `agent/index.ts:19-43`）；纯前端 localStorage（复用 `loadJSON/saveJSON`）；现有测试体系（不改 `AgentTraceEvent` 与 `ArtifactDoc`）；**零新依赖成立**——DAG 用自研 `loomGraph`、状态机用可判别联合 + reducer，不引 xstate/ai-sdk/图库。

## 三、调度器设计

**总指挥拆解（双路径）**：`DirectorPlanner.plan(mission)`。Mock = `MISSION_TEMPLATES`（TS 常量，按 mission.kind 取：学情作战包=学情→命题→家校；班务周包=班务→家校），确定性可演示。API = 单次 JSON 拆解 + `validatePlan`（assignee 在册、无环、deps 有效、≤8 任务、交付物 kind 合法、tools 白名单），失败带错误重试 1 次 → 回退模板并 emit reflect（与 `Orchestrator.ts:412-416` 降级剧本同构）。

```
run(mission):                       # MissionRunner（新增调度外壳）
  plan := planner.plan(mission)      # 校验失败 → 模板
  while ready := readySet(tasks):    # 复用 topologicalSort/layerNodes
    for t in ready (并发 ≤ 2): acquire() → agent.runTask(t)
    awaitGroup
    if gateHit or budgetExhausted: awaiting_approval + DecisionItem
    else continue 其他独立分支
  mission.status = done | partial | failed
```

- **ready-set 并行**：在 `topologicalSort`（`loomGraph.ts:132-156`）之上返回全部就绪任务，而非 Loom 的「第一个」；每任务独立 `AbortController`，并发 2。
- **执行器裁决**：**新增 MissionRunner + 继续复用 AgentProvider**。给 `AgentTaskInput` 增可选 `agent?: AgentSpec`；Orchestrator 三处增量：system prompt（复用 `buildSystemPrompt`）、工具白名单（∩ `listForRole`）、记忆/技能 ns；MockOrchestrator 优先用 `agent.mockScriptIds`。不传 `agent` 时旧行为字节级不变。
- **与 chatStore 单飞冲突**：① mission 不写 chatStore、不抢 activeId/streaming；② mission 自带调度锁（每 mission 串行推进 + 任务并发 2）；③ 新增模块级 `ConcurrencyGovernor`（2 许可，前台对话优先，mission 拿不到回 queued——与 `focusStore.ts:69-75`、`runner.ts:204-208` 同策略）。结论：用户与 mission 互不阻塞。
- **失败/重试/超时**：单任务 timeout 90s、同 Agent 重试 1 次 → 降级为 director 汇总 → 仍败则任务 error、mission=partial + risk DecisionItem（不整批失败）。
- **审批门暂停/恢复**：命中 approvalGates → 置 awaiting_approval + 持久化 DecisionItem，独立分支继续；批准→done 续跑，驳回→skipped + 下游降级。刷新后 running→paused（同 `loomStore.ts:96-99`），点「继续」不重跑已完成任务。
- **成本护栏**：mission 三重预算；token 估算沿用「输出字符/2」（`Orchestrator.ts:214-224`）+ 全局 `tokenBudget`（`settingsStore.ts:78`）取小；80% emit reflect+budget 决策卡，100% 强制收尾。
- **可中断/撤回**：Stop = abort 当前任务（已完成 artifact 先 flush 保留）；撤回任务 → queued、下游 blocked；撤回 mission → cancelled + 产出标 draft。

## 四、上下文隔离（机制而非提示词）

| 维度 | 机制 | 落点 |
| --- | --- | --- |
| Prompt | `buildAgentMessages(agent,task,handoff)` 唯一入口；persona + preset + 按 ns 的记忆/技能 | 新增纯函数，Orchestrator 不再散拼 |
| 记忆 | `MemoryEntry` 增可选 `agentNs`；select 增 ns 过滤；旧数据无 ns = 兼容 role 全量 | `types.ts:275-292`、`memoryStore.ts:74-87` |
| 技能 | `Skill` 增可选 `agents[]`；`matchSkill` 增 agent 条件；沉淀时打标 | `library.ts:72-84`、`skills/types.ts:28-43` |
| 工具 | AgentSpec 白名单 ∩ `listForRole`，越界直接校验失败 | 新增校验器 |
| Handoff | mission 内核只收 `Handoff`，构造 `AgentTaskInput` 时 `history: []`；summary 400/citations 8/artifact 摘录 1200（对齐 `runner.ts:27`） | 新增 MissionRunner |
| 事实快照 | plan 阶段采集一次 `FactSnapshot`（复用 dataContext），全 mission 只读；citation 必须指向 factId 或 artifactId，否则 Evaluator 判失败 | 新增 |
| 溯源 | provenance 随 contract 落 missionStore，UI 可点引用回源（承接 v0.9.5「数字可溯源」） | 新增 |

**防污染红线（写成测试断言）**：mission 路径组装出的 ChatMessage ≤3 条；mission 内核入参编译期不可能含会话历史；跨 ns 读取必须走显式 API。

## 五、与现有 UI/数据的衔接

- **Loom 复用裁决**：图算法（`readyNodes/topologicalSort/findCycle/layerNodes`）纯函数直接复用；图模型语义映射 TeamTask→节点、dep→dependency 边，但 **Mission 独立 store**，不写 LoomBoard（避免污染 Loom）。`LoomCanvas` 与 `useLoomStore` 强耦合（`LoomCanvas.tsx:17`，560 行，e2e 9 例），P0 不复用——作战室用「DAG 分层泳道」视图；P1 抽受控 `GraphCanvas` 后再复用。Trace 投影 `projectTrace`（`loomProjection.ts:32-111`）复用并加 agent 分组。
- **新 app 懒加载**：`src/apps/mission/*` 由 `ChatPanel` 懒加载（先例 `ChatPanel.tsx:20`）；`uiStore.centerView` 扩展 `'mission'`（`uiStore.ts:41`）；mission store/runner/planner/UI 只被 lazy chunk 引用；简报页「组建战队」用动态 `import()`，避免拉进主 chunk。**主 chunk 净增目标 ≤0.5KB**。
- **BriefingCard→DecisionItem**：新增适配器 `cardToDecision()`，保留滑卡交互与卡 id（`BriefingPage.tsx:230-263` 主流程不动），新增次动作「组建战队」；决策收件箱渲染 DecisionItem，P0 复用 notificationStore `task` 类（`notificationStore.ts:11`），P1 增 `decision` 类。
- **localStorage**：新增单键 `edustudio:missions` = `{schemaVersion,missions,tasks,decisions,contracts}`；`migrate()` 链式（同 `loomStore.ts:85-92`）；`running→paused`；备份白名单 +1（`backup.ts:20-34`）；`clearAll` 前缀自动覆盖（`storage.ts:32-40`）；设置页备份文案补「含战队任务」（`SettingsDialog.tsx:506-514`）。
- **包体预算**：主 chunk **120KB 不动**。全 JS 310KB 需重校：

| 阶段 | 新增源码估算 | gzip 增量 | 主要落点 | 主 chunk | 全 JS 建议阈值 |
| --- | --- | --- | --- | --- | --- |
| P0 | 40~50KB | **+11~15KB** | planner 2.5 / runner 3.5 / store 1.5 / UI 5 / 适配 1 | +0.3~0.6 | 310→**325**（实测后定） |
| P1 | 25~35KB | **+7~10KB** | GraphCanvas 3 / 审批恢复 2.5 / 记忆技能 UI 1.5 | 0 | →**335** |
| P2 | 30~40KB | **+8~12KB** | 拆解质量 2 / 契约校验 2 / 托管 2 / 报表 2 | 0 | →**350** |

依据：v0.9.5 实测「约 9KB 源码 → +8.9KB gzip（含 3 个懒 chunk）」（`doc/v0.9.5-roadmap.md:222`）；新代码以可擦除接口 + 中文文案为主，按源码 0.25~0.35 估 gzip；主 chunk 仅剩 0.9KB（`:221`），静态 import 即破门禁（`:242`）。**必须懒加载**：DirectorPlanner、MissionRunner、MissionPanel/作战室、DecisionInbox、GraphCanvas、成本报表、L3 托管设置。**反例**：为侧栏角标把 missionStore 拉进主 chunk。

## 六、分阶段落点

| 阶段 | 模块 | 文件（新增/改造） | 契约 | 人日 |
| --- | --- | --- | --- | --- |
| P0 | 契约层 | 新增 `harness/swarm/types.ts` | AgentSpec/Mission/TeamTask/Handoff/DecisionItem | 1.5 |
| P0 | Agent 名册 | 新增 `harness/swarm/agents.ts` | AgentSpec×6 + mockScriptIds | 1.5 |
| P0 | 总指挥拆解 | 新增 `harness/swarm/planner.ts` + 模板 | DirectorPlanner / validatePlan / 双路径回退 | 2.5 |
| P0 | 调度与执行 | 新增 `harness/swarm/runner.ts`、`stores/missionStore.ts` | MissionRunner / ready-set / gate / budget / TraceEnvelope | 3 |
| P0 | Harness 增量 | 改造 `types.ts`、`Orchestrator.ts`、`MockOrchestrator.ts`、`roles/index.ts` | `AgentTaskInput.agent?`、ns 版 buildAgentMessages | 2 |
| P0 | 战队 UI 与入口 | 新增 `apps/mission/*`；改造 `ChatPanel.tsx`、`uiStore.ts`、`BriefingPage.tsx` | MissionPanel / DecisionItem 卡 / 懒加载 | 3 |
| P0 | 持久化与备份 | 改造 `backup.ts`、`SettingsDialog.tsx` | missions schema v1 + 白名单 | 0.5 |
| P0 | **小计** | | | **14~17** |
| P1 | 作战室画布 | 新增 `apps/mission/GraphCanvas.tsx`；改造 `LoomCanvas.tsx`（抽受控） | `GraphCanvas<MissionGraph>` 复用节点/边渲染 | 3.5 |
| P1 | 决策收件箱 | 新增 `DecisionInbox.tsx`；改造 `notificationStore.ts`、`Sidebar.tsx` | DecisionItem 路由/角标 | 2 |
| P1 | 失败恢复与 ns | 改造 `missionStore.ts`、mission UI | retry/partial/记忆技能 ns 面板 | 2.5 |
| P1 | **小计** | | | **8~11** |
| P2 | 拆解质量与契约校验 | 新增 `harness/swarm/planValidator.ts`、`evaluator.ts`；改造 `eval/ruleEvaluator.ts` | `Evaluator.verify(contract)` / citation 完整性 | 4 |
| P2 | L2/L3 托管与预算 | 新增 `harness/swarm/governor.ts`；改造 `settingsStore.ts` | AutonomyPolicy / 三级预算护栏 | 3 |
| P2 | 多 mission 队列与成本报表 | 新增 `apps/mission/CostPanel.tsx` | MissionQueue / cost ledger | 3.5 |
| P2 | **小计** | | | **10~15** |

**单测/E2E 计划**：单测 +55~70 例（plan 校验矩阵、handoff 隔离、autonomy 状态机、预算停止、持久化迁移、决策适配器、ns 过滤、并发 governor），现有 464 例必须全绿；E2E +4（组建→产出→审批、刷新恢复、失败/超预算决策卡、mission 运行时用户手发消息不被阻塞），总量 23→27。门禁沿用 `npm test + tsc -b + vite build + check:budget + e2e`。三阶段合计 **32~43 人日**。

**风险与对策**：① 破包体门禁 → 先懒加载再抬阈值，P0 后按实测重校；② Mock 里 Agent 无差异 → `mockScriptIds` 强制绑定，Mock 优先级 agent>role；③ 并行状态竞争 → mission 独立 store + governor，不碰 chatStore；④ 污染回归 → 消息组装单测红线；⑤ schema 膨胀 → 单键 + 版本迁移 + 损坏回退空态（Loom 先例）。

**关键决策·次选**：执行器=新 MissionRunner 外壳复用 AgentProvider（次选 Provider 加 runMission→双实现全改，弃）；单飞=作用域租约（次选复用全局 streaming→串行化，弃）；Mission=独立存储键（次选并入 loom→迁移/包体风险，弃）；作战室=先泳道后画布（次选直改 LoomCanvas→P0 风险高，弃）；trace=外层包装（次选扩事件联合→触达 11 事件与投影，P0 收益低，弃）。

**需 Lead 拍板**：① 同意 P0 后 `totalJsKB` 310→325、P2→350（主 chunk 120 不动）；② P0 作战室先做分层泳道、画布推迟 P1；③ 允许按 `input.agent` 存在性做 Orchestrator/MockOrchestrator 增量改造（唯一触碰 Harness 核心处）；④ Mission 独立 localStorage 键（不并入 loom）；⑤ 默认 autonomy：演示 L0 / 产品 L2 是否成立。
